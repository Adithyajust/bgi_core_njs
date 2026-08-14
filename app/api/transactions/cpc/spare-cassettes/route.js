import { NextResponse } from "next/server"

import { authorizeApiRequest } from "@/lib/access-control"
import { runInTransaction, isRetryableSqlError } from "@/lib/database/transaction"
import { readJsonBody, InvalidJsonBodyError, RequestBodyTooLargeError } from "@/lib/http/json-body"
import { connectDB, sql } from "@/lib/mssql"
import { insertAuditLog } from "@/lib/security/audit-log"
import {
  CPC_PACKING_SHEETS_PER_CASSETTE,
  CPC_SPARE_CASSETTE_DENOMINATIONS,
  CPC_SPARE_CASSETTE_MENU_HREF,
} from "@/modules/cpc/constants"
import { listCpcSpareCassettes } from "@/modules/cpc/database"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 16 * 1024
const ALLOWED_DENOMINATIONS = new Set(CPC_SPARE_CASSETTE_DENOMINATIONS)

class CpcSpareCassetteError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = "CpcSpareCassetteError"
    this.status = status
  }
}

function normalizeCode(value, maxLength = 100) {
  const normalized = String(value || "").trim().toUpperCase().replaceAll(/\s+/g, "")
  return normalized ? normalized.slice(0, maxLength) : ""
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
      { success: false, message: "Persediaan spare kaset sedang diproses pengguna lain. Coba kembali." },
      { status: 503, headers: { "Retry-After": "1" } }
    )
  }
  if ([2601, 2627].includes(sqlErrorNumber(error))) {
    return errorResponse("Label kaset atau nomor segel karet sudah terdaftar pada kaset lain.", 409)
  }
  return errorResponse(fallbackMessage, 500)
}

export async function GET(request) {
  const authorization = await authorizeApiRequest(request, CPC_SPARE_CASSETTE_MENU_HREF, "view")
  if (!authorization.authorized) return authorization.response

  try {
    const db = await connectDB()
    const inventory = await listCpcSpareCassettes(db)
    return NextResponse.json({ success: true, data: inventory })
  } catch (error) {
    return internalError(error, "Gagal mengambil persediaan spare kaset CPC.")
  }
}

export async function POST(request) {
  const authorization = await authorizeApiRequest(request, CPC_SPARE_CASSETTE_MENU_HREF, "update")
  if (!authorization.authorized) return authorization.response

  let body
  try {
    body = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return errorResponse("Data spare kaset terlalu besar.", 413)
    if (error instanceof InvalidJsonBodyError) return errorResponse(error.message, 400)
    return internalError(error, "Gagal membaca form spare kaset CPC.")
  }

  const cassetteSerial = normalizeCode(body?.cassette_serial, 20)
  const denominationValue = Number(body?.denomination_value)
  const rubberSealNo = normalizeCode(body?.rubber_seal_no)
  if (!cassetteSerial) return errorResponse("Label kaset wajib dipilih atau discan.")
  if (!/^[A-Z0-9][A-Z0-9._/-]{2,19}$/.test(cassetteSerial)) {
    return errorResponse("Format label kaset tidak valid. Gunakan 3-20 karakter huruf, angka, titik, garis miring, tanda minus, atau garis bawah.")
  }
  if (!ALLOWED_DENOMINATIONS.has(denominationValue)) {
    return errorResponse("Pilih denom Rp50.000 atau Rp100.000.")
  }
  if (!rubberSealNo) return errorResponse("Nomor segel karet wajib discan.")
  if (rubberSealNo === cassetteSerial) {
    return errorResponse("Nomor segel karet tidak boleh sama dengan label kaset.")
  }

  try {
    const db = await connectDB()
    const prepared = await runInTransaction(db, async (transaction) => {
      const lockedResult = await new sql.Request(transaction)
        .input("cassetteSerial", sql.VarChar(20), cassetteSerial)
        .query(`
          SELECT TOP (1)
            id,
            cassette_serial,
            denomination_value,
            sheets_count,
            rubber_seal_no,
            status,
            prepared_by,
            prepared_at,
            allocated_packing_cassette_id
          FROM dbo.cpc_spare_cassettes WITH (UPDLOCK, HOLDLOCK)
          WHERE cassette_serial = @cassetteSerial;
        `)

      let spare = lockedResult.recordset[0]
      if (!spare) {
        const insertedResult = await new sql.Request(transaction)
          .input("cassetteSerial", sql.VarChar(20), cassetteSerial)
          .input("denominationValue", sql.Decimal(19, 2), denominationValue)
          .input("sheetsCount", sql.Int, CPC_PACKING_SHEETS_PER_CASSETTE)
          .query(`
            INSERT INTO dbo.cpc_spare_cassettes
              (cassette_serial, denomination_value, sheets_count, status)
            OUTPUT
              INSERTED.id,
              INSERTED.cassette_serial,
              INSERTED.denomination_value,
              INSERTED.sheets_count,
              INSERTED.rubber_seal_no,
              INSERTED.status,
              INSERTED.prepared_by,
              INSERTED.prepared_at,
              INSERTED.allocated_packing_cassette_id
            VALUES
              (@cassetteSerial, @denominationValue, @sheetsCount, 'KOSONG');
          `)
        spare = insertedResult.recordset[0]
      }
      if (spare.status === "ALLOCATED" || spare.allocated_packing_cassette_id) {
        throw new CpcSpareCassetteError("Kaset sedang dipakai pada Work Order RPL dan tidak dapat disortir ulang.", 409)
      }

      const usedSeal = await new sql.Request(transaction)
        .input("spareId", sql.BigInt, spare.id)
        .input("rubberSealNo", sql.VarChar(100), rubberSealNo)
        .query(`
          SELECT TOP (1) source_name
          FROM (
            SELECT 'spare kaset lain' AS source_name
            FROM dbo.cpc_spare_cassettes WITH (UPDLOCK, HOLDLOCK)
            WHERE rubber_seal_no = @rubberSealNo
              AND id <> @spareId

            UNION ALL

            SELECT 'packing Work Order sebelumnya' AS source_name
            FROM dbo.cpc_packing_cassettes WITH (UPDLOCK, HOLDLOCK)
            WHERE seal_no = @rubberSealNo
              AND (spare_cassette_id IS NULL OR spare_cassette_id <> @spareId)
          ) used;
        `)
      if (usedSeal.recordset[0]) {
        throw new CpcSpareCassetteError(
          `Nomor segel karet ${rubberSealNo} sudah digunakan pada ${usedSeal.recordset[0].source_name}.`,
          409
        )
      }

      const historyAction = spare.prepared_at ? "REPREPARED" : "PREPARED"
      await new sql.Request(transaction)
        .input("spareId", sql.BigInt, spare.id)
        .input("rubberSealNo", sql.VarChar(100), rubberSealNo)
        .input("userId", sql.Int, authorization.user.id)
        .input("denominationValue", sql.Decimal(19, 2), denominationValue)
        .input("sheetsCount", sql.Int, CPC_PACKING_SHEETS_PER_CASSETTE)
        .input("historyAction", sql.VarChar(30), historyAction)
        .query(`
          UPDATE dbo.cpc_spare_cassettes
          SET
            denomination_value = @denominationValue,
            sheets_count = @sheetsCount,
            rubber_seal_no = @rubberSealNo,
            status = 'READY',
            prepared_by = @userId,
            prepared_at = SYSDATETIME(),
            allocated_packing_cassette_id = NULL,
            allocated_by = NULL,
            allocated_at = NULL,
            updated_at = SYSDATETIME()
          WHERE id = @spareId;

          INSERT INTO dbo.cpc_spare_cassette_history
            (spare_cassette_id, action, denomination_value, sheets_count, rubber_seal_no, actor_user_id)
          VALUES
            (@spareId, @historyAction, @denominationValue, @sheetsCount, @rubberSealNo, @userId);
        `)

      await insertAuditLog(transaction, {
        request,
        userId: authorization.user.id,
        action: "CPC_PREPARE_SPARE_CASSETTE",
        module: "transactions.cpc",
        entityType: "cpc_spare_cassette",
        entityId: spare.id,
        metadata: {
          cassette_serial: cassetteSerial,
          denomination_value: denominationValue,
          sheets_count: CPC_PACKING_SHEETS_PER_CASSETTE,
          rubber_seal_no: rubberSealNo,
          history_action: historyAction,
        },
      })

      return { historyAction }
    }, {
      isolationLevel: sql.ISOLATION_LEVEL.READ_COMMITTED,
      maxRetries: 2,
    })

    const inventory = await listCpcSpareCassettes(db)
    return NextResponse.json({
      success: true,
      message: `${cassetteSerial} siap dipakai untuk denom ${new Intl.NumberFormat("id-ID").format(denominationValue)} dengan 2.000 lembar. Petugas persiapan tercatat.`,
      data: { ...inventory, action: prepared.historyAction },
    })
  } catch (error) {
    if (error instanceof CpcSpareCassetteError) return errorResponse(error.message, error.status)
    return internalError(error, "Gagal menyimpan persiapan spare kaset CPC.")
  }
}
