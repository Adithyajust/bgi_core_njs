import { NextResponse } from "next/server"

import { authorizeApiRequest } from "@/lib/access-control"
import { connectDB, sql } from "@/lib/mssql"

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
  const kodeMerk = normalizeCode(body.kode_merk)
  const namaMerk = normalizeText(body.nama_merk)
  const isActive = normalizeBoolean(body.is_active, true)

  if (!kodeMerk) {
    return { error: "Kode Merk wajib diisi.", data: null }
  }

  if (!namaMerk) {
    return { error: "Nama Merk wajib diisi.", data: null }
  }

  if (kodeMerk.length > 30) {
    return { error: "Kode Merk maksimal 30 karakter.", data: null }
  }

  if (!/^[A-Z0-9][A-Z0-9._/-]*$/.test(kodeMerk)) {
    return {
      error:
        "Kode Merk hanya boleh berisi huruf, angka, titik, garis miring, garis bawah, atau tanda hubung.",
      data: null,
    }
  }

  if (namaMerk.length > 150) {
    return { error: "Nama Merk maksimal 150 karakter.", data: null }
  }

  return {
    error: null,
    data: {
      kodeMerk,
      namaMerk,
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

async function authorizeMaster(request) {
  return authorizeApiRequest(request, "/masters")
}

function requireSuperAdmin(authorization) {
  if (authorization.user.role_code === "SUPER_ADMIN") {
    return null
  }

  return createErrorResponse(
    "Hanya Super Admin yang dapat mengubah Master Merk.",
    403
  )
}

async function isCodeAvailable(db, kodeMerk, ignoredId = null) {
  const request = db
    .request()
    .input("kodeMerk", sql.VarChar(30), kodeMerk)

  let query = `
    SELECT TOP 1 id
    FROM dbo.master_merk
    WHERE UPPER(kode_merk) = @kodeMerk
  `

  if (ignoredId !== null) {
    request.input("ignoredId", sql.Int, ignoredId)
    query += " AND id <> @ignoredId"
  }

  const result = await request.query(`${query};`)

  return result.recordset.length === 0
}

async function isNameAvailable(db, namaMerk, ignoredId = null) {
  const dbRequest = db
    .request()
    .input("namaMerk", sql.NVarChar(150), namaMerk)

  let query = `
    SELECT TOP 1 id
    FROM dbo.master_merk
    WHERE UPPER(nama_merk) = UPPER(@namaMerk)
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
        k.id,
        k.kode_merk,
        k.nama_merk,
        k.is_active,
        k.created_at,
        k.updated_at,
        COUNT_BIG(c.id) AS jumlah_tipe,
        SUM(CASE WHEN c.is_active = 1 THEN 1 ELSE 0 END) AS tipe_aktif
      FROM dbo.master_merk k
      LEFT JOIN dbo.master_tipe_mesin c
        ON c.merk_id = k.id
      WHERE k.id = @id
      GROUP BY
        k.id,
        k.kode_merk,
        k.nama_merk,
        k.is_active,
        k.created_at,
        k.updated_at;
    `)

  return result.recordset[0] || null
}

export async function GET(request) {
  const authorization = await authorizeMaster(request)

  if (!authorization.authorized) {
    return authorization.response
  }

  try {
    const { searchParams } = new URL(request.url)
    const mode = normalizeText(searchParams.get("mode")).toLowerCase()
    const db = await connectDB()

    if (mode === "options") {
      const includeInactive = normalizeBoolean(
        searchParams.get("include_inactive"),
        false
      )

      const optionsRequest = db.request()
      let whereClause = ""

      if (!includeInactive) {
        whereClause = "WHERE is_active = 1"
      }

      const result = await optionsRequest.query(`
        SELECT
          id,
          kode_merk,
          nama_merk,
          is_active
        FROM dbo.master_merk
        ${whereClause}
        ORDER BY nama_merk ASC, id ASC;
      `)

      return NextResponse.json({
        success: true,
        data: {
          merks: result.recordset,
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
        k.kode_merk LIKE @search
        OR k.nama_merk LIKE @search
      )`)
    }

    if (activeFilter !== null) {
      listRequest.input("isActive", sql.Bit, activeFilter)
      countRequest.input("isActive", sql.Bit, activeFilter)
      whereParts.push("k.is_active = @isActive")
    }

    const whereClause =
      whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : ""

    const [listResult, countResult, summaryResult] = await Promise.all([
      listRequest.query(`
        SELECT
          k.id,
          k.kode_merk,
          k.nama_merk,
          k.is_active,
          k.created_at,
          k.updated_at,
          COUNT_BIG(c.id) AS jumlah_tipe,
          SUM(CASE WHEN c.is_active = 1 THEN 1 ELSE 0 END) AS tipe_aktif
        FROM dbo.master_merk k
        LEFT JOIN dbo.master_tipe_mesin c
          ON c.merk_id = k.id
        ${whereClause}
        GROUP BY
          k.id,
          k.kode_merk,
          k.nama_merk,
          k.is_active,
          k.created_at,
          k.updated_at
        ORDER BY k.nama_merk ASC, k.id ASC
        OFFSET @offset ROWS
        FETCH NEXT @pageSize ROWS ONLY;
      `),
      countRequest.query(`
        SELECT COUNT_BIG(1) AS total
        FROM dbo.master_merk k
        ${whereClause};
      `),
      db.request().query(`
        SELECT
          COUNT_BIG(1) AS total,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive
        FROM dbo.master_merk;

        SELECT COUNT_BIG(1) AS total_tipe
        FROM dbo.master_tipe_mesin;
      `),
    ])

    const total = Number(countResult.recordset[0]?.total || 0)
    const summaryMerk = summaryResult.recordsets[0]?.[0] || {}
    const summaryTipe = summaryResult.recordsets[1]?.[0] || {}

    return NextResponse.json({
      success: true,
      data: {
        merks: listResult.recordset.map((item) => ({
          ...item,
          jumlah_tipe: Number(item.jumlah_tipe || 0),
          tipe_aktif: Number(item.tipe_aktif || 0),
        })),
        pagination: {
          page,
          page_size: pageSize,
          total,
          total_pages: Math.max(1, Math.ceil(total / pageSize)),
        },
        summary: {
          total: Number(summaryMerk.total || 0),
          active: Number(summaryMerk.active || 0),
          inactive: Number(summaryMerk.inactive || 0),
          total_tipe: Number(summaryTipe.total_tipe || 0),
        },
      },
    })
  } catch (error) {
    console.error("GET master merk error:", error)

    return createErrorResponse("Gagal mengambil data Merk.", 500)
  }
}

export async function POST(request) {
  const authorization = await authorizeMaster(request)

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
    const { kodeMerk, namaMerk, isActive } = validation.data

    if (!(await isCodeAvailable(db, kodeMerk))) {
      return createErrorResponse("Kode Merk sudah digunakan.", 409)
    }

    if (!(await isNameAvailable(db, namaMerk))) {
      return createErrorResponse("Nama Merk sudah digunakan.", 409)
    }

    const insertResult = await db
      .request()
      .input("kodeMerk", sql.VarChar(30), kodeMerk)
      .input("namaMerk", sql.NVarChar(150), namaMerk)
      .input("isActive", sql.Bit, isActive)
      .query(`
        INSERT INTO dbo.master_merk (
          kode_merk,
          nama_merk,
          is_active,
          created_at,
          updated_at
        )
        OUTPUT INSERTED.id
        VALUES (
          @kodeMerk,
          @namaMerk,
          @isActive,
          SYSDATETIME(),
          SYSDATETIME()
        );
      `)

    const created = await getById(db, insertResult.recordset[0].id)

    return NextResponse.json(
      {
        success: true,
        message: "Data Merk berhasil ditambahkan.",
        data: created,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("POST master merk error:", error)

    if ([2601, 2627].includes(getSqlErrorNumber(error))) {
      return createErrorResponse(
        "Kode atau nama Merk sudah digunakan.",
        409
      )
    }

    return createErrorResponse("Gagal menambahkan data Merk.", 500)
  }
}

export async function PUT(request) {
  const authorization = await authorizeMaster(request)

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
      return createErrorResponse("ID Merk tidak valid.")
    }

    const validation = validatePayload(body)

    if (validation.error) {
      return createErrorResponse(validation.error)
    }

    const db = await connectDB()
    const existing = await getById(db, id)

    if (!existing) {
      return createErrorResponse("Data Merk tidak ditemukan.", 404)
    }

    const { kodeMerk, namaMerk, isActive } = validation.data

    if (!(await isCodeAvailable(db, kodeMerk, id))) {
      return createErrorResponse("Kode Merk sudah digunakan.", 409)
    }

    if (!(await isNameAvailable(db, namaMerk, id))) {
      return createErrorResponse("Nama Merk sudah digunakan.", 409)
    }

    if (!isActive && Number(existing.tipe_aktif || 0) > 0) {
      return createErrorResponse(
        "Merk belum dapat dinonaktifkan karena masih memiliki Tipe Mesin aktif.",
        409
      )
    }

    await db
      .request()
      .input("id", sql.Int, id)
      .input("kodeMerk", sql.VarChar(30), kodeMerk)
      .input("namaMerk", sql.NVarChar(150), namaMerk)
      .input("isActive", sql.Bit, isActive)
      .query(`
        UPDATE dbo.master_merk
        SET
          kode_merk = @kodeMerk,
          nama_merk = @namaMerk,
          is_active = @isActive,
          updated_at = SYSDATETIME()
        WHERE id = @id;
      `)

    return NextResponse.json({
      success: true,
      message: "Data Merk berhasil diperbarui.",
      data: await getById(db, id),
    })
  } catch (error) {
    console.error("PUT master merk error:", error)

    if ([2601, 2627].includes(getSqlErrorNumber(error))) {
      return createErrorResponse(
        "Kode atau nama Merk sudah digunakan.",
        409
      )
    }

    return createErrorResponse("Gagal memperbarui data Merk.", 500)
  }
}

export async function DELETE(request) {
  const authorization = await authorizeMaster(request)

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
      return createErrorResponse("ID Merk tidak valid.")
    }

    const db = await connectDB()
    const existing = await getById(db, id)

    if (!existing) {
      return createErrorResponse("Data Merk tidak ditemukan.", 404)
    }

    if (Number(existing.jumlah_tipe || 0) > 0) {
      return createErrorResponse(
        "Merk tidak dapat dihapus karena masih digunakan oleh data Tipe Mesin.",
        409
      )
    }

    await db
      .request()
      .input("id", sql.Int, id)
      .query(`
        DELETE FROM dbo.master_merk
        WHERE id = @id;
      `)

    return NextResponse.json({
      success: true,
      message: "Data Merk berhasil dihapus.",
    })
  } catch (error) {
    console.error("DELETE master merk error:", error)

    if (getSqlErrorNumber(error) === 547) {
      return createErrorResponse(
        "Merk masih digunakan oleh data lain dan tidak dapat dihapus.",
        409
      )
    }

    return createErrorResponse("Gagal menghapus data Merk.", 500)
  }
}
