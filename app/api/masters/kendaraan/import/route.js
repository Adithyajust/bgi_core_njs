import { NextResponse } from "next/server"

import {
  authorizeApiRequest,
  getUserDataScope,
} from "@/lib/access-control"
import { connectDB, sql } from "@/lib/mssql"
import {
  InvalidJsonBodyError,
  readJsonBody,
  RequestBodyTooLargeError,
} from "@/lib/http/json-body"
import { writeAuditLog } from "@/lib/security/audit-log"
import {
  MAX_VEHICLE_IMPORT_REQUEST_BYTES,
  MAX_VEHICLE_IMPORT_ROWS,
  validateVehicleImportRows,
} from "@/modules/master-kendaraan/import-validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_RETURNED_ERRORS = 100

function createErrorResponse(message, status = 400, extra = {}) {
  return NextResponse.json(
    {
      success: false,
      message,
      ...extra,
    },
    { status }
  )
}

function getSqlErrorNumber(error) {
  return (
    error?.number ||
    error?.originalError?.info?.number ||
    error?.precedingErrors?.[0]?.number ||
    null
  )
}

function getServerErrorMessage(error) {
  return (
    error?.originalError?.info?.message ||
    error?.precedingErrors?.[0]?.message ||
    error?.message ||
    "Kesalahan server tidak diketahui."
  )
}

function createInternalErrorResponse(error, fallbackMessage) {
  const isDevelopment = process.env.NODE_ENV !== "production"

  return createErrorResponse(
    isDevelopment
      ? `${fallbackMessage} Detail: ${getServerErrorMessage(error)}`
      : fallbackMessage,
    500,
    isDevelopment
      ? {
          error_code: error?.code || null,
          sql_error_number: getSqlErrorNumber(error),
        }
      : {}
  )
}

function resolveDataScope(authorization) {
  const scope = getUserDataScope(authorization.user)

  if (!scope.isSuperAdmin && !scope.codeUker) {
    return {
      scope: null,
      response: createErrorResponse(
        "Akun Anda belum terhubung dengan unit kerja.",
        403
      ),
    }
  }

  return { scope, response: null }
}

async function getUkerByCode(db, codeUker) {
  const result = await db
    .request()
    .input("codeUker", sql.NVarChar(4), codeUker)
    .query(`
      SELECT TOP 1
        id,
        codeuker,
        nama_uker
      FROM dbo.master_uker
      WHERE UPPER(LTRIM(RTRIM(codeuker))) = UPPER(LTRIM(RTRIM(@codeUker)));
    `)

  return result.recordset[0] || null
}

async function getUkersByCodes(db, codes) {
  if (codes.length === 0) return []

  const result = await db
    .request()
    .input("codesJson", sql.NVarChar(sql.MAX), JSON.stringify(codes))
    .query(`
      SELECT DISTINCT
        mu.id,
        mu.codeuker,
        mu.nama_uker
      FROM dbo.master_uker mu
      INNER JOIN OPENJSON(@codesJson) source
        ON UPPER(LTRIM(RTRIM(mu.codeuker))) =
           UPPER(LTRIM(RTRIM(CONVERT(NVARCHAR(4), source.[value]))));
    `)

  return result.recordset
}

async function getExistingVehicleNumbers(db, rows) {
  if (rows.length === 0) return new Set()

  const result = await db
    .request()
    .input("rowsJson", sql.NVarChar(sql.MAX), JSON.stringify(rows))
    .query(`
      SELECT DISTINCT
        UPPER(LTRIM(RTRIM(k.nomor_kendaraan))) AS nomor_kendaraan
      FROM dbo.master_kendaraan k
      INNER JOIN OPENJSON(@rowsJson)
      WITH (
        nomor_kendaraan VARCHAR(20) '$.nomor_kendaraan'
      ) source
        ON UPPER(LTRIM(RTRIM(k.nomor_kendaraan))) = source.nomor_kendaraan;
    `)

  return new Set(result.recordset.map((item) => item.nomor_kendaraan))
}

function buildValidationResponse(rows, errors) {
  const invalidRows = new Set(
    errors
      .map((error) => Number(error.row))
      .filter((row) => Number.isSafeInteger(row) && row > 0)
  ).size

  return createErrorResponse(
    "File masih memiliki data yang tidak valid. Perbaiki baris yang ditandai lalu upload kembali.",
    422,
    {
      data: {
        total_rows: rows.length,
        valid_rows: Math.max(0, rows.length - invalidRows),
        invalid_rows: invalidRows,
        total_errors: errors.length,
        errors: errors.slice(0, MAX_RETURNED_ERRORS),
      },
    }
  )
}

export async function POST(request) {
  const authorization = await authorizeApiRequest(request, "/masters", "create")

  if (!authorization.authorized) {
    return authorization.response
  }

  const scopeResult = resolveDataScope(authorization)
  if (scopeResult.response) return scopeResult.response

  let transaction = null

  try {
    let body

    try {
      body = await readJsonBody(request, {
        maxBytes: MAX_VEHICLE_IMPORT_REQUEST_BYTES,
      })
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return createErrorResponse(
          "Ukuran data upload terlalu besar. Pecah file menjadi beberapa batch.",
          413
        )
      }

      if (error instanceof InvalidJsonBodyError) {
        return createErrorResponse("Format permintaan upload tidak valid.")
      }

      throw error
    }

    if (!Array.isArray(body?.rows)) {
      return createErrorResponse("Data kendaraan untuk upload tidak ditemukan.")
    }

    if (body.rows.length > MAX_VEHICLE_IMPORT_ROWS) {
      return createErrorResponse(
        `Maksimal ${MAX_VEHICLE_IMPORT_ROWS} baris dalam satu kali upload.`
      )
    }

    const scope = scopeResult.scope
    const validation = validateVehicleImportRows(body.rows, {
      isSuperAdmin: scope.isSuperAdmin,
    })
    const normalizedRows = validation.rows
    const errors = [...validation.errors]

    if (normalizedRows.length === 0 || errors.some((error) => error.row === null)) {
      return buildValidationResponse(normalizedRows, errors)
    }

    const db = await connectDB()
    const ukerMap = new Map()

    if (scope.isSuperAdmin) {
      const requestedCodes = Array.from(
        new Set(
          normalizedRows
            .map((row) => row.kode_unit_kerja)
            .filter(Boolean)
        )
      )
      const ukers = await getUkersByCodes(db, requestedCodes)

      ukers.forEach((uker) => {
        ukerMap.set(String(uker.codeuker || "").trim().toUpperCase(), uker)
      })

      normalizedRows.forEach((row) => {
        if (!row.kode_unit_kerja || ukerMap.has(row.kode_unit_kerja)) return

        errors.push({
          row: row._row_number,
          field: "kode_unit_kerja",
          message: `Kode unit kerja ${row.kode_unit_kerja} tidak ditemukan pada Master Unit Kerja.`,
        })
      })
    } else {
      const ownUker = await getUkerByCode(db, scope.codeUker)

      if (!ownUker) {
        return createErrorResponse(
          "Unit kerja akun tidak ditemukan pada Master Unit Kerja.",
          403
        )
      }

      ukerMap.set(String(ownUker.codeuker).trim().toUpperCase(), ownUker)
    }

    const existingNumbers = await getExistingVehicleNumbers(db, normalizedRows)

    normalizedRows.forEach((row) => {
      if (!existingNumbers.has(row.nomor_kendaraan)) return

      errors.push({
        row: row._row_number,
        field: "nomor_kendaraan",
        message: `Nomor kendaraan ${row.nomor_kendaraan} sudah terdaftar.`,
      })
    })

    if (errors.length > 0) {
      return buildValidationResponse(normalizedRows, errors)
    }

    const ownUker = scope.isSuperAdmin
      ? null
      : ukerMap.get(String(scope.codeUker).trim().toUpperCase())
    const insertRows = normalizedRows.map((row) => {
      const uker = scope.isSuperAdmin ? ukerMap.get(row.kode_unit_kerja) : ownUker

      return {
        row_number: row._row_number,
        uker_id: Number(uker.id),
        codeuker: String(uker.codeuker),
        jenis_kendaraan: row.jenis_kendaraan,
        merk_kendaraan: row.merk_kendaraan,
        nomor_kendaraan: row.nomor_kendaraan,
        status: row.status,
      }
    })

    transaction = new sql.Transaction(db)
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)

    const insertResult = await new sql.Request(transaction)
      .input("rowsJson", sql.NVarChar(sql.MAX), JSON.stringify(insertRows))
      .query(`
        DECLARE @source TABLE (
          row_number INT NOT NULL,
          uker_id BIGINT NOT NULL,
          jenis_kendaraan VARCHAR(10) NOT NULL,
          merk_kendaraan NVARCHAR(100) NOT NULL,
          nomor_kendaraan VARCHAR(20) NOT NULL,
          status VARCHAR(10) NOT NULL
        );

        INSERT INTO @source (
          row_number,
          uker_id,
          jenis_kendaraan,
          merk_kendaraan,
          nomor_kendaraan,
          status
        )
        SELECT
          row_number,
          uker_id,
          jenis_kendaraan,
          merk_kendaraan,
          nomor_kendaraan,
          status
        FROM OPENJSON(@rowsJson)
        WITH (
          row_number INT '$.row_number',
          uker_id BIGINT '$.uker_id',
          jenis_kendaraan VARCHAR(10) '$.jenis_kendaraan',
          merk_kendaraan NVARCHAR(100) '$.merk_kendaraan',
          nomor_kendaraan VARCHAR(20) '$.nomor_kendaraan',
          status VARCHAR(10) '$.status'
        );

        IF EXISTS (
          SELECT 1
          FROM dbo.master_kendaraan k WITH (UPDLOCK, HOLDLOCK)
          INNER JOIN @source source
            ON UPPER(LTRIM(RTRIM(k.nomor_kendaraan))) = source.nomor_kendaraan
        )
          THROW 51020, 'Terdapat nomor kendaraan yang sudah terdaftar.', 1;

        INSERT INTO dbo.master_kendaraan (
          uker_id,
          jenis_kendaraan,
          merk_kendaraan,
          nomor_kendaraan,
          status,
          created_at,
          updated_at
        )
        SELECT
          source.uker_id,
          source.jenis_kendaraan,
          source.merk_kendaraan,
          source.nomor_kendaraan,
          source.status,
          SYSDATETIME(),
          SYSDATETIME()
        FROM @source source;

        SELECT @@ROWCOUNT AS imported_count;
      `)

    await transaction.commit()
    transaction = null

    const importedCount = Number(
      insertResult.recordset[0]?.imported_count || insertRows.length
    )

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "IMPORT",
      module: "masters.kendaraan",
      entityType: "master_kendaraan",
      entityId: null,
      metadata: {
        imported_count: importedCount,
        unit_codes: Array.from(new Set(insertRows.map((row) => row.codeuker))),
        vehicle_numbers: insertRows
          .slice(0, 25)
          .map((row) => row.nomor_kendaraan),
        vehicle_numbers_truncated: insertRows.length > 25,
      },
    })

    return NextResponse.json(
      {
        success: true,
        message: `${importedCount} data kendaraan berhasil diupload.`,
        data: {
          imported_count: importedCount,
          total_rows: insertRows.length,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback()
      } catch (rollbackError) {
        console.error("Rollback import kendaraan gagal:", rollbackError)
      }
    }

    console.error("POST import master kendaraan error:", error)

    if ([2601, 2627, 51020].includes(getSqlErrorNumber(error))) {
      return createErrorResponse(
        "Upload dibatalkan karena terdapat nomor kendaraan yang sudah terdaftar. Muat ulang data lalu upload kembali.",
        409
      )
    }

    return createInternalErrorResponse(
      error,
      "Gagal mengupload data kendaraan."
    )
  }
}
