import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { connectDB, sql } from "@/lib/mssql"
import { insertAuditLog } from "@/lib/security/audit-log"
import {
  createApprovedAssignmentLetter,
  createPendingAssignmentLetter,
  getAssignmentLetterByWorkOrder,
  isAssignmentLetterEligibleStatus,
  isAssignmentLetterPreparatoryStatus,
} from "@/modules/replenish/assignment-letter"
import { getReplenishWorkOrderDetail } from "@/modules/replenish/database"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function errorResponse(message, status = 400, extra = {}) {
  return NextResponse.json({ success: false, message, ...extra }, { status })
}

function internalError(error, fallbackMessage) {
  console.error(fallbackMessage, error)
  const detail = process.env.NODE_ENV === "production" ? "" : ` Detail: ${error.message}`
  return errorResponse(`${fallbackMessage}${detail}`, 500)
}

function normalizeId(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function verificationUrl(request, token) {
  return token
    ? new URL(`/transactions/replenish/surat-tugas/verify/${token}`, request.url).toString()
    : null
}

function responseData(request, workOrder, letter, { canPrepare = false } = {}) {
  return {
    work_order: workOrder,
    assignment_letter: letter,
    verification_url: verificationUrl(request, letter?.verification_token),
    permissions: {
      can_print: Boolean(
        canPrepare &&
        letter?.payload_valid &&
        letter?.status === "DISETUJUI" &&
        letter?.approval_valid
      ),
      ready_for_submit: Boolean(
        canPrepare &&
        letter?.payload_valid &&
        letter?.status === "MENUNGGU_PERSETUJUAN"
      ),
      can_prepare: Boolean(canPrepare),
    },
  }
}

async function ensureLegacyApprovedLetter({
  request,
  db,
  workOrder,
  workOrderId,
  scopeCodeUker,
  triggeredBy,
}) {
  if (
    !isAssignmentLetterEligibleStatus(workOrder.status) ||
    !workOrder.approved_by ||
    !workOrder.approved_at
  ) {
    return null
  }

  const transaction = new sql.Transaction(db)
  let finished = false
  try {
    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED)

    const current = await getAssignmentLetterByWorkOrder(
      transaction,
      workOrderId,
      scopeCodeUker
    )
    if (current?.status === "DISETUJUI" && current.payload_valid && current.approval_valid) {
      await transaction.commit()
      finished = true
      return current
    }

    const generated = await createApprovedAssignmentLetter(transaction, {
      workOrderId,
      approvedBy: workOrder.approved_by,
      approvedAt: workOrder.approved_at,
      scopeCodeUker,
    })

    await insertAuditLog(transaction, {
      request,
      userId: Number(workOrder.approved_by),
      action: "AUTO_GENERATE",
      module: "transactions.replenish.surat-tugas",
      entityType: "replenish_assignment_letter",
      entityId: generated.id,
      metadata: {
        work_order_id: workOrderId,
        work_order_no: workOrder.work_order_no,
        letter_no: generated.letterNo,
        document_hash: generated.documentHash,
        approval_hash: generated.approvalHash,
        triggered_by_user_id: Number(triggeredBy),
        source: "LEGACY_APPROVED_WORK_ORDER",
      },
    })

    await transaction.commit()
    finished = true
    return getAssignmentLetterByWorkOrder(db, workOrderId, scopeCodeUker)
  } catch (error) {
    if (!finished) {
      try {
        await transaction.rollback()
      } catch {
        // SQL Server mungkin sudah membatalkan transaksi.
      }
    }
    throw error
  }
}

export async function GET(request, context) {
  const authorization = await authorizeApiRequest(request, "/transactions", "view")
  if (!authorization.authorized) return authorization.response

  const { id } = await context.params
  const workOrderId = normalizeId(id)
  if (!workOrderId) return errorResponse("ID work order tidak valid.")

  try {
    const scope = getUserDataScope(authorization.user)
    const db = await connectDB()
    const scopeCodeUker = scope.isSuperAdmin ? null : scope.codeUker
    const workOrder = await getReplenishWorkOrderDetail(db, workOrderId, scopeCodeUker)
    if (!workOrder) return errorResponse("Work order tidak ditemukan.", 404)
    const canPrepare = scope.isSuperAdmin || Number(workOrder.created_by) === Number(authorization.user.id)

    let letter = await getAssignmentLetterByWorkOrder(db, workOrderId, scopeCodeUker)

    if (canPrepare && isAssignmentLetterPreparatoryStatus(workOrder.status)) {
      await createPendingAssignmentLetter(db, {
        workOrderId,
        scopeCodeUker,
      })
      letter = await getAssignmentLetterByWorkOrder(db, workOrderId, scopeCodeUker)
    } else if (
      isAssignmentLetterEligibleStatus(workOrder.status) &&
      (!letter || letter.status !== "DISETUJUI" || !letter.payload_valid || !letter.approval_valid)
    ) {
      // Kompatibilitas untuk Work Order yang sudah disetujui sebelum fitur otomatis ini dipasang.
      letter = await ensureLegacyApprovedLetter({
        request,
        db,
        workOrder,
        workOrderId,
        scopeCodeUker,
        triggeredBy: authorization.user.id,
      })
    }

    return NextResponse.json({
      success: true,
      data: responseData(request, workOrder, letter, { canPrepare }),
    })
  } catch (error) {
    return internalError(error, "Gagal mengambil Surat Tugas replenish.")
  }
}
