import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { runInTransaction, isRetryableSqlError } from "@/lib/database/transaction"
import { readJsonBody, InvalidJsonBodyError, RequestBodyTooLargeError } from "@/lib/http/json-body"
import { connectDB, sql } from "@/lib/mssql"
import { insertAuditLog } from "@/lib/security/audit-log"
import { CPC_MENU_HREF } from "@/modules/cpc/constants"
import {
  ensureCpcCassetteHandover,
  getCpcCassetteRequestDetail,
  getLockedCpcCassetteHandover,
  getLockedCpcPackingBatch,
  getLockedCpcWorkOrder,
  resolveCpcScope,
} from "@/modules/cpc/database"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 128 * 1024
const MAX_ITEMS = 200

class CpcHandoverError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = "CpcHandoverError"
    this.status = status
  }
}

function normalizeId(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeCode(value, maxLength = 100) {
  const normalized = String(value || "").trim().toUpperCase()
  return normalized ? normalized.slice(0, maxLength) : null
}

function sqlErrorNumber(error) {
  return Number(error?.number || error?.originalError?.info?.number || error?.precedingErrors?.[0]?.number || 0)
}

function errorResponse(message, status = 400) {
  return NextResponse.json({ success: false, message }, { status })
}

function internalError(error, fallbackMessage) {
  console.error(fallbackMessage, error)
  if (isRetryableSqlError(error)) {
    return NextResponse.json(
      { success: false, message: "Serah terima kaset sedang diproses pengguna lain. Coba kembali beberapa saat lagi." },
      { status: 503, headers: { "Retry-After": "1" } }
    )
  }
  const number = sqlErrorNumber(error)
  if (number === 2601 || number === 2627) {
    return errorResponse("Nomor segel tidak boleh discan ke lebih dari satu kaset.", 409)
  }
  if ([54010, 54012].includes(number)) return errorResponse("Packing CPC belum siap untuk serah terima.", 409)
  if (number === 54011) return errorResponse("Custody penerima belum ditetapkan pada Work Order.", 409)
  return errorResponse(fallbackMessage, 500)
}

function validatePayloadItems(rawItems, expectedItems) {
  if (!Array.isArray(rawItems)) throw new CpcHandoverError("Daftar verifikasi kaset wajib dikirim.")
  if (rawItems.length > MAX_ITEMS) throw new CpcHandoverError(`Maksimal ${MAX_ITEMS} kaset per Work Order.`, 413)
  if (rawItems.length !== expectedItems.length) {
    throw new CpcHandoverError("Jumlah kaset berubah. Muat ulang form serah terima sebelum menyimpan.", 409)
  }

  const expectedByPackingId = new Map(expectedItems.map((item) => [Number(item.packing_cassette_id), item]))
  const seenIds = new Set()
  const seenScans = new Set()

  return rawItems.map((rawItem) => {
    const packingCassetteId = normalizeId(rawItem?.packing_cassette_id)
    const expected = expectedByPackingId.get(packingCassetteId)
    if (!packingCassetteId || !expected || seenIds.has(packingCassetteId)) {
      throw new CpcHandoverError("Kaset pada form serah terima tidak valid. Muat ulang form.", 409)
    }
    seenIds.add(packingCassetteId)

    const scannedSealNo = normalizeCode(rawItem?.scanned_seal_no)
    if (scannedSealNo) {
      if (seenScans.has(scannedSealNo)) {
        throw new CpcHandoverError(`Nomor segel ${scannedSealNo} discan lebih dari satu kali.`)
      }
      seenScans.add(scannedSealNo)
      if (scannedSealNo !== String(expected.expected_seal_no || "").trim().toUpperCase()) {
        throw new CpcHandoverError(
          `Nomor segel ${scannedSealNo} tidak sesuai dengan segel packing Kaset ${expected.cassette_no}.`,
          409
        )
      }
    }

    return {
      handoverItemId: Number(expected.id),
      packingCassetteId,
      scannedSealNo,
    }
  })
}

export async function PUT(request, context) {
  const authorization = await authorizeApiRequest(request, CPC_MENU_HREF, "update")
  if (!authorization.authorized) return authorization.response

  const { id } = await context.params
  const workOrderId = normalizeId(id)
  if (!workOrderId) return errorResponse("ID work order tidak valid.")

  let body
  try {
    body = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return errorResponse("Data serah terima terlalu besar.", 413)
    if (error instanceof InvalidJsonBodyError) return errorResponse(error.message, 400)
    return internalError(error, "Gagal membaca data serah terima kaset.")
  }

  const notes = String(body?.notes || "").trim().slice(0, 1000)
  const db = await connectDB()
  const scope = getUserDataScope(authorization.user)

  try {
    const resolvedScope = await resolveCpcScope(db, scope)
    if (resolvedScope.error) return errorResponse(resolvedScope.error, 403)

    const result = await runInTransaction(db, async (transaction) => {
      const workOrder = await getLockedCpcWorkOrder(transaction, workOrderId, resolvedScope.codeUker)
      if (!workOrder) throw new CpcHandoverError("Permintaan CPC tidak ditemukan.", 404)
      if (workOrder.status !== "KASET_SIAP") {
        throw new CpcHandoverError("Scan serah terima hanya dapat dilakukan saat status KASET_SIAP.", 409)
      }

      const packing = await getLockedCpcPackingBatch(transaction, workOrderId)
      if (!packing?.batch || packing.batch.status !== "DISETUJUI" || !packing.summary.all_complete) {
        throw new CpcHandoverError("Packing belum disetujui atau belum lengkap.", 409)
      }

      await ensureCpcCassetteHandover(transaction, workOrderId, authorization.user.id)
      const handover = await getLockedCpcCassetteHandover(transaction, workOrderId)
      if (!handover?.handover) throw new CpcHandoverError("Form serah terima kaset tidak dapat dibentuk.", 500)
      if (handover.handover.status !== "VERIFIKASI") {
        throw new CpcHandoverError("Serah terima kaset sudah diselesaikan dan tidak dapat diubah.", 409)
      }

      const items = validatePayloadItems(body?.items, handover.items)
      const updateRequest = new sql.Request(transaction)
        .input("handoverId", sql.BigInt, handover.handover.id)
        .input("userId", sql.Int, authorization.user.id)

      const values = items.map((item, index) => {
        updateRequest.input(`id${index}`, sql.BigInt, item.handoverItemId)
        updateRequest.input(`scan${index}`, sql.VarChar(100), item.scannedSealNo)
        return `(@id${index}, @scan${index})`
      })

      await updateRequest.query(`
        UPDATE handover_item
        SET
          scanned_seal_no = source.scanned_seal_no,
          verified_by = CASE WHEN source.scanned_seal_no IS NULL THEN NULL ELSE @userId END,
          verified_at = CASE
            WHEN source.scanned_seal_no IS NULL THEN NULL
            WHEN handover_item.scanned_seal_no = source.scanned_seal_no AND handover_item.verified_at IS NOT NULL THEN handover_item.verified_at
            ELSE SYSDATETIME()
          END,
          updated_at = SYSDATETIME()
        FROM dbo.cpc_cassette_handover_items handover_item
        INNER JOIN (VALUES ${values.join(",\n")}) source(id, scanned_seal_no)
          ON source.id = handover_item.id
        WHERE handover_item.handover_id = @handoverId;
      `)

      await new sql.Request(transaction)
        .input("handoverId", sql.BigInt, handover.handover.id)
        .input("notes", sql.NVarChar(1000), notes || null)
        .query(`
          UPDATE dbo.cpc_cassette_handovers
          SET handover_notes = COALESCE(@notes, handover_notes), updated_at = SYSDATETIME()
          WHERE id = @handoverId AND status = 'VERIFIKASI';
        `)

      const refreshed = await getLockedCpcCassetteHandover(transaction, workOrderId)

      await insertAuditLog(transaction, {
        request,
        userId: authorization.user.id,
        action: "CPC_SAVE_CASSETTE_HANDOVER_SCAN",
        module: "transactions.cpc",
        entityType: "cpc_cassette_handover",
        entityId: handover.handover.id,
        metadata: {
          work_order_id: workOrderId,
          work_order_no: workOrder.work_order_no,
          custody_employee_id: refreshed.handover?.custody_employee_id || null,
          expected_cassettes: refreshed.summary.expected_cassettes,
          verified_cassettes: refreshed.summary.verified_cassettes,
        },
      })

      return refreshed.summary
    }, {
      isolationLevel: sql.ISOLATION_LEVEL.READ_COMMITTED,
      maxRetries: 2,
    })

    const detail = await getCpcCassetteRequestDetail(db, workOrderId, resolvedScope.codeUker)
    return NextResponse.json({
      success: true,
      message: `Verifikasi serah terima tersimpan: ${result.verified_cassettes}/${result.expected_cassettes} kaset sesuai.`,
      data: { request: detail },
    })
  } catch (error) {
    if (error instanceof CpcHandoverError) return errorResponse(error.message, error.status)
    return internalError(error, "Gagal menyimpan scan serah terima kaset.")
  }
}
