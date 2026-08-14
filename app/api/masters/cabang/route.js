import { readJsonBody } from "@/lib/http/json-body"
import { NextResponse } from "next/server"

import { authorizeApiRequest } from "@/lib/access-control"
import { connectDB, sql } from "@/lib/mssql"
import { writeAuditLog } from "@/lib/security/audit-log"
import { normalizeRowVersionToken } from "@/modules/master-mesin/row-version"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_PAGE_SIZE = 10
const MAXIMUM_PAGE_SIZE = 100

function createErrorResponse(message, status = 400) {
  return NextResponse.json(
    {
      success: false,
      message,
    },
    { status }
  )
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeCode(value) {
  return normalizeText(value).toUpperCase()
}

function normalizeId(value) {
  const id = Number(value)

  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function normalizePositiveInteger(value, defaultValue, maximum = null) {
  const parsedValue = Number(value)

  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    return defaultValue
  }

  return maximum === null
    ? parsedValue
    : Math.min(parsedValue, maximum)
}

function normalizeBoolean(value, defaultValue = true) {
  if (value === undefined || value === null || value === "") {
    return defaultValue
  }

  if (
    value === true ||
    value === 1 ||
    value === "1" ||
    String(value).toLowerCase() === "true"
  ) {
    return true
  }

  if (
    value === false ||
    value === 0 ||
    value === "0" ||
    String(value).toLowerCase() === "false"
  ) {
    return false
  }

  return defaultValue
}

function parseActiveFilter(value) {
  const normalizedValue = normalizeText(value).toLowerCase()

  if (!normalizedValue || normalizedValue === "all") {
    return null
  }

  if (["1", "true", "aktif", "active"].includes(normalizedValue)) {
    return true
  }

  if (["0", "false", "nonaktif", "inactive"].includes(normalizedValue)) {
    return false
  }

  return null
}

function validatePayload(body) {
  const kanwilId = normalizeId(body.kanwil_id)
  const kodeCabang = normalizeCode(body.kode_cabang)
  const namaCabang = normalizeText(body.nama_cabang)
  const isActive = normalizeBoolean(body.is_active, true)

  if (!kanwilId) {
    return { error: "Kanwil wajib dipilih.", data: null }
  }

  if (!kodeCabang) {
    return { error: "Kode Cabang wajib diisi.", data: null }
  }

  if (!namaCabang) {
    return { error: "Nama Cabang wajib diisi.", data: null }
  }

  if (kodeCabang.length > 30) {
    return { error: "Kode Cabang maksimal 30 karakter.", data: null }
  }

  if (!/^[A-Z0-9][A-Z0-9._/-]*$/.test(kodeCabang)) {
    return {
      error:
        "Kode Cabang hanya boleh berisi huruf, angka, titik, garis miring, garis bawah, atau tanda hubung.",
      data: null,
    }
  }

  if (namaCabang.length > 150) {
    return { error: "Nama Cabang maksimal 150 karakter.", data: null }
  }

  return {
    error: null,
    data: {
      kanwilId,
      kodeCabang,
      namaCabang,
      isActive,
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

function requireSuperAdmin(authorization) {
  if (authorization.user.role_code === "SUPER_ADMIN") {
    return null
  }

  return createErrorResponse(
    "Hanya Super Admin yang dapat mengubah Master Cabang.",
    403
  )
}

async function getKanwilById(db, id) {
  const result = await db
    .request()
    .input("id", sql.Int, id)
    .query(`
      SELECT TOP 1
        id,
        kode_kanwil,
        nama_kanwil,
        is_active
      FROM dbo.master_kanwil
      WHERE id = @id;
    `)

  return result.recordset[0] || null
}

async function isCodeAvailable(db, kodeCabang, ignoredId = null) {
  const request = db
    .request()
    .input("kodeCabang", sql.VarChar(30), kodeCabang)

  let query = `
    SELECT TOP 1 id
    FROM dbo.master_cabang
    WHERE UPPER(kode_cabang) = @kodeCabang
  `

  if (ignoredId !== null) {
    request.input("ignoredId", sql.Int, ignoredId)
    query += " AND id <> @ignoredId"
  }

  const result = await request.query(`${query};`)

  return result.recordset.length === 0
}

async function isNameAvailable(db, kanwilId, namaCabang, ignoredId = null) {
  const request = db
    .request()
    .input("kanwilId", sql.Int, kanwilId)
    .input("namaCabang", sql.NVarChar(150), namaCabang)

  let query = `
    SELECT TOP 1 id
    FROM dbo.master_cabang
    WHERE kanwil_id = @kanwilId
      AND UPPER(nama_cabang) = UPPER(@namaCabang)
  `

  if (ignoredId !== null) {
    request.input("ignoredId", sql.Int, ignoredId)
    query += " AND id <> @ignoredId"
  }

  const result = await request.query(`${query};`)

  return result.recordset.length === 0
}

async function getById(db, id) {
  const result = await db
    .request()
    .input("id", sql.Int, id)
    .query(`
      SELECT TOP 1
        c.id,
        c.kanwil_id,
        k.kode_kanwil,
        k.nama_kanwil,
        k.is_active AS kanwil_is_active,
        c.kode_cabang,
        c.nama_cabang,
        c.is_active,
        c.created_at,
        c.updated_at,
        CONVERT(VARCHAR(18), CONVERT(VARBINARY(8), c.row_version), 1) AS row_version
      FROM dbo.master_cabang c
      INNER JOIN dbo.master_kanwil k
        ON k.id = c.kanwil_id
      WHERE c.id = @id;
    `)

  const item = result.recordset[0] || null
  return item ? { ...item, row_version: normalizeRowVersionToken(item.row_version) } : null
}

export async function GET(request) {
  const authorization = await authorizeMaster(request, "view")

  if (!authorization.authorized) {
    return authorization.response
  }

  try {
    const { searchParams } = new URL(request.url)
    const mode = normalizeText(searchParams.get("mode")).toLowerCase()
    const db = await connectDB()

    if (mode === "options") {
      const kanwilId = normalizeId(searchParams.get("kanwil_id"))
      const includeInactive = normalizeBoolean(
        searchParams.get("include_inactive"),
        false
      )
      const optionRequest = db.request()
      const whereParts = []

      if (kanwilId) {
        optionRequest.input("kanwilId", sql.Int, kanwilId)
        whereParts.push("c.kanwil_id = @kanwilId")
      }

      if (!includeInactive) {
        whereParts.push("c.is_active = 1")
      }

      const whereClause =
        whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : ""

      const result = await optionRequest.query(`
        SELECT
          c.id,
          c.kanwil_id,
          c.kode_cabang,
          c.nama_cabang,
          c.is_active,
          k.kode_kanwil,
          k.nama_kanwil
        FROM dbo.master_cabang c
        INNER JOIN dbo.master_kanwil k
          ON k.id = c.kanwil_id
        ${whereClause}
        ORDER BY k.nama_kanwil ASC, c.nama_cabang ASC, c.id ASC;
      `)

      return NextResponse.json({
        success: true,
        data: {
          cabangs: result.recordset,
        },
      })
    }

    const page = normalizePositiveInteger(
      searchParams.get("page"),
      1
    )
    const pageSize = normalizePositiveInteger(
      searchParams.get("page_size"),
      DEFAULT_PAGE_SIZE,
      MAXIMUM_PAGE_SIZE
    )
    const search = normalizeText(searchParams.get("search"))
    const activeFilter = parseActiveFilter(searchParams.get("is_active"))
    const kanwilId = normalizeId(searchParams.get("kanwil_id"))
    const offset = (page - 1) * pageSize

    const listRequest = db
      .request()
      .input("offset", sql.Int, offset)
      .input("pageSize", sql.Int, pageSize)

    const countRequest = db.request()
    const whereParts = []

    if (search) {
      listRequest.input("search", sql.NVarChar(200), `%${search}%`)
      countRequest.input("search", sql.NVarChar(200), `%${search}%`)
      whereParts.push(`(
        c.kode_cabang LIKE @search
        OR c.nama_cabang LIKE @search
        OR k.kode_kanwil LIKE @search
        OR k.nama_kanwil LIKE @search
      )`)
    }

    if (activeFilter !== null) {
      listRequest.input("isActive", sql.Bit, activeFilter)
      countRequest.input("isActive", sql.Bit, activeFilter)
      whereParts.push("c.is_active = @isActive")
    }

    if (kanwilId) {
      listRequest.input("kanwilId", sql.Int, kanwilId)
      countRequest.input("kanwilId", sql.Int, kanwilId)
      whereParts.push("c.kanwil_id = @kanwilId")
    }

    const whereClause =
      whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : ""

    const [listResult, countResult, summaryResult] = await Promise.all([
      listRequest.query(`
        SELECT
          c.id,
          c.kanwil_id,
          k.kode_kanwil,
          k.nama_kanwil,
          k.is_active AS kanwil_is_active,
          c.kode_cabang,
          c.nama_cabang,
          c.is_active,
          c.created_at,
          c.updated_at,
          CONVERT(VARCHAR(18), CONVERT(VARBINARY(8), c.row_version), 1) AS row_version
        FROM dbo.master_cabang c
        INNER JOIN dbo.master_kanwil k
          ON k.id = c.kanwil_id
        ${whereClause}
        ORDER BY k.nama_kanwil ASC, c.nama_cabang ASC, c.id ASC
        OFFSET @offset ROWS
        FETCH NEXT @pageSize ROWS ONLY;
      `),
      countRequest.query(`
        SELECT COUNT_BIG(1) AS total
        FROM dbo.master_cabang c
        INNER JOIN dbo.master_kanwil k
          ON k.id = c.kanwil_id
        ${whereClause};
      `),
      db.request().query(`
        SELECT
          COUNT_BIG(1) AS total,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive,
          COUNT_BIG(DISTINCT kanwil_id) AS kanwil_count
        FROM dbo.master_cabang;
      `),
    ])

    const total = Number(countResult.recordset[0]?.total || 0)
    const summary = summaryResult.recordset[0] || {}

    return NextResponse.json({
      success: true,
      data: {
        cabangs: listResult.recordset.map((item) => ({
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
          total: Number(summary.total || 0),
          active: Number(summary.active || 0),
          inactive: Number(summary.inactive || 0),
          kanwil_count: Number(summary.kanwil_count || 0),
        },
      },
    })
  } catch (error) {
    console.error("GET master cabang error:", error)

    return createErrorResponse("Gagal mengambil data Cabang.", 500)
  }
}

export async function POST(request) {
  const authorization = await authorizeMaster(request, "create")

  if (!authorization.authorized) {
    return authorization.response
  }

  const forbiddenResponse = requireSuperAdmin(authorization)

  if (forbiddenResponse) {
    return forbiddenResponse
  }

  try {
    let body

    try {
      body = await readJsonBody(request, { maxBytes: 2 * 1024 * 1024 })
    } catch {
      return createErrorResponse("Format permintaan tidak valid.")
    }

    const validation = validatePayload(body)

    if (validation.error) {
      return createErrorResponse(validation.error)
    }

    const db = await connectDB()
    const { kanwilId, kodeCabang, namaCabang, isActive } = validation.data
    const kanwil = await getKanwilById(db, kanwilId)

    if (!kanwil) {
      return createErrorResponse("Kanwil tidak ditemukan.", 404)
    }

    if (!kanwil.is_active) {
      return createErrorResponse(
        "Cabang tidak dapat ditambahkan ke Kanwil yang tidak aktif.",
        409
      )
    }

    if (!(await isCodeAvailable(db, kodeCabang))) {
      return createErrorResponse("Kode Cabang sudah digunakan.", 409)
    }

    if (!(await isNameAvailable(db, kanwilId, namaCabang))) {
      return createErrorResponse(
        "Nama Cabang sudah tersedia pada Kanwil yang dipilih.",
        409
      )
    }

    const insertResult = await db
      .request()
      .input("kanwilId", sql.Int, kanwilId)
      .input("kodeCabang", sql.VarChar(30), kodeCabang)
      .input("namaCabang", sql.NVarChar(150), namaCabang)
      .input("isActive", sql.Bit, isActive)
      .query(`
        INSERT INTO dbo.master_cabang (
          kanwil_id,
          kode_cabang,
          nama_cabang,
          is_active,
          created_at,
          updated_at
        )
        OUTPUT INSERTED.id
        VALUES (
          @kanwilId,
          @kodeCabang,
          @namaCabang,
          @isActive,
          SYSDATETIME(),
          SYSDATETIME()
        );
      `)

    const createdId = Number(insertResult.recordset[0].id)
    const created = await getById(db, createdId)

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "CREATE",
      module: "masters.cabang",
      entityType: "master_cabang",
      entityId: createdId,
      metadata: { after: created },
    })

    return NextResponse.json(
      {
        success: true,
        message: "Data Cabang berhasil ditambahkan.",
        data: created,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("POST master cabang error:", error)

    if ([2601, 2627].includes(getSqlErrorNumber(error))) {
      return createErrorResponse(
        "Kode Cabang atau nama Cabang pada Kanwil tersebut sudah digunakan.",
        409
      )
    }

    if (getSqlErrorNumber(error) === 547) {
      return createErrorResponse("Kanwil yang dipilih tidak valid.", 409)
    }

    return createErrorResponse("Gagal menambahkan data Cabang.", 500)
  }
}

export async function PUT(request) {
  const authorization = await authorizeMaster(request, "update")

  if (!authorization.authorized) {
    return authorization.response
  }

  const forbiddenResponse = requireSuperAdmin(authorization)

  if (forbiddenResponse) {
    return forbiddenResponse
  }

  try {
    let body

    try {
      body = await readJsonBody(request, { maxBytes: 2 * 1024 * 1024 })
    } catch {
      return createErrorResponse("Format permintaan tidak valid.")
    }

    const id = normalizeId(body.id)

    if (!id) {
      return createErrorResponse("ID Cabang tidak valid.")
    }

    const validation = validatePayload(body)

    if (validation.error) {
      return createErrorResponse(validation.error)
    }

    const requestedRowVersion = normalizeRowVersionToken(body.row_version)
    if (!requestedRowVersion) {
      return createErrorResponse(
        "Versi data Cabang tidak tersedia. Muat ulang sebelum menyimpan.",
        409
      )
    }

    const db = await connectDB()
    const existing = await getById(db, id)

    if (!existing) {
      return createErrorResponse("Data Cabang tidak ditemukan.", 404)
    }

    if (requestedRowVersion !== normalizeRowVersionToken(existing.row_version)) {
      return createErrorResponse(
        "Data Cabang telah berubah oleh pengguna lain. Muat ulang sebelum menyimpan.",
        409
      )
    }

    const { kanwilId, kodeCabang, namaCabang, isActive } = validation.data
    const kanwil = await getKanwilById(db, kanwilId)

    if (!kanwil) {
      return createErrorResponse("Kanwil tidak ditemukan.", 404)
    }

    if (!kanwil.is_active) {
      return createErrorResponse(
        "Cabang tidak dapat dipindahkan atau diaktifkan pada Kanwil yang tidak aktif.",
        409
      )
    }

    if (!(await isCodeAvailable(db, kodeCabang, id))) {
      return createErrorResponse("Kode Cabang sudah digunakan.", 409)
    }

    if (!(await isNameAvailable(db, kanwilId, namaCabang, id))) {
      return createErrorResponse(
        "Nama Cabang sudah tersedia pada Kanwil yang dipilih.",
        409
      )
    }

    const updateResult = await db
      .request()
      .input("id", sql.Int, id)
      .input(
        "rowVersion",
        sql.VarBinary(8),
        Buffer.from(requestedRowVersion.slice(2), "hex")
      )
      .input("kanwilId", sql.Int, kanwilId)
      .input("kodeCabang", sql.VarChar(30), kodeCabang)
      .input("namaCabang", sql.NVarChar(150), namaCabang)
      .input("isActive", sql.Bit, isActive)
      .query(`
        UPDATE dbo.master_cabang
        SET
          kanwil_id = @kanwilId,
          kode_cabang = @kodeCabang,
          nama_cabang = @namaCabang,
          is_active = @isActive,
          updated_at = SYSDATETIME()
        WHERE id = @id
          AND row_version = @rowVersion;
      `)

    if (Number(updateResult.rowsAffected?.[0] || 0) === 0) {
      return createErrorResponse(
        "Data Cabang telah berubah oleh pengguna lain. Muat ulang sebelum menyimpan.",
        409
      )
    }

    const updated = await getById(db, id)

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "UPDATE",
      module: "masters.cabang",
      entityType: "master_cabang",
      entityId: id,
      metadata: {
        before: existing,
        after: updated,
      },
    })

    return NextResponse.json({
      success: true,
      message: "Data Cabang berhasil diperbarui.",
      data: updated,
    })
  } catch (error) {
    console.error("PUT master cabang error:", error)

    if ([2601, 2627].includes(getSqlErrorNumber(error))) {
      return createErrorResponse(
        "Kode Cabang atau nama Cabang pada Kanwil tersebut sudah digunakan.",
        409
      )
    }

    if (getSqlErrorNumber(error) === 547) {
      return createErrorResponse("Kanwil yang dipilih tidak valid.", 409)
    }

    return createErrorResponse("Gagal memperbarui data Cabang.", 500)
  }
}

export async function DELETE(request) {
  const authorization = await authorizeMaster(request, "delete")

  if (!authorization.authorized) {
    return authorization.response
  }

  const forbiddenResponse = requireSuperAdmin(authorization)

  if (forbiddenResponse) {
    return forbiddenResponse
  }

  try {
    let body

    try {
      body = await readJsonBody(request, { maxBytes: 2 * 1024 * 1024 })
    } catch {
      return createErrorResponse("Format permintaan tidak valid.")
    }

    const id = normalizeId(body.id)

    if (!id) {
      return createErrorResponse("ID Cabang tidak valid.")
    }

    const db = await connectDB()
    const existing = await getById(db, id)

    if (!existing) {
      return createErrorResponse("Data Cabang tidak ditemukan.", 404)
    }

    await db
      .request()
      .input("id", sql.Int, id)
      .query(`
        DELETE FROM dbo.master_cabang
        WHERE id = @id;
      `)

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "DELETE",
      module: "masters.cabang",
      entityType: "master_cabang",
      entityId: id,
      metadata: { before: existing },
    })

    return NextResponse.json({
      success: true,
      message: "Data Cabang berhasil dihapus.",
    })
  } catch (error) {
    console.error("DELETE master cabang error:", error)

    if (getSqlErrorNumber(error) === 547) {
      return createErrorResponse(
        "Cabang masih digunakan oleh data mesin atau data lain sehingga tidak dapat dihapus.",
        409
      )
    }

    return createErrorResponse("Gagal menghapus data Cabang.", 500)
  }
}
