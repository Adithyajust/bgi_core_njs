import { readJsonBody } from "@/lib/http/json-body"
import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { connectDB, sql } from "@/lib/mssql"
import { normalizePositiveInteger } from "@/lib/database/pagination"
import { normalizeRowVersionToken } from "@/modules/master-mesin/row-version"
import { writeAuditLog } from "@/lib/security/audit-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function createErrorResponse(message, status = 400, extra = {}) {
  return NextResponse.json(
    { success: false, message, ...extra },
    { status }
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
  const details = getServerErrorMessage(error)
  const isDevelopment = process.env.NODE_ENV !== "production"

  return createErrorResponse(
    isDevelopment ? `${fallbackMessage} Detail: ${details}` : fallbackMessage,
    500,
    isDevelopment
      ? {
          error_code: error?.code || null,
          sql_error_number: getSqlErrorNumber(error),
        }
      : {}
  )
}

function createUkerSchemaErrorResponse(error) {
  const details = getServerErrorMessage(error)

  if (
    getSqlErrorNumber(error) === 207 &&
    /(?:^|[.\s])row_version(?:$|[.\s])/i.test(details)
  ) {
    return createErrorResponse(
      "Struktur database Master Uker belum diperbarui. Jalankan `npm run db:migrate` untuk menerapkan migration 025-add-master-uker-row-version.sql.",
      503,
      process.env.NODE_ENV !== "production"
        ? { migration: "025-add-master-uker-row-version.sql" }
        : {}
    )
  }

  return null
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeNullableText(value) {
  const normalizedValue = normalizeText(value)

  return normalizedValue || null
}

function normalizeEmail(value) {
  const normalizedValue = normalizeText(value).toLowerCase()

  return normalizedValue || null
}

function normalizeCodeUker(value) {
  return normalizeText(value).toUpperCase()
}

function validateMaximumLength(label, value, maximumLength) {
  if (value && value.length > maximumLength) {
    return `${label} maksimal ${maximumLength} karakter.`
  }

  return null
}

function validateEmail(email) {
  if (!email) {
    return null
  }

  if (email.length > 255) {
    return "Email maksimal 255 karakter."
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Format email tidak valid."
  }

  return null
}

function parseOptionalDate(value) {
  const normalizedValue = normalizeText(value)

  if (!normalizedValue) {
    return {
      value: null,
      error: null,
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return {
      value: null,
      error: "Tanggal operasional harus menggunakan format YYYY-MM-DD.",
    }
  }

  const [year, month, day] = normalizedValue.split("-").map(Number)

  const date = new Date(Date.UTC(year, month - 1, day))

  const isValidDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day

  if (!isValidDate) {
    return {
      value: null,
      error: "Tanggal operasional tidak valid.",
    }
  }

  return {
    value: date,
    error: null,
  }
}

function normalizeId(value) {
  const id = Number(value)

  if (!Number.isSafeInteger(id) || id <= 0) {
    return null
  }

  return id
}

function validateUkerPayload(body) {
  const namaUker = normalizeText(body.nama_uker)
  const alamatUker = normalizeNullableText(body.alamat_uker)
  const kota = normalizeNullableText(body.kota)
  const kodePos = normalizeNullableText(body.kode_pos)
  const telpBranch = normalizeNullableText(body.telp_branch)
  const gedungBranch = normalizeNullableText(body.gedung_branch)
  const email = normalizeEmail(body.email)
  const codeUker = normalizeCodeUker(body.codeuker)

  const parsedTanggalOps = parseOptionalDate(body.tanggal_ops)

  if (!namaUker) {
    return {
      error: "Nama unit kerja wajib diisi.",
      data: null,
    }
  }

  if (!codeUker) {
    return {
      error: "Kode unit kerja wajib diisi.",
      data: null,
    }
  }

  const validationErrors = [
    validateMaximumLength("Nama unit kerja", namaUker, 100),
    validateMaximumLength("Alamat unit kerja", alamatUker, 255),
    validateMaximumLength("Kota", kota, 200),
    validateMaximumLength("Kode pos", kodePos, 50),
    validateMaximumLength("Nomor telepon", telpBranch, 255),
    validateMaximumLength("Gedung", gedungBranch, 255),
    validateMaximumLength("Kode unit kerja", codeUker, 4),
    validateEmail(email),
    parsedTanggalOps.error,
  ].filter(Boolean)

  if (validationErrors.length > 0) {
    return {
      error: validationErrors[0],
      data: null,
    }
  }

  return {
    error: null,
    data: {
      namaUker,
      alamatUker,
      kota,
      kodePos,
      telpBranch,
      gedungBranch,
      email,
      tanggalOps: parsedTanggalOps.value,
      codeUker,
    },
  }
}

function getSqlErrorNumber(error) {
  return (
    error?.number ||
    error?.originalError?.info?.number ||
    error?.precedingErrors?.[0]?.number ||
    null
  )
}

async function authorizeMaster(request, action = "view") {
  return authorizeApiRequest(request, "/masters", action)
}

async function getUkerById(db, id, codeUker = null) {
  const result = await db
    .request()
    .input("id", sql.BigInt, id)
    .input("codeUker", sql.NVarChar(4), codeUker)
    .query(`
      SELECT
        id,
        nama_uker,
        alamat_uker,
        kota,
        kode_pos,
        telp_branch,
        gedung_branch,
        email,
        CONVERT(CHAR(10), tanggal_ops, 23) AS tanggal_ops,
        codeuker,
        created_at,
        updated_at,
        CONVERT(VARCHAR(18), CONVERT(VARBINARY(8), row_version), 1) AS row_version
      FROM dbo.master_uker
      WHERE id = @id
        AND (@codeUker IS NULL OR codeuker = @codeUker);
    `)

  const item = result.recordset[0] || null
  return item ? { ...item, row_version: normalizeRowVersionToken(item.row_version) } : null
}

async function isCodeUkerAvailable(db, codeUker, ignoredId = null) {
  const dbRequest = db
    .request()
    .input("codeUker", sql.NVarChar(4), codeUker)

  let query = `
    SELECT TOP 1
      id
    FROM dbo.master_uker
    WHERE UPPER(codeuker) = @codeUker
  `

  if (ignoredId !== null) {
    dbRequest.input("ignoredId", sql.BigInt, ignoredId)
    query += " AND id <> @ignoredId"
  }

  query += ";"

  const result = await dbRequest.query(query)

  return result.recordset.length === 0
}

/*
|--------------------------------------------------------------------------
| GET: mengambil semua data unit kerja
|--------------------------------------------------------------------------
*/

export async function GET(request) {
  const authorization = await authorizeMaster(request, "view")

  if (!authorization.authorized) {
    return authorization.response
  }

  try {
    const scope = getUserDataScope(authorization.user)

    if (!scope.isSuperAdmin && !scope.codeUker) {
      return createErrorResponse(
        "Akun Anda belum terhubung dengan unit kerja.",
        403
      )
    }

    const { searchParams } = new URL(request.url)
    const mode = normalizeText(searchParams.get("mode")).toLowerCase()
    const db = await connectDB()

    if (mode === "options") {
      const result = await db
        .request()
        .input("codeUker", sql.NVarChar(4), scope.codeUker)
        .query(`
          SELECT id, codeuker, nama_uker, kota
          FROM dbo.master_uker
          WHERE @codeUker IS NULL OR codeuker = @codeUker
          ORDER BY codeuker ASC, nama_uker ASC, id ASC;
        `)

      return NextResponse.json({
        success: true,
        data: {
          ukers: result.recordset,
          scope: { isSuperAdmin: scope.isSuperAdmin, codeuker: scope.codeUker },
        },
      })
    }

    const page = normalizePositiveInteger(searchParams.get("page"), 1, 1000000)
    const pageSize = normalizePositiveInteger(searchParams.get("page_size"), 10, 100)
    const offset = (page - 1) * pageSize
    const search = normalizeText(searchParams.get("search"))
    const city = normalizeText(searchParams.get("city"))

    const addInputs = (dbRequest) =>
      dbRequest
        .input("codeUker", sql.NVarChar(4), scope.codeUker)
        .input("search", sql.NVarChar(255), search ? `%${search}%` : null)
        .input("city", sql.NVarChar(200), city || null)

    const whereClause = `
      WHERE (@codeUker IS NULL OR codeuker = @codeUker)
        AND (@city IS NULL OR kota = @city)
        AND (
          @search IS NULL
          OR codeuker LIKE @search
          OR nama_uker LIKE @search
          OR alamat_uker LIKE @search
          OR kota LIKE @search
          OR kode_pos LIKE @search
          OR telp_branch LIKE @search
          OR gedung_branch LIKE @search
          OR email LIKE @search
        )
    `

    const [listResult, countResult, summaryResult, citiesResult] = await Promise.all([
      addInputs(db.request())
        .input("offset", sql.Int, offset)
        .input("pageSize", sql.Int, pageSize)
        .query(`
          SELECT
            id,
            nama_uker,
            alamat_uker,
            kota,
            kode_pos,
            telp_branch,
            gedung_branch,
            email,
            CONVERT(CHAR(10), tanggal_ops, 23) AS tanggal_ops,
            codeuker,
            created_at,
            updated_at,
            CONVERT(VARCHAR(18), CONVERT(VARBINARY(8), row_version), 1) AS row_version
          FROM dbo.master_uker
          ${whereClause}
          ORDER BY codeuker ASC, nama_uker ASC, id ASC
          OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
        `),
      addInputs(db.request()).query(`
        SELECT COUNT_BIG(*) AS total
        FROM dbo.master_uker
        ${whereClause};
      `),
      db.request()
        .input("codeUker", sql.NVarChar(4), scope.codeUker)
        .query(`
          SELECT
            COUNT_BIG(*) AS total,
            COUNT(DISTINCT NULLIF(LTRIM(RTRIM(kota)), '')) AS city_count,
            SUM(CASE WHEN email IS NOT NULL AND LTRIM(RTRIM(email)) <> '' THEN 1 ELSE 0 END) AS with_email,
            SUM(CASE WHEN tanggal_ops IS NOT NULL THEN 1 ELSE 0 END) AS operational
          FROM dbo.master_uker
          WHERE @codeUker IS NULL OR codeuker = @codeUker;
        `),
      db.request()
        .input("codeUker", sql.NVarChar(4), scope.codeUker)
        .query(`
          SELECT DISTINCT kota
          FROM dbo.master_uker
          WHERE (@codeUker IS NULL OR codeuker = @codeUker)
            AND kota IS NOT NULL
            AND LTRIM(RTRIM(kota)) <> ''
          ORDER BY kota ASC;
        `),
    ])

    const total = Number(countResult.recordset[0]?.total || 0)
    const summaryRow = summaryResult.recordset[0] || {}

    return NextResponse.json({
      success: true,
      data: {
        ukers: listResult.recordset.map((item) => ({
          ...item,
          row_version: normalizeRowVersionToken(item.row_version),
        })),
        pagination: {
          page,
          page_size: pageSize,
          total,
          total_pages: Math.max(1, Math.ceil(total / pageSize)),
        },
        summary: {
          total: Number(summaryRow.total || 0),
          cityCount: Number(summaryRow.city_count || 0),
          withEmail: Number(summaryRow.with_email || 0),
          operational: Number(summaryRow.operational || 0),
        },
        cities: citiesResult.recordset.map((item) => item.kota),
        scope: { isSuperAdmin: scope.isSuperAdmin, codeUker: scope.codeUker },
      },
    })
  } catch (error) {
    console.error("GET master uker error:", error)

    const schemaErrorResponse = createUkerSchemaErrorResponse(error)
    if (schemaErrorResponse) return schemaErrorResponse

    return createInternalErrorResponse(error, "Gagal mengambil data unit kerja.")
  }
}

/*
|--------------------------------------------------------------------------
| POST: menambahkan unit kerja
|--------------------------------------------------------------------------
*/

export async function POST(request) {
  const authorization = await authorizeMaster(request, "create")

  if (!authorization.authorized) {
    return authorization.response
  }

  const scope = getUserDataScope(authorization.user)

  if (!scope.isSuperAdmin) {
    return createErrorResponse(
      "Hanya Super Admin yang dapat menambahkan unit kerja.",
      403
    )
  }

  try {
    const body = await readJsonBody(request, { maxBytes: 2 * 1024 * 1024 })
    const validation = validateUkerPayload(body)

    if (validation.error) {
      return createErrorResponse(validation.error)
    }

    const {
      namaUker,
      alamatUker,
      kota,
      kodePos,
      telpBranch,
      gedungBranch,
      email,
      tanggalOps,
      codeUker,
    } = validation.data

    const db = await connectDB()

    const codeIsAvailable = await isCodeUkerAvailable(db, codeUker)

    if (!codeIsAvailable) {
      return createErrorResponse(
        `Kode unit kerja ${codeUker} sudah digunakan.`,
        409
      )
    }

    const result = await db
      .request()
      .input("namaUker", sql.NVarChar(100), namaUker)
      .input("alamatUker", sql.NVarChar(255), alamatUker)
      .input("kota", sql.NVarChar(200), kota)
      .input("kodePos", sql.NVarChar(50), kodePos)
      .input("telpBranch", sql.NVarChar(255), telpBranch)
      .input("gedungBranch", sql.NVarChar(255), gedungBranch)
      .input("email", sql.NVarChar(255), email)
      .input("tanggalOps", sql.Date, tanggalOps)
      .input("codeUker", sql.NVarChar(4), codeUker)
      .query(`
        INSERT INTO dbo.master_uker
        (
          nama_uker,
          alamat_uker,
          kota,
          kode_pos,
          telp_branch,
          gedung_branch,
          email,
          tanggal_ops,
          codeuker,
          created_at,
          updated_at
        )
        OUTPUT inserted.id
        VALUES
        (
          @namaUker,
          @alamatUker,
          @kota,
          @kodePos,
          @telpBranch,
          @gedungBranch,
          @email,
          @tanggalOps,
          @codeUker,
          SYSDATETIME(),
          NULL
        );
      `)

    const createdId = Number(result.recordset[0]?.id)
    const createdUker = await getUkerById(db, createdId)

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "CREATE",
      module: "masters.uker",
      entityType: "master_uker",
      entityId: createdId,
      metadata: { after: createdUker },
    })

    return NextResponse.json(
      {
        success: true,
        message: "Data unit kerja berhasil ditambahkan.",
        data: createdUker,
      },
      {
        status: 201,
      }
    )
  } catch (error) {
    console.error("POST master uker error:", error)

    if (error instanceof SyntaxError) {
      return createErrorResponse("Format data tidak valid.")
    }

    const errorNumber = getSqlErrorNumber(error)

    if (errorNumber === 2601 || errorNumber === 2627) {
      return createErrorResponse(
        "Kode unit kerja sudah digunakan.",
        409
      )
    }

    const schemaErrorResponse = createUkerSchemaErrorResponse(error)
    if (schemaErrorResponse) return schemaErrorResponse

    return createInternalErrorResponse(
      error,
      "Gagal menambahkan data unit kerja."
    )
  }
}

/*
|--------------------------------------------------------------------------
| PUT: memperbarui unit kerja
|--------------------------------------------------------------------------
*/

export async function PUT(request) {
  const authorization = await authorizeMaster(request, "update")

  if (!authorization.authorized) {
    return authorization.response
  }

  const scope = getUserDataScope(authorization.user)

  if (!scope.isSuperAdmin && !scope.codeUker) {
    return createErrorResponse(
      "Akun Anda belum terhubung dengan unit kerja.",
      403
    )
  }

  try {
    const body = await readJsonBody(request, { maxBytes: 2 * 1024 * 1024 })
    const id = normalizeId(body.id)

    if (!id) {
      return createErrorResponse("ID unit kerja tidak valid.")
    }

    const validation = validateUkerPayload(body)

    if (validation.error) {
      return createErrorResponse(validation.error)
    }

    const requestedRowVersion = normalizeRowVersionToken(body.row_version)
    if (!requestedRowVersion) {
      return createErrorResponse(
        "Versi data unit kerja tidak tersedia. Muat ulang sebelum menyimpan.",
        409
      )
    }

    const {
      namaUker,
      alamatUker,
      kota,
      kodePos,
      telpBranch,
      gedungBranch,
      email,
      tanggalOps,
      codeUker,
    } = validation.data

    const db = await connectDB()
    const existingUker = await getUkerById(db, id, scope.codeUker)

    if (!existingUker) {
      return createErrorResponse(
        "Data unit kerja tidak ditemukan.",
        404
      )
    }

    if (requestedRowVersion !== normalizeRowVersionToken(existingUker.row_version)) {
      return createErrorResponse(
        "Data unit kerja telah berubah oleh pengguna lain. Muat ulang sebelum menyimpan.",
        409
      )
    }

    if (!scope.isSuperAdmin && codeUker !== scope.codeUker) {
      return createErrorResponse(
        "Kode unit kerja tidak dapat diubah oleh user unit kerja.",
        403
      )
    }

    const codeIsAvailable = await isCodeUkerAvailable(
      db,
      codeUker,
      id
    )

    if (!codeIsAvailable) {
      return createErrorResponse(
        `Kode unit kerja ${codeUker} sudah digunakan.`,
        409
      )
    }

    const updateResult = await db
      .request()
      .input("id", sql.BigInt, id)
      .input(
        "rowVersion",
        sql.VarBinary(8),
        Buffer.from(requestedRowVersion.slice(2), "hex")
      )
      .input("namaUker", sql.NVarChar(100), namaUker)
      .input("alamatUker", sql.NVarChar(255), alamatUker)
      .input("kota", sql.NVarChar(200), kota)
      .input("kodePos", sql.NVarChar(50), kodePos)
      .input("telpBranch", sql.NVarChar(255), telpBranch)
      .input("gedungBranch", sql.NVarChar(255), gedungBranch)
      .input("email", sql.NVarChar(255), email)
      .input("tanggalOps", sql.Date, tanggalOps)
      .input("codeUker", sql.NVarChar(4), codeUker)
      .input("scopeCodeUker", sql.NVarChar(4), scope.codeUker)
      .query(`
        UPDATE dbo.master_uker
        SET
          nama_uker = @namaUker,
          alamat_uker = @alamatUker,
          kota = @kota,
          kode_pos = @kodePos,
          telp_branch = @telpBranch,
          gedung_branch = @gedungBranch,
          email = @email,
          tanggal_ops = @tanggalOps,
          codeuker = @codeUker,
          updated_at = SYSDATETIME()
        WHERE id = @id
          AND row_version = @rowVersion
          AND (@scopeCodeUker IS NULL OR codeuker = @scopeCodeUker);
      `)

    if (Number(updateResult.rowsAffected?.[0] || 0) === 0) {
      return createErrorResponse(
        "Data unit kerja telah berubah oleh pengguna lain. Muat ulang sebelum menyimpan.",
        409
      )
    }

    const updatedUker = await getUkerById(db, id, scope.codeUker)

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "UPDATE",
      module: "masters.uker",
      entityType: "master_uker",
      entityId: id,
      metadata: {
        before: existingUker,
        after: updatedUker,
      },
    })

    return NextResponse.json({
      success: true,
      message: "Data unit kerja berhasil diperbarui.",
      data: updatedUker,
    })
  } catch (error) {
    console.error("PUT master uker error:", error)

    if (error instanceof SyntaxError) {
      return createErrorResponse("Format data tidak valid.")
    }

    const errorNumber = getSqlErrorNumber(error)

    if (errorNumber === 2601 || errorNumber === 2627) {
      return createErrorResponse(
        "Kode unit kerja sudah digunakan.",
        409
      )
    }

    const schemaErrorResponse = createUkerSchemaErrorResponse(error)
    if (schemaErrorResponse) return schemaErrorResponse

    return createInternalErrorResponse(
      error,
      "Gagal memperbarui data unit kerja."
    )
  }
}

/*
|--------------------------------------------------------------------------
| DELETE: menghapus unit kerja
|--------------------------------------------------------------------------
*/

export async function DELETE(request) {
  const authorization = await authorizeMaster(request, "delete")

  if (!authorization.authorized) {
    return authorization.response
  }

  const scope = getUserDataScope(authorization.user)

  if (!scope.isSuperAdmin) {
    return createErrorResponse(
      "Hanya Super Admin yang dapat menghapus unit kerja.",
      403
    )
  }

  try {
    const body = await readJsonBody(request, { maxBytes: 2 * 1024 * 1024 })
    const id = normalizeId(body.id)

    if (!id) {
      return createErrorResponse("ID unit kerja tidak valid.")
    }

    const db = await connectDB()
    const existingUker = await getUkerById(db, id)

    if (!existingUker) {
      return createErrorResponse(
        "Data unit kerja tidak ditemukan.",
        404
      )
    }

    await db
      .request()
      .input("id", sql.BigInt, id)
      .query(`
        DELETE FROM dbo.master_uker
        WHERE id = @id;
      `)

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "DELETE",
      module: "masters.uker",
      entityType: "master_uker",
      entityId: id,
      metadata: { before: existingUker },
    })

    return NextResponse.json({
      success: true,
      message: "Data unit kerja berhasil dihapus.",
    })
  } catch (error) {
    console.error("DELETE master uker error:", error)

    if (error instanceof SyntaxError) {
      return createErrorResponse("Format data tidak valid.")
    }

    const errorNumber = getSqlErrorNumber(error)

    if (errorNumber === 547) {
      return createErrorResponse(
        "Data unit kerja masih digunakan oleh data lain sehingga tidak dapat dihapus.",
        409
      )
    }

    const schemaErrorResponse = createUkerSchemaErrorResponse(error)
    if (schemaErrorResponse) return schemaErrorResponse

    return createInternalErrorResponse(
      error,
      "Gagal menghapus data unit kerja."
    )
  }
}