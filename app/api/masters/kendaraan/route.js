import { readJsonBody } from "@/lib/http/json-body"
import { NextResponse } from "next/server"

import {
  authorizeApiRequest,
  getUserDataScope,
  hasMenuAccess,
} from "@/lib/access-control"
import { connectDB, sql } from "@/lib/mssql"
import { writeAuditLog } from "@/lib/security/audit-log"
import { normalizeRowVersionToken } from "@/modules/master-mesin/row-version"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const VEHICLE_TYPES = new Set(["MOBIL", "MOTOR"])
const VEHICLE_STATUSES = new Set(["AKTIF", "NONAKTIF"])
const DEFAULT_PAGE_SIZE = 10
const MAXIMUM_PAGE_SIZE = 100

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

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeUpperText(value) {
  return normalizeText(value).toUpperCase()
}

function normalizeVehicleNumber(value) {
  return normalizeUpperText(value).replace(/\s+/g, " ")
}

function normalizeId(value) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function normalizePositiveInteger(value, defaultValue, maximum = null) {
  const parsed = Number(value)

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return defaultValue
  }

  return maximum === null ? parsed : Math.min(parsed, maximum)
}

function validateMaximumLength(label, value, maximumLength) {
  if (value && value.length > maximumLength) {
    return `${label} maksimal ${maximumLength} karakter.`
  }

  return null
}

function validatePayload(body) {
  const jenisKendaraan = normalizeUpperText(body.jenis_kendaraan)
  const merkKendaraan = normalizeText(body.merk_kendaraan)
  const nomorKendaraan = normalizeVehicleNumber(body.nomor_kendaraan)
  const status = normalizeUpperText(body.status || "AKTIF")
  const ukerId = normalizeId(body.uker_id)

  if (!VEHICLE_TYPES.has(jenisKendaraan)) {
    return {
      error: "Jenis kendaraan wajib dipilih: Mobil atau Motor.",
      data: null,
    }
  }

  if (!merkKendaraan) {
    return { error: "Merk kendaraan wajib diisi.", data: null }
  }

  if (!nomorKendaraan) {
    return { error: "Nomor kendaraan wajib diisi.", data: null }
  }

  if (!VEHICLE_STATUSES.has(status)) {
    return { error: "Status kendaraan tidak valid.", data: null }
  }

  const errors = [
    validateMaximumLength("Merk kendaraan", merkKendaraan, 100),
    validateMaximumLength("Nomor kendaraan", nomorKendaraan, 20),
    !/^[A-Z0-9 .-]+$/.test(nomorKendaraan)
      ? "Nomor kendaraan hanya boleh berisi huruf, angka, spasi, titik, dan tanda hubung."
      : null,
  ].filter(Boolean)

  if (errors.length > 0) {
    return { error: errors[0], data: null }
  }

  return {
    error: null,
    data: {
      jenisKendaraan,
      merkKendaraan,
      nomorKendaraan,
      status,
      ukerId,
    },
  }
}

async function authorizeMaster(request, action = "view") {
  return authorizeApiRequest(request, "/masters", action)
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

async function getUkerById(db, id) {
  const result = await db
    .request()
    .input("id", sql.BigInt, id)
    .query(`
      SELECT TOP 1
        id,
        codeuker,
        nama_uker
      FROM dbo.master_uker
      WHERE id = @id;
    `)

  return result.recordset[0] || null
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
      WHERE codeuker = @codeUker;
    `)

  return result.recordset[0] || null
}

async function resolveWriteUker(db, scope, requestedUkerId) {
  if (scope.isSuperAdmin) {
    if (!requestedUkerId) {
      return {
        uker: null,
        error: "Unit kerja wajib dipilih oleh Super Admin.",
      }
    }

    const uker = await getUkerById(db, requestedUkerId)
    return {
      uker,
      error: uker ? null : "Unit kerja tidak ditemukan.",
    }
  }

  const uker = await getUkerByCode(db, scope.codeUker)
  return {
    uker,
    error: uker
      ? null
      : "Unit kerja akun tidak ditemukan pada master unit kerja.",
  }
}

async function getVehicleById(db, id, scopeCodeUker = null) {
  const result = await db
    .request()
    .input("id", sql.BigInt, id)
    .input("scopeCodeUker", sql.NVarChar(4), scopeCodeUker)
    .query(`
      SELECT TOP 1
        k.id,
        k.uker_id,
        mu.codeuker,
        mu.nama_uker,
        k.jenis_kendaraan,
        k.merk_kendaraan,
        k.nomor_kendaraan,
        k.status,
        k.created_at,
        k.updated_at,
        CONVERT(VARCHAR(18), k.row_version, 1) AS row_version
      FROM dbo.master_kendaraan k
      INNER JOIN dbo.master_uker mu
        ON mu.id = k.uker_id
      WHERE k.id = @id
        AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker);
    `)

  const item = result.recordset[0] || null
  return item ? { ...item, row_version: normalizeRowVersionToken(item.row_version) } : null
}

async function isVehicleNumberAvailable(
  db,
  nomorKendaraan,
  ignoredId = null
) {
  const request = db
    .request()
    .input("nomorKendaraan", sql.VarChar(20), nomorKendaraan)

  let query = `
    SELECT TOP 1 id
    FROM dbo.master_kendaraan
    WHERE UPPER(LTRIM(RTRIM(nomor_kendaraan))) = @nomorKendaraan
  `

  if (ignoredId !== null) {
    request.input("ignoredId", sql.BigInt, ignoredId)
    query += " AND id <> @ignoredId"
  }

  const result = await request.query(`${query};`)
  return result.recordset.length === 0
}

async function getSummary(db, scopeCodeUker = null) {
  const result = await db
    .request()
    .input("scopeCodeUker", sql.NVarChar(4), scopeCodeUker)
    .query(`
      SELECT
        COUNT_BIG(1) AS total,
        SUM(CASE WHEN k.jenis_kendaraan = 'MOBIL' THEN 1 ELSE 0 END) AS mobil,
        SUM(CASE WHEN k.jenis_kendaraan = 'MOTOR' THEN 1 ELSE 0 END) AS motor,
        SUM(CASE WHEN k.status = 'AKTIF' THEN 1 ELSE 0 END) AS aktif
      FROM dbo.master_kendaraan k
      INNER JOIN dbo.master_uker mu
        ON mu.id = k.uker_id
      WHERE (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker);
    `)

  const row = result.recordset[0] || {}

  return {
    total: Number(row.total || 0),
    mobil: Number(row.mobil || 0),
    motor: Number(row.motor || 0),
    aktif: Number(row.aktif || 0),
  }
}

export async function GET(request) {
  const authorization = await authorizeMaster(request, "view")

  if (!authorization.authorized) {
    return authorization.response
  }

  const scopeResult = resolveDataScope(authorization)
  if (scopeResult.response) return scopeResult.response

  try {
    const scope = scopeResult.scope
    const { searchParams } = new URL(request.url)
    const id = normalizeId(searchParams.get("id"))
    const db = await connectDB()

    if (searchParams.has("id")) {
      if (!id) {
        return createErrorResponse("ID kendaraan tidak valid.")
      }

      const vehicle = await getVehicleById(db, id, scope.codeUker)

      if (!vehicle) {
        return createErrorResponse(
          scope.codeUker
            ? "Data kendaraan tidak ditemukan atau bukan milik unit kerja Anda."
            : "Data kendaraan tidak ditemukan.",
          404
        )
      }

      return NextResponse.json({ success: true, data: vehicle })
    }

    const page = normalizePositiveInteger(searchParams.get("page"), 1)
    const pageSize = normalizePositiveInteger(
      searchParams.get("page_size"),
      DEFAULT_PAGE_SIZE,
      MAXIMUM_PAGE_SIZE
    )
    const search = normalizeText(searchParams.get("search")).slice(0, 100)
    const jenisKendaraan = normalizeUpperText(
      searchParams.get("jenis_kendaraan")
    )
    const status = normalizeUpperText(searchParams.get("status"))
    const requestedUkerId = normalizeId(searchParams.get("uker_id"))

    if (jenisKendaraan && !VEHICLE_TYPES.has(jenisKendaraan)) {
      return createErrorResponse("Filter jenis kendaraan tidak valid.")
    }

    if (status && !VEHICLE_STATUSES.has(status)) {
      return createErrorResponse("Filter status kendaraan tidak valid.")
    }

    if (searchParams.has("uker_id") && !requestedUkerId) {
      return createErrorResponse("Filter unit kerja tidak valid.")
    }

    const whereParts = []
    const countRequest = db.request()
    const listRequest = db.request()

    function addInput(name, type, value) {
      countRequest.input(name, type, value)
      listRequest.input(name, type, value)
    }

    if (scope.codeUker) {
      addInput("scopeCodeUker", sql.NVarChar(4), scope.codeUker)
      whereParts.push("mu.codeuker = @scopeCodeUker")
    }

    if (scope.isSuperAdmin && requestedUkerId) {
      addInput("filterUkerId", sql.BigInt, requestedUkerId)
      whereParts.push("k.uker_id = @filterUkerId")
    }

    if (search) {
      addInput("search", sql.NVarChar(150), `%${search}%`)
      whereParts.push(`(
        k.merk_kendaraan LIKE @search
        OR k.nomor_kendaraan LIKE @search
        OR mu.codeuker LIKE @search
        OR mu.nama_uker LIKE @search
      )`)
    }

    if (jenisKendaraan) {
      addInput("jenisKendaraan", sql.VarChar(10), jenisKendaraan)
      whereParts.push("k.jenis_kendaraan = @jenisKendaraan")
    }

    if (status) {
      addInput("status", sql.VarChar(10), status)
      whereParts.push("k.status = @status")
    }

    const whereClause =
      whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : ""

    const countResult = await countRequest.query(`
      SELECT COUNT_BIG(1) AS total
      FROM dbo.master_kendaraan k
      INNER JOIN dbo.master_uker mu
        ON mu.id = k.uker_id
      ${whereClause};
    `)

    const total = Number(countResult.recordset[0]?.total || 0)
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const currentPage = Math.min(page, totalPages)
    const offset = (currentPage - 1) * pageSize

    listRequest.input("offset", sql.Int, offset)
    listRequest.input("pageSize", sql.Int, pageSize)

    const [listResult, summary, canCreate, canUpdate, canDelete] =
      await Promise.all([
        listRequest.query(`
          SELECT
            k.id,
            k.uker_id,
            mu.codeuker,
            mu.nama_uker,
            k.jenis_kendaraan,
            k.merk_kendaraan,
            k.nomor_kendaraan,
            k.status,
            k.created_at,
            k.updated_at,
            CONVERT(VARCHAR(18), k.row_version, 1) AS row_version
          FROM dbo.master_kendaraan k
          INNER JOIN dbo.master_uker mu
            ON mu.id = k.uker_id
          ${whereClause}
          ORDER BY k.updated_at DESC, k.id DESC
          OFFSET @offset ROWS
          FETCH NEXT @pageSize ROWS ONLY;
        `),
        getSummary(db, scope.codeUker),
        hasMenuAccess(authorization.user.role_id, "/masters", "create"),
        hasMenuAccess(authorization.user.role_id, "/masters", "update"),
        hasMenuAccess(authorization.user.role_id, "/masters", "delete"),
      ])

    return NextResponse.json({
      success: true,
      data: {
        vehicles: listResult.recordset,
        summary,
        pagination: {
          page: currentPage,
          page_size: pageSize,
          total_items: total,
          total_pages: totalPages,
        },
        scope: {
          isSuperAdmin: scope.isSuperAdmin,
          codeUker: scope.codeUker,
        },
        permissions: {
          can_create: canCreate,
          can_update: canUpdate,
          can_delete: canDelete,
        },
      },
    })
  } catch (error) {
    console.error("GET master kendaraan error:", error)
    return createInternalErrorResponse(
      error,
      "Gagal mengambil data kendaraan."
    )
  }
}

export async function POST(request) {
  const authorization = await authorizeMaster(request, "create")

  if (!authorization.authorized) {
    return authorization.response
  }

  const scopeResult = resolveDataScope(authorization)
  if (scopeResult.response) return scopeResult.response

  try {
    let body

    try {
      body = await readJsonBody(request, { maxBytes: 2 * 1024 * 1024 })
    } catch {
      return createErrorResponse("Format permintaan tidak valid.")
    }

    const validation = validatePayload(body)
    if (validation.error) return createErrorResponse(validation.error)

    const scope = scopeResult.scope
    const db = await connectDB()
    const writeUker = await resolveWriteUker(
      db,
      scope,
      validation.data.ukerId
    )

    if (writeUker.error) {
      return createErrorResponse(writeUker.error, 403)
    }

    if (
      !(await isVehicleNumberAvailable(
        db,
        validation.data.nomorKendaraan
      ))
    ) {
      return createErrorResponse("Nomor kendaraan sudah digunakan.", 409)
    }

    const result = await db
      .request()
      .input("ukerId", sql.BigInt, writeUker.uker.id)
      .input(
        "jenisKendaraan",
        sql.VarChar(10),
        validation.data.jenisKendaraan
      )
      .input(
        "merkKendaraan",
        sql.NVarChar(100),
        validation.data.merkKendaraan
      )
      .input(
        "nomorKendaraan",
        sql.VarChar(20),
        validation.data.nomorKendaraan
      )
      .input("status", sql.VarChar(10), validation.data.status)
      .query(`
        INSERT INTO dbo.master_kendaraan (
          uker_id,
          jenis_kendaraan,
          merk_kendaraan,
          nomor_kendaraan,
          status,
          created_at,
          updated_at
        )
        OUTPUT INSERTED.id
        VALUES (
          @ukerId,
          @jenisKendaraan,
          @merkKendaraan,
          @nomorKendaraan,
          @status,
          SYSDATETIME(),
          SYSDATETIME()
        );
      `)

    const createdId = Number(result.recordset[0]?.id)
    const created = await getVehicleById(
      db,
      createdId,
      scope.codeUker
    )

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "CREATE",
      module: "masters.kendaraan",
      entityType: "master_kendaraan",
      entityId: createdId,
      metadata: {
        uker_id: writeUker.uker.id,
        codeuker: writeUker.uker.codeuker,
        jenis_kendaraan: validation.data.jenisKendaraan,
        merk_kendaraan: validation.data.merkKendaraan,
        nomor_kendaraan: validation.data.nomorKendaraan,
        status: validation.data.status,
      },
    })

    return NextResponse.json(
      {
        success: true,
        message: "Data kendaraan berhasil ditambahkan.",
        data: created,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("POST master kendaraan error:", error)

    if ([2601, 2627].includes(getSqlErrorNumber(error))) {
      return createErrorResponse("Nomor kendaraan sudah digunakan.", 409)
    }

    return createInternalErrorResponse(
      error,
      "Gagal menambahkan data kendaraan."
    )
  }
}

export async function PUT(request) {
  const authorization = await authorizeMaster(request, "update")

  if (!authorization.authorized) {
    return authorization.response
  }

  const scopeResult = resolveDataScope(authorization)
  if (scopeResult.response) return scopeResult.response

  try {
    let body

    try {
      body = await readJsonBody(request, { maxBytes: 2 * 1024 * 1024 })
    } catch {
      return createErrorResponse("Format permintaan tidak valid.")
    }

    const id = normalizeId(body.id)
    if (!id) return createErrorResponse("ID kendaraan tidak valid.")

    const validation = validatePayload(body)
    if (validation.error) return createErrorResponse(validation.error)

    const requestedRowVersion = normalizeRowVersionToken(body.row_version)
    if (!requestedRowVersion) {
      return createErrorResponse(
        "Versi data kendaraan tidak tersedia. Muat ulang sebelum menyimpan.",
        409
      )
    }

    const scope = scopeResult.scope
    const db = await connectDB()
    const existing = await getVehicleById(db, id, scope.codeUker)

    if (!existing) {
      return createErrorResponse(
        scope.codeUker
          ? "Data kendaraan tidak ditemukan atau bukan milik unit kerja Anda."
          : "Data kendaraan tidak ditemukan.",
        404
      )
    }

    if (requestedRowVersion !== normalizeRowVersionToken(existing.row_version)) {
      return createErrorResponse(
        "Data kendaraan telah berubah oleh pengguna lain. Muat ulang sebelum menyimpan.",
        409
      )
    }

    const writeUker = await resolveWriteUker(
      db,
      scope,
      scope.isSuperAdmin ? validation.data.ukerId : existing.uker_id
    )

    if (writeUker.error) {
      return createErrorResponse(writeUker.error, 403)
    }

    if (
      !(await isVehicleNumberAvailable(
        db,
        validation.data.nomorKendaraan,
        id
      ))
    ) {
      return createErrorResponse("Nomor kendaraan sudah digunakan.", 409)
    }

    const updateResult = await db
      .request()
      .input("id", sql.BigInt, id)
      .input(
        "rowVersion",
        sql.VarBinary(8),
        Buffer.from(requestedRowVersion.slice(2), "hex")
      )
      .input("scopeCodeUker", sql.NVarChar(4), scope.codeUker)
      .input("ukerId", sql.BigInt, writeUker.uker.id)
      .input(
        "jenisKendaraan",
        sql.VarChar(10),
        validation.data.jenisKendaraan
      )
      .input(
        "merkKendaraan",
        sql.NVarChar(100),
        validation.data.merkKendaraan
      )
      .input(
        "nomorKendaraan",
        sql.VarChar(20),
        validation.data.nomorKendaraan
      )
      .input("status", sql.VarChar(10), validation.data.status)
      .query(`
        UPDATE k
        SET
          k.uker_id = @ukerId,
          k.jenis_kendaraan = @jenisKendaraan,
          k.merk_kendaraan = @merkKendaraan,
          k.nomor_kendaraan = @nomorKendaraan,
          k.status = @status,
          k.updated_at = SYSDATETIME()
        FROM dbo.master_kendaraan k
        INNER JOIN dbo.master_uker mu
          ON mu.id = k.uker_id
        WHERE k.id = @id
          AND k.row_version = @rowVersion
          AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker);
      `)

    if (Number(updateResult.rowsAffected?.[0] || 0) === 0) {
      return createErrorResponse(
        "Data kendaraan telah berubah oleh pengguna lain. Muat ulang sebelum menyimpan.",
        409
      )
    }

    const updated = await getVehicleById(db, id, scope.codeUker)

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "UPDATE",
      module: "masters.kendaraan",
      entityType: "master_kendaraan",
      entityId: id,
      metadata: {
        before: {
          uker_id: existing.uker_id,
          codeuker: existing.codeuker,
          jenis_kendaraan: existing.jenis_kendaraan,
          merk_kendaraan: existing.merk_kendaraan,
          nomor_kendaraan: existing.nomor_kendaraan,
          status: existing.status,
        },
        after: {
          uker_id: writeUker.uker.id,
          codeuker: writeUker.uker.codeuker,
          jenis_kendaraan: validation.data.jenisKendaraan,
          merk_kendaraan: validation.data.merkKendaraan,
          nomor_kendaraan: validation.data.nomorKendaraan,
          status: validation.data.status,
        },
      },
    })

    return NextResponse.json({
      success: true,
      message: "Data kendaraan berhasil diperbarui.",
      data: updated,
    })
  } catch (error) {
    console.error("PUT master kendaraan error:", error)

    if ([2601, 2627].includes(getSqlErrorNumber(error))) {
      return createErrorResponse("Nomor kendaraan sudah digunakan.", 409)
    }

    return createInternalErrorResponse(
      error,
      "Gagal memperbarui data kendaraan."
    )
  }
}

export async function DELETE(request) {
  const authorization = await authorizeMaster(request, "delete")

  if (!authorization.authorized) {
    return authorization.response
  }

  const scopeResult = resolveDataScope(authorization)
  if (scopeResult.response) return scopeResult.response

  try {
    let body

    try {
      body = await readJsonBody(request, { maxBytes: 2 * 1024 * 1024 })
    } catch {
      return createErrorResponse("Format permintaan tidak valid.")
    }

    const id = normalizeId(body.id)
    if (!id) return createErrorResponse("ID kendaraan tidak valid.")

    const scope = scopeResult.scope
    const db = await connectDB()
    const existing = await getVehicleById(db, id, scope.codeUker)

    if (!existing) {
      return createErrorResponse(
        scope.codeUker
          ? "Data kendaraan tidak ditemukan atau bukan milik unit kerja Anda."
          : "Data kendaraan tidak ditemukan.",
        404
      )
    }

    const result = await db
      .request()
      .input("id", sql.BigInt, id)
      .input("scopeCodeUker", sql.NVarChar(4), scope.codeUker)
      .query(`
        DELETE k
        FROM dbo.master_kendaraan k
        INNER JOIN dbo.master_uker mu
          ON mu.id = k.uker_id
        WHERE k.id = @id
          AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker);

        SELECT @@ROWCOUNT AS affected_rows;
      `)

    if (Number(result.recordset[0]?.affected_rows || 0) !== 1) {
      return createErrorResponse("Data kendaraan gagal dihapus.", 409)
    }

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "DELETE",
      module: "masters.kendaraan",
      entityType: "master_kendaraan",
      entityId: id,
      metadata: {
        uker_id: existing.uker_id,
        codeuker: existing.codeuker,
        jenis_kendaraan: existing.jenis_kendaraan,
        merk_kendaraan: existing.merk_kendaraan,
        nomor_kendaraan: existing.nomor_kendaraan,
        status: existing.status,
      },
    })

    return NextResponse.json({
      success: true,
      message: "Data kendaraan berhasil dihapus.",
    })
  } catch (error) {
    console.error("DELETE master kendaraan error:", error)

    if (getSqlErrorNumber(error) === 547) {
      return createErrorResponse(
        "Data kendaraan masih digunakan oleh data lain sehingga tidak dapat dihapus.",
        409
      )
    }

    return createInternalErrorResponse(
      error,
      "Gagal menghapus data kendaraan."
    )
  }
}
