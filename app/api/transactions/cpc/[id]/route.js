import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { runInTransaction, isRetryableSqlError } from "@/lib/database/transaction"
import { readJsonBody, InvalidJsonBodyError, RequestBodyTooLargeError } from "@/lib/http/json-body"
import { connectDB, sql } from "@/lib/mssql"
import { insertAuditLog } from "@/lib/security/audit-log"
import { isCpcPackingApprover } from "@/modules/cpc/authorization"
import {
  CPC_ACTIONS,
  CPC_ACTION_TRANSITIONS,
  CPC_MENU_HREF,
} from "@/modules/cpc/constants"
import {
  acquireCpcPackingOperatorLock,
  claimCpcPackingWorkOrder,
  ensureCpcPackingBatch,
  getActiveCpcPackingWorkOrderForUser,
  getCpcCassetteRequestDetail,
  getLockedCpcCassetteHandover,
  getLockedCpcPackingBatch,
  getLockedCpcWorkOrder,
  listCpcSpareCassettes,
  listCpcPackingOperators,
  resolveCpcScope,
} from "@/modules/cpc/database"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 16 * 1024
const ACTION_SET = new Set(Object.values(CPC_ACTIONS))
const APPROVER_ACTIONS = new Set([
  CPC_ACTIONS.APPROVE_PACKING,
  CPC_ACTIONS.REJECT_PACKING,
])

class CpcRouteError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = "CpcRouteError"
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

function normalizeNotes(value) {
  return String(value || "").trim().slice(0, 1000)
}

function normalizeIdentityCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "")
}

function normalizeBinaryRowVersion(value) {
  if (Buffer.isBuffer(value)) return value.length === 8 ? Buffer.from(value) : null
  if (ArrayBuffer.isView(value)) {
    const buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    return buffer.length === 8 ? Buffer.from(buffer) : null
  }
  if (Array.isArray(value)) {
    const buffer = Buffer.from(value)
    return buffer.length === 8 ? buffer : null
  }
  if (value && typeof value === "object" && Array.isArray(value.data)) {
    const buffer = Buffer.from(value.data)
    return buffer.length === 8 ? Buffer.from(buffer) : null
  }
  return null
}

function errorResponse(message, status = 400) {
  return NextResponse.json({ success: false, message }, { status })
}

function internalError(error, fallbackMessage) {
  console.error(fallbackMessage, error)
  if (isRetryableSqlError(error)) {
    return NextResponse.json(
      { success: false, message: "Sistem sedang memproses transaksi CPC lain. Coba kembali beberapa saat lagi." },
      { status: 503, headers: { "Retry-After": "1" } }
    )
  }
  return errorResponse(fallbackMessage, 500)
}

function defaultHistoryNotes(action) {
  if (action === CPC_ACTIONS.RECEIVE_REQUEST) {
    return "Permintaan kaset dan lembar uang diterima oleh CPC. Slot kaset uang serta perlengkapan per TID berupa kaset reject Rp0, segel bag berangkat, dan segel bag kembali dibentuk otomatis."
  }
  if (action === CPC_ACTIONS.START_PREPARATION) {
    return "Kebutuhan kaset dan lembar uang telah divalidasi. CPC mulai packing kaset dan persiapan perlengkapan per TID."
  }
  if (action === CPC_ACTIONS.SUBMIT_APPROVAL) {
    return "Packing seluruh TID telah lengkap, termasuk kaset uang, kaset reject Rp0, segel bag berangkat, dan segel bag kembali, lalu diajukan ke Asisten Manager CPC."
  }
  if (action === CPC_ACTIONS.APPROVE_PACKING) {
    return "Packing kaset disetujui oleh Asisten Manager CPC. Kaset siap dan Blotter dapat dicetak."
  }
  if (action === CPC_ACTIONS.REJECT_PACKING) {
    return "Packing kaset dikembalikan oleh Asisten Manager CPC untuk diperbaiki."
  }
  if (action === CPC_ACTIONS.COMPLETE_HANDOVER) {
    return "Seluruh nomor segel diverifikasi ulang dan kaset diserahkan CPC kepada Custody yang ditugaskan. Work Order siap berangkat."
  }
  return "Tahapan CPC diperbarui."
}

export async function GET(request, context) {
  const authorization = await authorizeApiRequest(request, CPC_MENU_HREF, "view")
  if (!authorization.authorized) return authorization.response

  const { id } = await context.params
  const workOrderId = normalizeId(id)
  if (!workOrderId) return errorResponse("ID work order tidak valid.")

  try {
    const db = await connectDB()
    const scope = getUserDataScope(authorization.user)
    const resolvedScope = await resolveCpcScope(db, scope)
    if (resolvedScope.error) return errorResponse(resolvedScope.error, 403)

    const detail = await getCpcCassetteRequestDetail(db, workOrderId, resolvedScope.codeUker)
    if (!detail) return errorResponse("Permintaan CPC tidak ditemukan atau belum masuk tahapan CPC.", 404)

    const canManageAssignments = isCpcPackingApprover(authorization.user)
    const packingOwnerUserId = Number(detail?.cpc_packing?.batch?.packing_owner_user_id || 0) || null
    const packingOwnerIsMe = packingOwnerUserId === Number(authorization.user.id)
    const activePackingJob = canManageAssignments
      ? null
      : await getActiveCpcPackingWorkOrderForUser(db, authorization.user.id, { excludeWorkOrderId: workOrderId })
    const packingOperators = canManageAssignments
      ? (await listCpcPackingOperators(db, detail.codeuker || resolvedScope.codeUker))
        .filter((candidate) => !isCpcPackingApprover(candidate))
      : []
    const spareCassettes = await listCpcSpareCassettes(db)

    return NextResponse.json({
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
        spare_cassettes: spareCassettes.items,
        spare_cassette_summary: spareCassettes.summary,
      },
    })
  } catch (error) {
    return internalError(error, "Gagal mengambil detail permintaan CPC.")
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
    if (error instanceof RequestBodyTooLargeError) return errorResponse("Data aksi CPC terlalu besar.", 413)
    if (error instanceof InvalidJsonBodyError) return errorResponse(error.message, 400)
    return internalError(error, "Gagal membaca aksi CPC.")
  }

  const action = normalizeAction(body.action)
  const notes = normalizeNotes(body.notes)
  const custodyNip = normalizeIdentityCode(body.custody_nip)
  if (!ACTION_SET.has(action)) return errorResponse("Aksi CPC tidak valid.")

  if (APPROVER_ACTIONS.has(action) && !isCpcPackingApprover(authorization.user)) {
    return errorResponse("Approval packing hanya dapat dilakukan oleh Asisten Manager CPC.", 403)
  }
  if (action === CPC_ACTIONS.REJECT_PACKING && !notes) {
    return errorResponse("Alasan penolakan packing wajib diisi.", 400)
  }
  if (action === CPC_ACTIONS.COMPLETE_HANDOVER && !custodyNip) {
    return errorResponse("NIP Custody penerima wajib diverifikasi sebelum serah terima diselesaikan.", 400)
  }

  const transition = CPC_ACTION_TRANSITIONS[action]
  const db = await connectDB()
  const scope = getUserDataScope(authorization.user)

  try {
    const resolvedScope = await resolveCpcScope(db, scope)
    if (resolvedScope.error) return errorResponse(resolvedScope.error, 403)

    const transitionResult = await runInTransaction(db, async (transaction) => {
      if ([CPC_ACTIONS.RECEIVE_REQUEST, CPC_ACTIONS.START_PREPARATION, CPC_ACTIONS.SUBMIT_APPROVAL].includes(action)) {
        await acquireCpcPackingOperatorLock(transaction, authorization.user.id)
      }

      const current = await getLockedCpcWorkOrder(transaction, workOrderId, resolvedScope.codeUker)
      if (!current) throw new CpcRouteError("Permintaan CPC tidak ditemukan.", 404)
      if (!current.approved_at) {
        throw new CpcRouteError("Work order belum memiliki persetujuan final dan belum dapat diproses CPC.", 409)
      }
      if (current.status !== transition.from) {
        throw new CpcRouteError(
          `Status work order telah berubah menjadi ${current.status}. Muat ulang sebelum memproses kembali.`,
          409
        )
      }

      let packing = null
      if ([CPC_ACTIONS.RECEIVE_REQUEST, CPC_ACTIONS.START_PREPARATION].includes(action)) {
        await ensureCpcPackingBatch(transaction, workOrderId, authorization.user.id)
        const claim = await claimCpcPackingWorkOrder(transaction, workOrderId, authorization.user.id)
        if (!claim?.isOwner) {
          throw new CpcRouteError(
            `Work Order ${current.work_order_no} sedang dikerjakan ${claim?.packingOwnerName || "petugas CPC lain"}. Pilih Work Order lain.`,
            409
          )
        }
        packing = await getLockedCpcPackingBatch(transaction, workOrderId)
      }

      if (action === CPC_ACTIONS.SUBMIT_APPROVAL) {
        await ensureCpcPackingBatch(transaction, workOrderId, authorization.user.id)
        const claim = await claimCpcPackingWorkOrder(transaction, workOrderId, authorization.user.id)
        if (!claim?.isOwner) {
          throw new CpcRouteError(
            `Work Order ${current.work_order_no} sedang dikerjakan ${claim?.packingOwnerName || "petugas CPC lain"}. Hanya pemilik job yang dapat mengajukan packing.`,
            409
          )
        }
      }

      if ([CPC_ACTIONS.SUBMIT_APPROVAL, CPC_ACTIONS.APPROVE_PACKING, CPC_ACTIONS.REJECT_PACKING].includes(action)) {
        packing = await getLockedCpcPackingBatch(transaction, workOrderId)
        if (!packing?.batch) {
          throw new CpcRouteError("Form packing kaset belum dibuat. Mulai packing terlebih dahulu.", 409)
        }
      }

      if (action === CPC_ACTIONS.SUBMIT_APPROVAL) {
        if (
          !packing.summary.all_complete
          || packing.summary.packing_complete_tids !== packing.summary.expected_tids
        ) {
          throw new CpcRouteError(
            `Packing belum lengkap. ${packing.summary.packing_complete_tids}/${packing.summary.expected_tids} TID berstatus PACKING_COMPLETE, ${packing.summary.completed_cassettes}/${packing.summary.expected_cassettes} kaset uang lengkap, dan ${packing.summary.completed_bag_seals}/${packing.summary.expected_bag_seals} segel bag terdaftar.`,
            409
          )
        }
      }

      if (APPROVER_ACTIONS.has(action)) {
        if (packing.batch.status !== "MENUNGGU_APPROVAL") {
          throw new CpcRouteError("Packing tidak sedang menunggu approval Asisten Manager CPC.", 409)
        }
        if (Number(packing.batch.submitted_by) === Number(authorization.user.id)) {
          throw new CpcRouteError("Petugas yang mengajukan packing tidak boleh menyetujui packing yang sama.", 403)
        }
        if (packing.items.some((item) =>
          Number(item.packed_by) === Number(authorization.user.id) || Number(item.sealed_by) === Number(authorization.user.id)
        ) || packing.tid_assets.some((item) => Number(item.prepared_by) === Number(authorization.user.id))) {
          throw new CpcRouteError("Petugas yang melakukan packing, menyiapkan kaset reject, atau scan segel tidak boleh menjadi approver packing yang sama.", 403)
        }
      }

      let handover = null
      if (action === CPC_ACTIONS.COMPLETE_HANDOVER) {
        packing = await getLockedCpcPackingBatch(transaction, workOrderId)
        if (!packing?.batch || packing.batch.status !== "DISETUJUI" || !packing.summary.all_complete) {
          throw new CpcRouteError("Packing CPC belum disetujui atau belum lengkap.", 409)
        }
        handover = await getLockedCpcCassetteHandover(transaction, workOrderId)
        if (!handover?.handover) {
          throw new CpcRouteError("Scan verifikasi serah terima belum disimpan.", 409)
        }
        if (handover.handover.status !== "VERIFIKASI") {
          throw new CpcRouteError("Serah terima kaset sudah diselesaikan.", 409)
        }
        if (!handover.summary.all_verified) {
          throw new CpcRouteError(
            `Verifikasi serah terima belum lengkap. ${handover.summary.verified_cassettes}/${handover.summary.expected_cassettes} nomor segel sesuai.`,
            409
          )
        }
        if (normalizeIdentityCode(handover.handover.custody_nip) !== custodyNip) {
          throw new CpcRouteError("NIP yang diverifikasi tidak sesuai dengan Custody pada Work Order.", 409)
        }
      }

      const lockedRowVersion = normalizeBinaryRowVersion(current.row_version)
      if (!lockedRowVersion) throw new CpcRouteError("Token versi work order pada database tidak valid.", 500)

      const updateResult = await new sql.Request(transaction)
        .input("workOrderId", sql.BigInt, workOrderId)
        .input("rowVersion", sql.Binary(8), lockedRowVersion)
        .input("targetStatus", sql.VarChar(40), transition.to)
        .query(`
          UPDATE dbo.replenish_work_orders
          SET status = @targetStatus, updated_at = SYSDATETIME()
          WHERE id = @workOrderId
            AND row_version = @rowVersion;

          SELECT @@ROWCOUNT AS affected_rows;
        `)

      if (Number(updateResult.recordset[0]?.affected_rows || 0) !== 1) {
        throw new CpcRouteError("Status work order telah berubah. Muat ulang sebelum memproses kembali.", 409)
      }

      if ([CPC_ACTIONS.RECEIVE_REQUEST, CPC_ACTIONS.START_PREPARATION].includes(action)) {
        await new sql.Request(transaction)
          .input("workOrderId", sql.BigInt, workOrderId)
          .query(`
            UPDATE dbo.cpc_packing_batches
            SET status = 'PACKING', updated_at = SYSDATETIME()
            WHERE work_order_id = @workOrderId;
          `)
      } else if (action === CPC_ACTIONS.SUBMIT_APPROVAL) {
        await new sql.Request(transaction)
          .input("workOrderId", sql.BigInt, workOrderId)
          .input("userId", sql.Int, authorization.user.id)
          .input("notes", sql.NVarChar(1000), notes || null)
          .query(`
            UPDATE dbo.cpc_packing_batches
            SET
              status = 'MENUNGGU_APPROVAL',
              packing_notes = COALESCE(@notes, packing_notes),
              submitted_by = @userId,
              submitted_at = SYSDATETIME(),
              approved_by = NULL,
              approved_at = NULL,
              approval_notes = NULL,
              packing_owner_user_id = NULL,
              packing_claimed_at = NULL,
              updated_at = SYSDATETIME()
            WHERE work_order_id = @workOrderId;
          `)
      } else if (action === CPC_ACTIONS.APPROVE_PACKING) {
        await new sql.Request(transaction)
          .input("workOrderId", sql.BigInt, workOrderId)
          .input("userId", sql.Int, authorization.user.id)
          .input("notes", sql.NVarChar(1000), notes || null)
          .query(`
            UPDATE dbo.cpc_packing_batches
            SET
              status = 'DISETUJUI',
              approved_by = @userId,
              approved_at = SYSDATETIME(),
              approval_notes = @notes,
              updated_at = SYSDATETIME()
            WHERE work_order_id = @workOrderId;
          `)
      } else if (action === CPC_ACTIONS.REJECT_PACKING) {
        await new sql.Request(transaction)
          .input("workOrderId", sql.BigInt, workOrderId)
          .input("userId", sql.Int, authorization.user.id)
          .input("notes", sql.NVarChar(1000), notes)
          .query(`
            UPDATE dbo.cpc_packing_batches
            SET
              status = 'DITOLAK',
              rejected_by = @userId,
              rejected_at = SYSDATETIME(),
              approval_notes = @notes,
              updated_at = SYSDATETIME()
            WHERE work_order_id = @workOrderId;
          `)
      } else if (action === CPC_ACTIONS.COMPLETE_HANDOVER) {
        await new sql.Request(transaction)
          .input("handoverId", sql.BigInt, handover.handover.id)
          .input("userId", sql.Int, authorization.user.id)
          .input("notes", sql.NVarChar(1000), notes || null)
          .input("recipientNip", sql.VarChar(50), handover.handover.custody_nip)
          .input("recipientName", sql.NVarChar(200), handover.handover.custody_name)
          .query(`
            UPDATE dbo.cpc_cassette_handovers
            SET
              status = 'SELESAI',
              handover_notes = COALESCE(@notes, handover_notes),
              completed_by = @userId,
              completed_at = SYSDATETIME(),
              recipient_nip_snapshot = @recipientNip,
              recipient_name_snapshot = @recipientName,
              updated_at = SYSDATETIME()
            WHERE id = @handoverId
              AND status = 'VERIFIKASI';
          `)
      }

      const historyNotes = notes || defaultHistoryNotes(action)

      await new sql.Request(transaction)
        .input("workOrderId", sql.BigInt, workOrderId)
        .input("fromStatus", sql.VarChar(40), current.status)
        .input("toStatus", sql.VarChar(40), transition.to)
        .input("action", sql.VarChar(30), action)
        .input("notes", sql.NVarChar(1000), historyNotes)
        .input("actorUserId", sql.Int, authorization.user.id)
        .query(`
          INSERT INTO dbo.replenish_status_history
            (work_order_id, from_status, to_status, action, notes, actor_user_id)
          VALUES
            (@workOrderId, @fromStatus, @toStatus, @action, @notes, @actorUserId);
        `)

      await insertAuditLog(transaction, {
        request,
        userId: authorization.user.id,
        action,
        module: "transactions.cpc",
        entityType: "replenish_work_order",
        entityId: workOrderId,
        metadata: {
          work_order_no: current.work_order_no,
          from_status: current.status,
          to_status: transition.to,
          notes: historyNotes,
          cpc_unit: current.codeuker,
          packing_complete: packing?.summary?.all_complete ?? null,
          packing_expected_cassettes: packing?.summary?.expected_cassettes ?? null,
          handover_verified_cassettes: handover?.summary?.verified_cassettes ?? null,
          handover_expected_cassettes: handover?.summary?.expected_cassettes ?? null,
          custody_employee_id: handover?.handover?.custody_employee_id ?? null,
        },
      })

      return {
        workOrderNo: current.work_order_no,
        fromStatus: current.status,
        toStatus: transition.to,
      }
    }, {
      isolationLevel: sql.ISOLATION_LEVEL.READ_COMMITTED,
      maxRetries: 2,
    })

    const detail = await getCpcCassetteRequestDetail(db, workOrderId, resolvedScope.codeUker)
    const canManageAssignments = isCpcPackingApprover(authorization.user)
    const packingOwnerUserId = Number(detail?.cpc_packing?.batch?.packing_owner_user_id || 0) || null
    const packingOwnerIsMe = packingOwnerUserId === Number(authorization.user.id)
    const activePackingJob = canManageAssignments
      ? null
      : await getActiveCpcPackingWorkOrderForUser(db, authorization.user.id, { excludeWorkOrderId: workOrderId })
    const packingOperators = canManageAssignments
      ? (await listCpcPackingOperators(db, detail?.codeuker || resolvedScope.codeUker))
        .filter((candidate) => !isCpcPackingApprover(candidate))
      : []
    const spareCassettes = await listCpcSpareCassettes(db)

    return NextResponse.json({
      success: true,
      message: `Permintaan ${transitionResult.workOrderNo} berhasil diproses menjadi ${transitionResult.toStatus}.`,
      data: {
        request: detail,
        transition: transitionResult,
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
        spare_cassettes: spareCassettes.items,
        spare_cassette_summary: spareCassettes.summary,
        action_protocol: "SERVER_LOCKED_CPC_V2",
      },
    }, {
      headers: { "X-CPC-Action-Protocol": "SERVER_LOCKED_CPC_V2" },
    })
  } catch (error) {
    if (error instanceof CpcRouteError) return errorResponse(error.message, error.status)
    const number = Number(error?.number || error?.originalError?.info?.number || 0)
    if ([54311, 54312, 54313, 54314, 54315, 54316].includes(number)) {
      return errorResponse(error?.message || "Job packing CPC tidak dapat diambil.", 409)
    }
    return internalError(error, "Gagal memproses permintaan kaset dan lembar uang.")
  }
}
