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
  const merkId = normalizeId(body.merk_id)
  const jenisMesin = normalizeText(body.jenis_mesin)
  const namaModel = normalizeText(body.nama_model)
  const isActive = normalizeBoolean(body.is_active, true)

  if (!merkId) {
    return { error: "Merk wajib dipilih.", data: null }
  }

  if (!jenisMesin) {
    return { error: "Jenis Mesin wajib diisi.", data: null }
  }

  if (!namaModel) {
    return { error: "Nama Model wajib diisi.", data: null }
  }

  if (jenisMesin.length > 100) {
    return { error: "Jenis Mesin maksimal 100 karakter.", data: null }
  }

  if (namaModel.length > 150) {
    return { error: "Nama Model maksimal 150 karakter.", data: null }
  }

  return {
    error: null,
    data: {
      merkId,
      jenisMesin,
      namaModel,
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
    "Hanya Super Admin yang dapat mengubah Master Tipe Mesin.",
    403
  )
}

async function getMerkById(db, id) {
  const result = await db
    .request()
    .input("id", sql.Int, id)
    .query(`
      SELECT TOP 1
        id,
        kode_merk,
        nama_merk,
        is_active
      FROM dbo.master_merk
      WHERE id = @id;
    `)

  return result.recordset[0] || null
}

async function isCombinationAvailable(
  db,
  merkId,
  jenisMesin,
  namaModel,
  ignoredId = null
) {
  const dbRequest = db
    .request()
    .input("merkId", sql.Int, merkId)
    .input("jenisMesin", sql.NVarChar(100), jenisMesin)
    .input("namaModel", sql.NVarChar(150), namaModel)

  let query = `
    SELECT TOP 1 id
    FROM dbo.master_tipe_mesin
    WHERE merk_id = @merkId
      AND UPPER(jenis_mesin) = UPPER(@jenisMesin)
      AND UPPER(nama_model) = UPPER(@namaModel)
  `

  if (ignoredId !== null) {
    dbRequest.input("ignoredId", sql.Int, ignoredId)
    query += " AND id <> @ignoredId"
  }

  const result = await dbRequest.query(`${query};`)

  return result.recordset.length === 0
}

async function getById(db, id) {
  const result = await db
    .request()
    .input("id", sql.Int, id)
    .query(`
      SELECT TOP 1
        c.id,
        c.merk_id,
        k.kode_merk,
        k.nama_merk,
        k.is_active AS merk_is_active,
        c.jenis_mesin,
        c.nama_model,
        c.is_active,
        c.row_version,
        c.created_at,
        c.updated_at
      FROM dbo.master_tipe_mesin c
      INNER JOIN dbo.master_merk k
        ON k.id = c.merk_id
      WHERE c.id = @id;
    `)

  const item = result.recordset[0] || null
  return item
    ? { ...item, row_version: normalizeRowVersionToken(item.row_version) }
    : null
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
      const merkId = normalizeId(searchParams.get("merk_id"))
      const includeInactive = normalizeBoolean(
        searchParams.get("include_inactive"),
        false
      )
      const optionRequest = db.request()
      const whereParts = []

      if (merkId) {
        optionRequest.input("merkId", sql.Int, merkId)
        whereParts.push("c.merk_id = @merkId")
      }

      if (!includeInactive) {
        whereParts.push("c.is_active = 1")
        whereParts.push("k.is_active = 1")
      }

      const whereClause =
        whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : ""

      const result = await optionRequest.query(`
        SELECT
          c.id,
          c.merk_id,
          c.jenis_mesin,
          c.nama_model,
          c.is_active,
          k.kode_merk,
          k.nama_merk
        FROM dbo.master_tipe_mesin c
        INNER JOIN dbo.master_merk k
          ON k.id = c.merk_id
        ${whereClause}
        ORDER BY k.nama_merk ASC, c.nama_model ASC, c.id ASC;
      `)

      return NextResponse.json({
        success: true,
        data: {
          tipeMesins: result.recordset,
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
    const merkId = normalizeId(searchParams.get("merk_id"))
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
        c.jenis_mesin LIKE @search
        OR c.nama_model LIKE @search
        OR k.kode_merk LIKE @search
        OR k.nama_merk LIKE @search
      )`)
    }

    if (activeFilter !== null) {
      listRequest.input("isActive", sql.Bit, activeFilter)
      countRequest.input("isActive", sql.Bit, activeFilter)
      whereParts.push("c.is_active = @isActive")
    }

    if (merkId) {
      listRequest.input("merkId", sql.Int, merkId)
      countRequest.input("merkId", sql.Int, merkId)
      whereParts.push("c.merk_id = @merkId")
    }

    const whereClause =
      whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : ""

    const [listResult, countResult, summaryResult] = await Promise.all([
      listRequest.query(`
        SELECT
          c.id,
          c.merk_id,
          k.kode_merk,
          k.nama_merk,
          k.is_active AS merk_is_active,
          c.jenis_mesin,
          c.nama_model,
          c.is_active,
          c.row_version,
          c.created_at,
          c.updated_at
        FROM dbo.master_tipe_mesin c
        INNER JOIN dbo.master_merk k
          ON k.id = c.merk_id
        ${whereClause}
        ORDER BY k.nama_merk ASC, c.nama_model ASC, c.id ASC
        OFFSET @offset ROWS
        FETCH NEXT @pageSize ROWS ONLY;
      `),
      countRequest.query(`
        SELECT COUNT_BIG(1) AS total
        FROM dbo.master_tipe_mesin c
        INNER JOIN dbo.master_merk k
          ON k.id = c.merk_id
        ${whereClause};
      `),
      db.request().query(`
        SELECT
          COUNT_BIG(1) AS total,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive,
          COUNT_BIG(DISTINCT merk_id) AS merk_count
        FROM dbo.master_tipe_mesin;
      `),
    ])

    const total = Number(countResult.recordset[0]?.total || 0)
    const summary = summaryResult.recordset[0] || {}

    return NextResponse.json({
      success: true,
      data: {
        tipeMesins: listResult.recordset.map((item) => ({
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
          merk_count: Number(summary.merk_count || 0),
        },
      },
    })
  } catch (error) {
    console.error("GET master tipe mesin error:", error)

    return createErrorResponse("Gagal mengambil data Tipe Mesin.", 500)
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
      body = await request.json()
    } catch {
      return createErrorResponse("Format permintaan tidak valid.")
    }

    const validation = validatePayload(body)

    if (validation.error) {
      return createErrorResponse(validation.error)
    }

    const db = await connectDB()
    const { merkId, jenisMesin, namaModel, isActive } = validation.data
    const merk = await getMerkById(db, merkId)

    if (!merk) {
      return createErrorResponse("Merk tidak ditemukan.", 404)
    }

    if (!merk.is_active) {
      return createErrorResponse(
        "Tipe Mesin tidak dapat ditambahkan ke Merk yang tidak aktif.",
        409
      )
    }

    if (
      !(await isCombinationAvailable(db, merkId, jenisMesin, namaModel))
    ) {
      return createErrorResponse(
        "Kombinasi Merk, Jenis Mesin, dan Nama Model sudah digunakan.",
        409
      )
    }

    const insertResult = await db
      .request()
      .input("merkId", sql.Int, merkId)
      .input("jenisMesin", sql.NVarChar(100), jenisMesin)
      .input("namaModel", sql.NVarChar(150), namaModel)
      .input("isActive", sql.Bit, isActive)
      .query(`
        INSERT INTO dbo.master_tipe_mesin (
          merk_id,
          jenis_mesin,
          nama_model,
          is_active,
          created_at,
          updated_at
        )
        OUTPUT INSERTED.id
        VALUES (
          @merkId,
          @jenisMesin,
          @namaModel,
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
      module: "masters.tipe_mesin",
      entityType: "master_tipe_mesin",
      entityId: createdId,
      metadata: { after: created },
    })

    return NextResponse.json(
      {
        success: true,
        message: "Data Tipe Mesin berhasil ditambahkan.",
        data: created,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("POST master tipe mesin error:", error)

    if ([2601, 2627].includes(getSqlErrorNumber(error))) {
      return createErrorResponse(
        "Kombinasi Merk, Jenis Mesin, dan Nama Model sudah digunakan.",
        409
      )
    }

    if (getSqlErrorNumber(error) === 547) {
      return createErrorResponse("Merk yang dipilih tidak valid.", 409)
    }

    return createErrorResponse("Gagal menambahkan data Tipe Mesin.", 500)
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
      body = await request.json()
    } catch {
      return createErrorResponse("Format permintaan tidak valid.")
    }

    const id = normalizeId(body.id)

    if (!id) {
      return createErrorResponse("ID Tipe Mesin tidak valid.")
    }

    const validation = validatePayload(body)

    if (validation.error) {
      return createErrorResponse(validation.error)
    }

    const requestedRowVersion = normalizeRowVersionToken(body.row_version)
    if (!requestedRowVersion) {
      return createErrorResponse(
        "Versi data Tipe Mesin tidak tersedia. Muat ulang sebelum menyimpan.",
        409
      )
    }

    const db = await connectDB()
    const existing = await getById(db, id)

    if (!existing) {
      return createErrorResponse("Data Tipe Mesin tidak ditemukan.", 404)
    }

    if (requestedRowVersion !== normalizeRowVersionToken(existing.row_version)) {
      return createErrorResponse(
        "Data Tipe Mesin telah berubah oleh pengguna lain. Muat ulang sebelum menyimpan.",
        409
      )
    }

    const { merkId, jenisMesin, namaModel, isActive } = validation.data
    const merk = await getMerkById(db, merkId)

    if (!merk) {
      return createErrorResponse("Merk tidak ditemukan.", 404)
    }

    if (
      !merk.is_active &&
      (isActive || Number(existing.merk_id) !== Number(merkId))
    ) {
      return createErrorResponse(
        "Tipe Mesin tidak dapat dipindahkan atau diaktifkan pada Merk yang tidak aktif.",
        409
      )
    }

    if (
      !(await isCombinationAvailable(db, merkId, jenisMesin, namaModel, id))
    ) {
      return createErrorResponse(
        "Kombinasi Merk, Jenis Mesin, dan Nama Model sudah digunakan.",
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
      .input("merkId", sql.Int, merkId)
      .input("jenisMesin", sql.NVarChar(100), jenisMesin)
      .input("namaModel", sql.NVarChar(150), namaModel)
      .input("isActive", sql.Bit, isActive)
      .query(`
        UPDATE dbo.master_tipe_mesin
        SET
          merk_id = @merkId,
          jenis_mesin = @jenisMesin,
          nama_model = @namaModel,
          is_active = @isActive,
          updated_at = SYSDATETIME()
        WHERE id = @id
          AND row_version = @rowVersion;
      `)

    if (Number(updateResult.rowsAffected?.[0] || 0) === 0) {
      return createErrorResponse(
        "Data Tipe Mesin telah berubah oleh pengguna lain. Muat ulang sebelum menyimpan.",
        409
      )
    }

    const updated = await getById(db, id)

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "UPDATE",
      module: "masters.tipe_mesin",
      entityType: "master_tipe_mesin",
      entityId: id,
      metadata: {
        before: existing,
        after: updated,
      },
    })

    return NextResponse.json({
      success: true,
      message: "Data Tipe Mesin berhasil diperbarui.",
      data: updated,
    })
  } catch (error) {
    console.error("PUT master tipe mesin error:", error)

    if ([2601, 2627].includes(getSqlErrorNumber(error))) {
      return createErrorResponse(
        "Kombinasi Merk, Jenis Mesin, dan Nama Model sudah digunakan.",
        409
      )
    }

    if (getSqlErrorNumber(error) === 547) {
      return createErrorResponse("Merk yang dipilih tidak valid.", 409)
    }

    return createErrorResponse("Gagal memperbarui data Tipe Mesin.", 500)
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
      body = await request.json()
    } catch {
      return createErrorResponse("Format permintaan tidak valid.")
    }

    const id = normalizeId(body.id)

    if (!id) {
      return createErrorResponse("ID Tipe Mesin tidak valid.")
    }

    const db = await connectDB()
    const existing = await getById(db, id)

    if (!existing) {
      return createErrorResponse("Data Tipe Mesin tidak ditemukan.", 404)
    }

    await db
      .request()
      .input("id", sql.Int, id)
      .query(`
        DELETE FROM dbo.master_tipe_mesin
        WHERE id = @id;
      `)

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "DELETE",
      module: "masters.tipe_mesin",
      entityType: "master_tipe_mesin",
      entityId: id,
      metadata: { before: existing },
    })

    return NextResponse.json({
      success: true,
      message: "Data Tipe Mesin berhasil dihapus.",
    })
  } catch (error) {
    console.error("DELETE master tipe mesin error:", error)

    if (getSqlErrorNumber(error) === 547) {
      return createErrorResponse(
        "Tipe Mesin masih digunakan oleh data mesin atau data lain sehingga tidak dapat dihapus.",
        409
      )
    }

    return createErrorResponse("Gagal menghapus data Tipe Mesin.", 500)
  }
}
