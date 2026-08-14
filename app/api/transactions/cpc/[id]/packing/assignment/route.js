import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { runInTransaction, isRetryableSqlError } from "@/lib/database/transaction"
import { readJsonBody, InvalidJsonBodyError, RequestBodyTooLargeError } from "@/lib/http/json-body"
import { connectDB, sql } from "@/lib/mssql"
import { insertAuditLog } from "@/lib/security/audit-log"
import { isCpcPackingApprover } from "@/modules/cpc/authorization"
import {
  CPC_MENU_HREF,
  CPC_PACKING_ASSIGNMENT_ACTIONS,
} from "@/modules/cpc/constants"
import {
  acquireCpcPackingOperatorLock,
  claimCpcPackingWorkOrder,
  ensureCpcPackingBatch,
  getActiveCpcPackingWorkOrderForUser,
  getCpcCassetteRequestDetail,
  getLockedCpcPackingBatch,
  getLockedCpcPackingTidAsset,
  getLockedCpcWorkOrder,
  listCpcPackingOperators,
  releaseCpcPackingWorkOrder,
  resolveCpcScope,
  transferCpcPackingWorkOrder,
} from "@/modules/cpc/database"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 8 * 1024
const ACTION_SET = new Set(Object.values(CPC_PACKING_ASSIGNMENT_ACTIONS))

class CpcAssignmentError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = "CpcAssignmentError"
    this.status = status
  }
}

function normalizeId(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeAction(value) {
  return String(value || "").trim().toUpperCase()
}

function errorResponse(message, status = 400) {
  return NextResponse.json({ success: false, message }, { status })
}

function internalError(error, fallbackMessage) {
  console.error(fallbackMessage, error)
  if (isRetryableSqlError(error)) {
    return NextResponse.json(
      { success: false, message: "Job packing Work Order sedang diproses pengguna lain. Coba kembali beberapa saat lagi." },
      { status: 503, headers: { "Retry-After": "1" } }
    )
  }
  return errorResponse(fallbackMessage, 500)
}

function isEligiblePackingOperator(user) {
  return user && !isCpcPackingApprover(user)
}

async function buildResponse(db, workOrderId, scopeCodeUker, user) {
  const detail = await getCpcCassetteRequestDetail(db, workOrderId, scopeCodeUker)
  const canManageAssignments = isCpcPackingApprover(user)
  const packingOwnerUserId = Number(detail?.cpc_packing?.batch?.packing_owner_user_id || 0) || null
  const packingOwnerIsMe = packingOwnerUserId === Number(user?.id)
  const activePackingJob = canManageAssignments
    ? null
    : await getActiveCpcPackingWorkOrderForUser(db, user?.id, { excludeWorkOrderId: workOrderId })
  const rawOperators = canManageAssignments
    ? await listCpcPackingOperators(db, detail?.codeuker || scopeCodeUker)
    : []
  const packingOperators = rawOperators.filter(isEligiblePackingOperator)

  return {
    success: true,
    data: {
      request: detail,
      capabilities: {
        can_approve_packing: canManageAssignments,
        can_manage_packing_assignments: canManageAssignments,
        can_claim_packing_work_order: !canManageAssignments
          && (!packingOwnerUserId || packingOwnerIsMe)
          && (!activePackingJob || packingOwnerIsMe),
        can_edit_packing: !canManageAssignments && packingOwnerIsMe,
        packing_owner_is_me: packingOwnerIsMe,
        active_packing_work_order_id: activePackingJob?.workOrderId || null,
        active_packing_work_order_no: activePackingJob?.workOrderNo || null,
      },
      packing_operators: packingOperators,
    },
  }
}

export async function PATCH(request, context) {
  const authorization = await authorizeApiRequest(request, CPC_MENU_HREF, "update")
  if (!authorization.authorized) return authorization.response

  const { id } = await context.params
  const workOrderId = normalizeId(id)
  if (!workOrderId) return errorResponse("ID work order tidak valid.")

  let body
  try {
    body = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return errorResponse("Data assignment terlalu besar.", 413)
    if (error instanceof InvalidJsonBodyError) return errorResponse(error.message, 400)
    return internalError(error, "Gagal membaca assignment packing CPC.")
  }

  const action = normalizeAction(body?.action)
  const workOrderPointId = normalizeId(body?.work_order_point_id)
  const targetUserId = normalizeId(body?.target_user_id)

  if (!ACTION_SET.has(action)) return errorResponse("Aksi assignment packing tidak valid.")
  if (!workOrderPointId) return errorResponse("TID yang akan diproses tidak valid.")
  if (action === CPC_PACKING_ASSIGNMENT_ACTIONS.ASSIGN && !targetUserId) {
    return errorResponse("Petugas tujuan wajib dipilih.")
  }

  const canManageAssignments = isCpcPackingApprover(authorization.user)
  if (action === CPC_PACKING_ASSIGNMENT_ACTIONS.ASSIGN && !canManageAssignments) {
    return errorResponse("Hanya supervisor CPC yang dapat mengalihkan job packing Work Order.", 403)
  }
  if ([CPC_PACKING_ASSIGNMENT_ACTIONS.CLAIM, CPC_PACKING_ASSIGNMENT_ACTIONS.RELEASE].includes(action) && canManageAssignments) {
    return errorResponse("Supervisor/approver CPC tidak boleh mengambil job packing yang akan dia approve.", 403)
  }

  const db = await connectDB()
  const scope = getUserDataScope(authorization.user)

  try {
    const resolvedScope = await resolveCpcScope(db, scope)
    if (resolvedScope.error) return errorResponse(resolvedScope.error, 403)

    const result = await runInTransaction(db, async (transaction) => {
      const lockUserId = action === CPC_PACKING_ASSIGNMENT_ACTIONS.ASSIGN
        ? targetUserId
        : authorization.user.id
      await acquireCpcPackingOperatorLock(transaction, lockUserId)

      const workOrder = await getLockedCpcWorkOrder(transaction, workOrderId, resolvedScope.codeUker)
      if (!workOrder) throw new CpcAssignmentError("Permintaan CPC tidak ditemukan.", 404)
      if (workOrder.status !== "KASET_DALAM_PERSIAPAN") {
        throw new CpcAssignmentError("Assignment job hanya dapat diubah saat packing masih dalam persiapan.", 409)
      }

      await ensureCpcPackingBatch(transaction, workOrderId, authorization.user.id)
      const packing = await getLockedCpcPackingBatch(transaction, workOrderId)
      const asset = await getLockedCpcPackingTidAsset(transaction, workOrderId, workOrderPointId)
      if (!asset) throw new CpcAssignmentError("TID packing tidak ditemukan pada Work Order ini.", 404)

      const previousOwnerId = Number(packing?.batch?.packing_owner_user_id || 0) || null
      const previousOwnerName = packing?.batch?.packing_owner_name || null
      let assignedTo = previousOwnerId
      let assignedToName = previousOwnerName
      let auditAction = null

      if (action === CPC_PACKING_ASSIGNMENT_ACTIONS.CLAIM) {
        const claim = await claimCpcPackingWorkOrder(transaction, workOrderId, authorization.user.id)
        if (!claim?.isOwner) {
          throw new CpcAssignmentError(
            `Work Order ${workOrder.work_order_no} sedang dikerjakan ${claim?.packingOwnerName || "petugas CPC lain"}. Pilih Work Order lain.`,
            409
          )
        }

        assignedTo = Number(authorization.user.id)
        assignedToName = authorization.user.full_name || authorization.user.fullName || authorization.user.username
        auditAction = "CPC_CLAIM_PACKING_WORK_ORDER"
      } else if (action === CPC_PACKING_ASSIGNMENT_ACTIONS.RELEASE) {
        if (previousOwnerId !== Number(authorization.user.id)) {
          throw new CpcAssignmentError("Work Order hanya dapat dikembalikan oleh petugas CPC yang sedang memilikinya.", 403)
        }

        await releaseCpcPackingWorkOrder(transaction, workOrderId, authorization.user.id)
        assignedTo = null
        assignedToName = null
        auditAction = "CPC_RELEASE_PACKING_WORK_ORDER"
      } else if (action === CPC_PACKING_ASSIGNMENT_ACTIONS.ASSIGN) {
        const operators = await listCpcPackingOperators(transaction, workOrder.codeuker)
        const targetUser = operators.find((item) => Number(item.id) === targetUserId)
        if (!targetUser || !isEligiblePackingOperator(targetUser)) {
          throw new CpcAssignmentError("Petugas tujuan tidak aktif, tidak satu unit kerja, atau tidak memiliki hak packing CPC.", 409)
        }

        await transferCpcPackingWorkOrder(transaction, workOrderId, targetUserId)
        assignedTo = targetUserId
        assignedToName = targetUser.full_name
        auditAction = "CPC_ASSIGN_PACKING_WORK_ORDER"
      }

      await insertAuditLog(transaction, {
        request,
        userId: authorization.user.id,
        action: auditAction,
        module: "transactions.cpc",
        entityType: "cpc_packing_batch",
        entityId: packing?.batch?.id || asset.batch_id,
        metadata: {
          work_order_id: workOrderId,
          work_order_no: workOrder.work_order_no,
          work_order_point_id: workOrderPointId,
          tid_trigger: asset.tid || asset.sn || null,
          previous_packing_owner_user_id: previousOwnerId,
          previous_packing_owner_name: previousOwnerName,
          packing_owner_user_id: assignedTo,
          packing_owner_name: assignedToName,
          assignment_scope: "WORK_ORDER",
        },
      })

      return {
        workOrderNo: workOrder.work_order_no,
        assignedToName,
      }
    }, {
      isolationLevel: sql.ISOLATION_LEVEL.READ_COMMITTED,
      maxRetries: 2,
    })

    const payload = await buildResponse(db, workOrderId, resolvedScope.codeUker, authorization.user)
    const verb = action === CPC_PACKING_ASSIGNMENT_ACTIONS.CLAIM
      ? `Work Order ${result.workOrderNo} berhasil diambil. Seluruh TID sekarang menjadi job Anda.`
      : action === CPC_PACKING_ASSIGNMENT_ACTIONS.RELEASE
        ? `Work Order ${result.workOrderNo} dikembalikan ke antrean.`
        : `Work Order ${result.workOrderNo} dialihkan ke ${result.assignedToName || "petugas CPC"}.`

    return NextResponse.json({ ...payload, message: verb })
  } catch (error) {
    if (error instanceof CpcAssignmentError) return errorResponse(error.message, error.status)
    const number = Number(error?.number || error?.originalError?.info?.number || 0)
    if ([54311, 54312, 54313, 54314, 54315, 54316].includes(number)) {
      return errorResponse(error?.message || "Job packing Work Order sedang digunakan petugas CPC lain.", 409)
    }
    return internalError(error, "Gagal memperbarui assignment packing CPC.")
  }
}
