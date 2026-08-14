import { NextResponse } from "next/server"

import { GET as getKeyHandoverResource, POST as postKeyHandoverResource } from "./key-handover/route"
import { GET as getKeyHandoverPdfResource } from "./key-handover/pdf/route"
import { GET as getAssignmentLetterResource } from "./surat-tugas/route"
import {
  GET as getAssignmentLetterPdfResource,
  PATCH as patchAssignmentLetterPdfResource,
  POST as postAssignmentLetterPdfResource,
} from "./surat-tugas/pdf/route"

import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { readJsonBody, InvalidJsonBodyError, RequestBodyTooLargeError } from "@/lib/http/json-body"
import { isRetryableSqlError } from "@/lib/database/transaction"
import { connectDB, sql } from "@/lib/mssql"
import { insertAuditLog } from "@/lib/security/audit-log"
import {
  calculateRequestedAmount,
  getReplenishWorkOrderDetail,
  replaceWorkOrderDetails,
  resetReplenishKeyHandover,
  resolveReplenishUker,
  validateReplenishKeyHandoverForSubmit,
  validateReplenishReferences,
} from "@/modules/replenish/database"
import {
  REPLENISH_ACTIONS,
  REPLENISH_MAKER_CANCELLABLE_STATUSES,
} from "@/modules/replenish/constants"
import { isReplenishTeamApprover } from "@/modules/replenish/authorization"
import {
  buildAssignmentLetterSnapshot,
  createApprovedAssignmentLetter,
  createPendingAssignmentLetter,
  getAssignmentLetterByWorkOrder,
} from "@/modules/replenish/assignment-letter"
import { freezeApprovedKeyHandover } from "@/modules/replenish/key-handover-approval"
import {
  normalizeRejectionReason,
  normalizeReplenishAction,
  validateReplenishPayload,
} from "@/modules/replenish/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 128 * 1024

function errorResponse(message, status = 400, extra = {}) {
  return NextResponse.json({ success: false, message, ...extra }, { status })
}

function internalError(error, fallbackMessage) {
  console.error(fallbackMessage, error)
  const number = Number(error?.number || error?.originalError?.info?.number || 0)
  if (isRetryableSqlError(error) || number === 52710) {
    return NextResponse.json(
      { success: false, message: "Sistem sedang memproses transaksi lain. Coba kembali beberapa saat lagi." },
      { status: 503, headers: { "Retry-After": "1" } }
    )
  }
  const detail = process.env.NODE_ENV === "production" ? "" : ` Detail: ${error.message}`
  return errorResponse(`${fallbackMessage}${detail}`, 500)
}

function normalizeId(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function requestedResource(request) {
  return new URL(request.url).searchParams.get("resource") || ""
}

function normalizeBinaryRowVersion(value) {
  if (Buffer.isBuffer(value)) {
    return value.length === 8 ? Buffer.from(value) : null
  }

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
    return buffer.length === 8 ? buffer : null
  }

  return null
}

async function readBody(request) {
  try {
    return { body: await readJsonBody(request, { maxBytes: MAX_BODY_BYTES }), response: null }
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return { body: null, response: errorResponse("Data work order terlalu besar.", 413) }
    }
    if (error instanceof InvalidJsonBodyError) {
      return { body: null, response: errorResponse(error.message, 400) }
    }
    throw error
  }
}

async function authorizeTransaction(request, action = "view") {
  return authorizeApiRequest(request, "/transactions", action)
}

async function authorizeTransactionAny(request, actions) {
  let lastAuthorization = null

  for (const action of actions) {
    const authorization = await authorizeTransaction(request, action)
    if (authorization.authorized) return authorization

    lastAuthorization = authorization
    // Jangan menyamarkan session invalid, password wajib diganti, atau error lain
    // dengan mencoba permission berikutnya. Fallback hanya untuk HTTP 403.
    if (authorization.response?.status !== 403) return authorization
  }

  return lastAuthorization
}

async function getLockedWorkOrder(executor, workOrderId, scopeCodeUker) {
  const result = await new sql.Request(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("scopeCodeUker", sql.NVarChar(4), scopeCodeUker)
    .query(`
      SELECT TOP 1
        wo.id,
        wo.work_order_no,
        wo.uker_id,
        wo.status,
        wo.created_by,
        mu.codeuker,
        wo.row_version AS row_version
      FROM dbo.replenish_work_orders wo WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN dbo.master_uker mu ON mu.id = wo.uker_id
      WHERE wo.id = @workOrderId
        AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker);
    `)

  return result.recordset[0] || null
}

async function validateAssignmentLetterReadyForSubmit(
  executor,
  workOrderId,
  scopeCodeUker
) {
  const letter = await getAssignmentLetterByWorkOrder(
    executor,
    workOrderId,
    scopeCodeUker
  )

  if (!letter?.id || !letter.payload_valid || letter.status !== "MENUNGGU_PERSETUJUAN") {
    return {
      error: "Surat Tugas belum diselesaikan. Buka Surat Tugas dan pastikan data persiapan sudah valid sebelum scan kunci dan pengajuan.",
      status: 409,
    }
  }

  // Defense-in-depth: hash surat yang tersimpan harus identik dengan snapshot
  // Work Order terkini. payload_valid hanya membuktikan payload surat tidak
  // berubah terhadap hash miliknya sendiri, bukan bahwa WO belum diedit.
  const currentSnapshot = await buildAssignmentLetterSnapshot(
    executor,
    workOrderId,
    scopeCodeUker,
    { allowPreparatory: true }
  )
  if (currentSnapshot.error) {
    return { error: currentSnapshot.error, status: 409 }
  }
  if (String(currentSnapshot.documentHash || "") !== String(letter.document_hash || "")) {
    return {
      error: "Surat Tugas sudah tidak sesuai dengan Work Order terbaru. Buka kembali Surat Tugas agar snapshot diperbarui sebelum pengajuan.",
      status: 409,
    }
  }

  return {
    error: null,
    letterId: Number(letter.id),
    letterNo: letter.letter_no,
    documentHash: letter.document_hash,
  }
}

export async function GET(request, context) {
  const resource = requestedResource(request)
  if (resource === "key-handover") return getKeyHandoverResource(request, context)
  if (resource === "key-handover-pdf") return getKeyHandoverPdfResource(request, context)
  if (resource === "surat-tugas") return getAssignmentLetterResource(request, context)
  if (resource === "surat-tugas-pdf") return getAssignmentLetterPdfResource(request, context)

  const authorization = await authorizeTransaction(request, "view")
  if (!authorization.authorized) return authorization.response

  const { id } = await context.params
  const workOrderId = normalizeId(id)
  if (!workOrderId) return errorResponse("ID work order tidak valid.")

  try {
    const scope = getUserDataScope(authorization.user)
    const db = await connectDB()
    const workOrder = await getReplenishWorkOrderDetail(
      db,
      workOrderId,
      scope.isSuperAdmin ? null : scope.codeUker
    )

    if (!workOrder) return errorResponse("Work order tidak ditemukan.", 404)

    return NextResponse.json({ success: true, data: { work_order: workOrder } })
  } catch (error) {
    return internalError(error, "Gagal mengambil detail work order replenish.")
  }
}

export async function POST(request, context) {
  const resource = requestedResource(request)
  if (resource === "key-handover") return postKeyHandoverResource(request, context)
  if (resource === "surat-tugas-pdf") return postAssignmentLetterPdfResource(request, context)
  return errorResponse("Resource replenish tidak ditemukan.", 404)
}

export async function PUT(request, context) {
  const authorization = await authorizeTransaction(request, "update")
  if (!authorization.authorized) return authorization.response

  const { id } = await context.params
  const workOrderId = normalizeId(id)
  if (!workOrderId) return errorResponse("ID work order tidak valid.")

  const parsedBody = await readBody(request)
  if (parsedBody.response) return parsedBody.response

  const validation = validateReplenishPayload(parsedBody.body)
  if (validation.error) return errorResponse(validation.error)

  const db = await connectDB()
  const transaction = new sql.Transaction(db)
  let finished = false

  try {
    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED)
    const scope = getUserDataScope(authorization.user)
    const current = await getLockedWorkOrder(
      transaction,
      workOrderId,
      scope.isSuperAdmin ? null : scope.codeUker
    )

    if (!current) {
      await transaction.rollback()
      finished = true
      return errorResponse("Work order tidak ditemukan.", 404)
    }

    if (!["DRAFT", "DITOLAK"].includes(current.status)) {
      await transaction.rollback()
      finished = true
      return errorResponse(
        "Work order hanya dapat diubah saat berstatus Draft atau Ditolak.",
        409
      )
    }

    if (!scope.isSuperAdmin && current.created_by !== authorization.user.id) {
      await transaction.rollback()
      finished = true
      return errorResponse("Hanya pembuat work order yang dapat mengubah draft ini.", 403)
    }

    // Proses edit tidak mempercayai representasi row_version dari browser.
    // Baris telah dikunci menggunakan UPDLOCK + HOLDLOCK dalam transaksi
    // Row lock terarah memastikan token binary aktual dari SQL Server dapat dipakai
    // langsung untuk UPDATE tanpa konversi hex/Buffer di frontend.
    const lockedRowVersion = normalizeBinaryRowVersion(current.row_version)
    if (!lockedRowVersion) {
      await transaction.rollback()
      finished = true
      return errorResponse(
        "Token versi work order pada database tidak valid. Pastikan kolom row_version bertipe ROWVERSION.",
        500
      )
    }

    const resolved = await resolveReplenishUker(
      transaction,
      scope,
      validation.data.ukerId
    )
    if (resolved.error) {
      await transaction.rollback()
      finished = true
      return errorResponse(resolved.error, scope.isSuperAdmin ? 400 : 403)
    }

    const referenceValidation = await validateReplenishReferences(
      transaction,
      validation.data,
      resolved.uker.id,
      workOrderId
    )
    if (referenceValidation.error) {
      await transaction.rollback()
      finished = true
      return errorResponse(referenceValidation.error, 409)
    }

    const transactionData = {
      ...validation.data,
      points: referenceValidation.points,
    }
    const totalRequestedAmount = calculateRequestedAmount(transactionData.points)
    const updateResult = await new sql.Request(transaction)
      .input("workOrderId", sql.BigInt, workOrderId)
      .input("rowVersion", sql.Binary(8), lockedRowVersion)
      .input("ukerId", sql.BigInt, resolved.uker.id)
      .input("activityType", sql.VarChar(20), validation.data.activityType)
      .input("scheduleDate", sql.VarChar(10), validation.data.scheduleDate)
      .input("departureTime", sql.VarChar(5), validation.data.departureTime)
      .input("estimatedFinishTime", sql.VarChar(5), validation.data.estimatedFinishTime)
      .input("priority", sql.VarChar(10), validation.data.priority)
      .input("vehicleId", sql.BigInt, validation.data.vehicleId)
      .input("escortName", sql.NVarChar(200), validation.data.escortName)
      .input("totalPoints", sql.SmallInt, validation.data.points.length)
      .input("totalRequestedAmount", sql.Decimal(19, 2), totalRequestedAmount)
      .input("routeNotes", sql.NVarChar(1000), validation.data.routeNotes)
      .input("notes", sql.NVarChar(1000), validation.data.notes)
      .query(`
        UPDATE dbo.replenish_work_orders
        SET
          uker_id = @ukerId,
          activity_type = @activityType,
          schedule_date = CONVERT(DATE, @scheduleDate, 23),
          departure_time = CONVERT(TIME(0), @departureTime),
          estimated_finish_time = CONVERT(TIME(0), @estimatedFinishTime),
          priority = @priority,
          vehicle_id = @vehicleId,
          escort_name = @escortName,
          total_points = @totalPoints,
          total_requested_amount = @totalRequestedAmount,
          route_notes = @routeNotes,
          notes = @notes,
          status = 'DRAFT',
          rejection_reason = NULL,
          approved_by = NULL,
          approved_at = NULL,
          updated_at = SYSDATETIME()
        WHERE id = @workOrderId
          AND row_version = @rowVersion;

        SELECT @@ROWCOUNT AS affected_rows;
      `)

    if (Number(updateResult.recordset[0]?.affected_rows || 0) !== 1) {
      await transaction.rollback()
      finished = true
      return errorResponse(
        "Data work order telah berubah. Muat ulang sebelum menyimpan kembali.",
        409
      )
    }

    // Perubahan detail membatalkan hasil scan/cetak serah terima sebelumnya.
    // Struktur tabel tetap sama; hanya state handover yang dikosongkan.
    await resetReplenishKeyHandover(transaction, workOrderId, authorization.user.id)
    await replaceWorkOrderDetails(transaction, workOrderId, transactionData)

    // Setiap edit WO langsung membentuk ulang snapshot Surat Tugas persiapan
    // di transaksi yang sama. Dengan demikian surat lama tidak dapat tetap
    // terlihat valid setelah jadwal, tim, kendaraan, atau titik ATM berubah.
    const refreshedAssignmentLetter = await createPendingAssignmentLetter(transaction, {
      workOrderId,
      scopeCodeUker: scope.isSuperAdmin ? null : scope.codeUker,
    })

    await new sql.Request(transaction)
      .input("workOrderId", sql.BigInt, workOrderId)
      .input("fromStatus", sql.VarChar(40), current.status)
      .input("actorUserId", sql.Int, authorization.user.id)
      .query(`
        INSERT INTO dbo.replenish_status_history
          (work_order_id, from_status, to_status, action, notes, actor_user_id)
        VALUES
          (@workOrderId, @fromStatus, 'DRAFT', 'UPDATE', 'Draft work order diperbarui.', @actorUserId);
      `)

    await insertAuditLog(transaction, {
      request,
      userId: authorization.user.id,
      action: "UPDATE",
      module: "transactions.replenish",
      entityType: "replenish_work_order",
      entityId: workOrderId,
      metadata: {
        work_order_no: current.work_order_no,
        previous_status: current.status,
        total_points: validation.data.points.length,
        total_requested_amount: totalRequestedAmount,
        escort_name: validation.data.escortName,
        assignment_letter_document_hash: refreshedAssignmentLetter.documentHash,
        assignment_letter_refreshed: !refreshedAssignmentLetter.unchanged,
      },
    })

    await transaction.commit()
    finished = true

    const updated = await getReplenishWorkOrderDetail(
      db,
      workOrderId,
      scope.isSuperAdmin ? null : scope.codeUker
    )

    return NextResponse.json(
      {
        success: true,
        message: `Work order ${current.work_order_no} berhasil diperbarui.`,
        data: {
          work_order: updated,
          update_protocol: "SERVER_LOCKED_V3",
        },
      },
      {
        headers: {
          "X-Replenish-Update-Protocol": "SERVER_LOCKED_V3",
        },
      }
    )
  } catch (error) {
    if (!finished) {
      try {
        await transaction.rollback()
      } catch {
        // SQL Server mungkin telah membatalkan transaksi.
      }
    }
    return internalError(error, "Gagal memperbarui work order replenish.")
  }
}

export async function PATCH(request, context) {
  if (requestedResource(request) === "surat-tugas-pdf") {
    return patchAssignmentLetterPdfResource(request, context)
  }

  // Pastikan pengguna memiliki akses modul sebelum membaca payload aksi.
  const viewAuthorization = await authorizeTransaction(request, "view")
  if (!viewAuthorization.authorized) return viewAuthorization.response

  const { id } = await context.params
  const workOrderId = normalizeId(id)
  if (!workOrderId) return errorResponse("ID work order tidak valid.")

  const parsedBody = await readBody(request)
  if (parsedBody.response) return parsedBody.response

  const action = normalizeReplenishAction(parsedBody.body.action)
  const reason = normalizeRejectionReason(parsedBody.body.reason)

  if (!Object.values(REPLENISH_ACTIONS).includes(action)) {
    return errorResponse("Aksi work order tidak valid.")
  }

  // SUBMIT dan CANCEL merupakan lifecycle work order milik maker. Pada database
  // legacy, role Admin CRO kadang hanya memiliki can_create tanpa can_update.
  // Ownership dan status tetap divalidasi di bawah, sehingga fallback create
  // tidak memberi hak untuk memproses transaksi milik pengguna lain.
  const makerLifecycleAction = [
    REPLENISH_ACTIONS.SUBMIT,
    REPLENISH_ACTIONS.CANCEL,
  ].includes(action)
  const authorization = makerLifecycleAction
    ? await authorizeTransactionAny(request, ["update", "create"])
    : await authorizeTransaction(request, "update")

  if (!authorization.authorized) return authorization.response

  if (action === REPLENISH_ACTIONS.REJECT && !reason) {
    return errorResponse("Alasan penolakan wajib diisi.")
  }

  const db = await connectDB()
  const transaction = new sql.Transaction(db)
  let finished = false

  try {
    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED)
    const scope = getUserDataScope(authorization.user)
    const current = await getLockedWorkOrder(
      transaction,
      workOrderId,
      scope.isSuperAdmin ? null : scope.codeUker
    )

    if (!current) {
      await transaction.rollback()
      finished = true
      return errorResponse("Work order tidak ditemukan.", 404)
    }

    // Aksi lifecycle (submit/approve/reject/cancel) tidak bergantung pada token
    // row_version dari browser. Baris sudah dikunci dengan UPDLOCK + HOLDLOCK
    // dalam transaksi dengan row lock terarah, lalu token binary aktual dari SQL Server
    // dipakai langsung untuk UPDATE. Ini menghindari perbedaan representasi
    // Buffer/hex/JSON tanpa menghilangkan proteksi terhadap perubahan bersamaan.
    const lockedRowVersion = normalizeBinaryRowVersion(current.row_version)
    if (!lockedRowVersion) {
      await transaction.rollback()
      finished = true
      return errorResponse(
        "Token versi work order pada database tidak valid. Pastikan kolom row_version bertipe ROWVERSION.",
        500
      )
    }

    let targetStatus
    let historyNotes
    let approvedAt = null

    if (action === REPLENISH_ACTIONS.APPROVE) {
      const approvalClock = await new sql.Request(transaction).query(`
        SELECT CAST(SYSDATETIME() AS DATETIME2(0)) AS approved_at;
      `)
      approvedAt = approvalClock.recordset[0]?.approved_at || null
      if (!approvedAt) {
        await transaction.rollback()
        finished = true
        return errorResponse("Waktu persetujuan dari database tidak tersedia.", 500)
      }
    }

    if (action === REPLENISH_ACTIONS.SUBMIT) {
      if (!["DRAFT", "DITOLAK"].includes(current.status)) {
        await transaction.rollback()
        finished = true
        return errorResponse("Work order tidak dapat diajukan dari status saat ini.", 409)
      }
      if (!scope.isSuperAdmin && current.created_by !== authorization.user.id) {
        await transaction.rollback()
        finished = true
        return errorResponse("Hanya pembuat work order yang dapat mengajukan persetujuan. Pada alur Replenish, proses ini merupakan tugas Admin CRO.", 403)
      }

      const assignmentLetterVerification = await validateAssignmentLetterReadyForSubmit(
        transaction,
        workOrderId,
        scope.isSuperAdmin ? null : scope.codeUker
      )
      if (assignmentLetterVerification.error) {
        await transaction.rollback()
        finished = true
        return errorResponse(
          assignmentLetterVerification.error,
          assignmentLetterVerification.status || 409
        )
      }

      const keyVerification = await validateReplenishKeyHandoverForSubmit(
        transaction,
        workOrderId
      )
      if (keyVerification.error) {
        await transaction.rollback()
        finished = true
        return errorResponse(keyVerification.error, keyVerification.status || 409)
      }

      targetStatus = "MENUNGGU_PERSETUJUAN_TIM"
      historyNotes = `Work order diajukan setelah Surat Tugas ${assignmentLetterVerification.letterNo} selesai disiapkan dan ${keyVerification.scanned} kunci berhasil diverifikasi.`
    } else if (
      action === REPLENISH_ACTIONS.APPROVE ||
      action === REPLENISH_ACTIONS.REJECT
    ) {
      if (!isReplenishTeamApprover(authorization.user)) {
        await transaction.rollback()
        finished = true
        return errorResponse(
          "Persetujuan Work Order hanya dapat diproses oleh Manager Operasional, Asisten Manager CRO, atau Super Admin.",
          403
        )
      }
      if (current.created_by === authorization.user.id) {
        await transaction.rollback()
        finished = true
        return errorResponse("Pembuat work order tidak boleh menyetujui atau menolak transaksinya sendiri.", 403)
      }
      if (current.status !== "MENUNGGU_PERSETUJUAN_TIM") {
        await transaction.rollback()
        finished = true
        return errorResponse("Work order tidak sedang menunggu persetujuan tim.", 409)
      }
      targetStatus = action === REPLENISH_ACTIONS.APPROVE ? "DISETUJUI" : "DITOLAK"
      historyNotes = action === REPLENISH_ACTIONS.APPROVE
        ? "Komposisi tim dan jadwal disetujui."
        : reason
    } else {
      if (current.status === "MENUNGGU_PERSETUJUAN_TIM") {
        await transaction.rollback()
        finished = true
        return errorResponse(
          "Work order yang sudah diajukan tidak dapat dibatalkan oleh Admin CRO. Tunggu keputusan Manager Operasional atau Asisten Manager CRO.",
          409
        )
      }
      if (!REPLENISH_MAKER_CANCELLABLE_STATUSES.includes(current.status)) {
        await transaction.rollback()
        finished = true
        return errorResponse("Work order tidak dapat dibatalkan dari status saat ini.", 409)
      }
      if (!scope.isSuperAdmin && current.created_by !== authorization.user.id) {
        await transaction.rollback()
        finished = true
        return errorResponse("Hanya pembuat work order yang dapat membatalkan transaksi ini.", 403)
      }
      targetStatus = "DIBATALKAN"
      historyNotes = reason || "Work order dibatalkan."
    }

    const updateResult = await new sql.Request(transaction)
      .input("workOrderId", sql.BigInt, workOrderId)
      .input("rowVersion", sql.Binary(8), lockedRowVersion)
      .input("targetStatus", sql.VarChar(40), targetStatus)
      .input("action", sql.VarChar(30), action)
      .input("reason", sql.NVarChar(1000), reason)
      .input("actorUserId", sql.Int, authorization.user.id)
      .input("approvedAt", sql.DateTime2(0), approvedAt)
      .query(`
        UPDATE dbo.replenish_work_orders
        SET
          status = @targetStatus,
          submitted_by = CASE WHEN @action = 'SUBMIT' THEN @actorUserId ELSE submitted_by END,
          submitted_at = CASE WHEN @action = 'SUBMIT' THEN SYSDATETIME() ELSE submitted_at END,
          approved_by = CASE WHEN @action = 'APPROVE' THEN @actorUserId ELSE approved_by END,
          approved_at = CASE WHEN @action = 'APPROVE' THEN @approvedAt ELSE approved_at END,
          rejection_reason = CASE
            WHEN @action = 'REJECT' THEN @reason
            WHEN @action IN ('SUBMIT', 'APPROVE') THEN NULL
            ELSE rejection_reason
          END,
          cancelled_by = CASE WHEN @action = 'CANCEL' THEN @actorUserId ELSE cancelled_by END,
          cancelled_at = CASE WHEN @action = 'CANCEL' THEN SYSDATETIME() ELSE cancelled_at END,
          updated_at = SYSDATETIME()
        WHERE id = @workOrderId
          AND row_version = @rowVersion;

        SELECT @@ROWCOUNT AS affected_rows;
      `)

    if (Number(updateResult.recordset[0]?.affected_rows || 0) !== 1) {
      await transaction.rollback()
      finished = true
      return errorResponse(
        "Status work order telah berubah. Muat ulang sebelum memproses kembali.",
        409
      )
    }

    if (action === REPLENISH_ACTIONS.CANCEL) {
      await resetReplenishKeyHandover(
        transaction,
        workOrderId,
        authorization.user.id
      )
    }

    await new sql.Request(transaction)
      .input("workOrderId", sql.BigInt, workOrderId)
      .input("fromStatus", sql.VarChar(40), current.status)
      .input("toStatus", sql.VarChar(40), targetStatus)
      .input("action", sql.VarChar(30), action)
      .input("notes", sql.NVarChar(1000), historyNotes)
      .input("actorUserId", sql.Int, authorization.user.id)
      .query(`
        INSERT INTO dbo.replenish_status_history
          (work_order_id, from_status, to_status, action, notes, actor_user_id)
        VALUES
          (@workOrderId, @fromStatus, @toStatus, @action, @notes, @actorUserId);
      `)

    let generatedAssignmentLetter = null
    let approvedKeyHandover = null
    if (action === REPLENISH_ACTIONS.APPROVE) {
      generatedAssignmentLetter = await createApprovedAssignmentLetter(transaction, {
        workOrderId,
        approvedBy: authorization.user.id,
        approvedAt,
        scopeCodeUker: scope.isSuperAdmin ? null : scope.codeUker,
      })
      approvedKeyHandover = await freezeApprovedKeyHandover(transaction, {
        workOrderId,
        approvedBy: authorization.user.id,
        approvedAt,
      })

      await insertAuditLog(transaction, {
        request,
        userId: authorization.user.id,
        action: "AUTO_GENERATE",
        module: "transactions.replenish.surat-tugas",
        entityType: "replenish_assignment_letter",
        entityId: generatedAssignmentLetter.id,
        metadata: {
          work_order_id: workOrderId,
          work_order_no: current.work_order_no,
          letter_no: generatedAssignmentLetter.letterNo,
          document_hash: generatedAssignmentLetter.documentHash,
          approval_hash: generatedAssignmentLetter.approvalHash,
          source: "WORK_ORDER_FINAL_APPROVAL",
        },
      })

      await insertAuditLog(transaction, {
        request,
        userId: authorization.user.id,
        action: "AUTO_GENERATE_QR",
        module: "transactions.replenish.key-handover",
        entityType: "replenish_key_handover",
        entityId: approvedKeyHandover.id,
        metadata: {
          work_order_id: workOrderId,
          work_order_no: current.work_order_no,
          giver_name: approvedKeyHandover.giver_name_snapshot,
          giver_position: approvedKeyHandover.giver_position_snapshot,
          recipient_name: approvedKeyHandover.recipient_name_snapshot,
          recipient_position: approvedKeyHandover.recipient_position_snapshot,
          source: "WORK_ORDER_FINAL_APPROVAL",
        },
      })
    }

    await insertAuditLog(transaction, {
      request,
      userId: authorization.user.id,
      action,
      module: "transactions.replenish",
      entityType: "replenish_work_order",
      entityId: workOrderId,
      metadata: {
        work_order_no: current.work_order_no,
        from_status: current.status,
        to_status: targetStatus,
        reason,
      },
    })

    await transaction.commit()
    finished = true

    const updated = await getReplenishWorkOrderDetail(
      db,
      workOrderId,
      scope.isSuperAdmin ? null : scope.codeUker
    )

    return NextResponse.json(
      {
        success: true,
        message: action === REPLENISH_ACTIONS.APPROVE
          ? `Work Order ${current.work_order_no} berhasil disetujui. QR Surat Tugas dan Serah Terima Kunci telah terbentuk otomatis.`
          : `Status ${current.work_order_no} berhasil diubah menjadi ${targetStatus}.`,
        data: {
          work_order: updated,
          assignment_letter: generatedAssignmentLetter,
          key_handover_approval: approvedKeyHandover,
          action_protocol: "SERVER_LOCKED_V2",
        },
      },
      {
        headers: {
          "X-Replenish-Action-Protocol": "SERVER_LOCKED_V2",
        },
      }
    )
  } catch (error) {
    if (!finished) {
      try {
        await transaction.rollback()
      } catch {
        // SQL Server mungkin telah membatalkan transaksi.
      }
    }
    return internalError(error, "Gagal memproses status work order replenish.")
  }
}
