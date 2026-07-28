import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { connectDB, sql } from "@/lib/mssql"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_PAGE_SIZE = 10
const MAXIMUM_PAGE_SIZE = 100

const SITE_VALUES = new Set(["ONSITE", "OFFSITE"])
const WARRANTY_VALUES = new Set(["IN WARRANTY", "OUT WARRANTY"])
const OPERATION_DAY_VALUES = new Set(["WEEKDAYS", "ALL DAYS"])
const OPERATION_HOUR_VALUES = new Set(["24 JAM", "NON 24 JAM"])
const OPERATION_TIME_VALUES = new Set([
  "00:00 - 23:59",
  "06:00 - 15:00",
  "06:00 - 18:00",
  "06:00 - 21:00",
  "09:00 - 18:00",
  "09:00 - 21:00",
])
const LOCATION_CATEGORY_VALUES = new Set([
  "ALFAMART",
  "ALFAMIDI",
  "APARTEMEN",
  "BANDARA",
  "HOTEL",
  "INDOMARET",
  "INSTANSI BUMN/BUMD",
  "INSTANSI MILITER",
  "INSTANSI PEMERINTAHAN",
  "KC",
  "KCP",
  "KEPOLISIAN",
  "KK",
  "MALL",
  "MINI MARKET",
  "PASAR",
  "PERKANTORAN",
  "PERUMAHAN",
  "PLAZA",
  "RUMAH SAKIT",
  "SPBU",
  "STASIUN",
  "SWALAYAN",
  "TEMPAT HIBURAN",
  "TEMPAT OLAHRAGA",
  "TEMPAT PENDIDIKAN",
  "TEMPAT WISATA",
  "UNIT BRI",
])

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

function normalizeNullableText(value) {
  const normalized = normalizeText(value)
  return normalized || null
}

function normalizeUpperText(value) {
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

function parseNullableCoordinate(value, label, minimum, maximum) {
  if (value === undefined || value === null || value === "") {
    return { value: null, error: null }
  }

  const parsedValue = Number(value)

  if (!Number.isFinite(parsedValue)) {
    return { value: null, error: `${label} harus berupa angka.` }
  }

  if (parsedValue < minimum || parsedValue > maximum) {
    return {
      value: null,
      error: `${label} harus berada pada rentang ${minimum} sampai ${maximum}.`,
    }
  }

  return {
    value: Number(parsedValue.toFixed(6)),
    error: null,
  }
}

function validatePayload(body) {
  const tid = normalizeUpperText(body?.tid)
  const sn = normalizeUpperText(body?.sn)
  const dbValue = normalizeNullableText(body?.db)
  const cabangId = normalizeId(body?.cabang_id)
  const projectId = normalizeId(body?.project_id)
  const lokasi = normalizeText(body?.lokasi)
  const site = normalizeUpperText(body?.site)
  const tipeMesinId = normalizeId(body?.tipe_mesin_id)
  const kategoriMesin = normalizeUpperText(body?.kategori_mesin)
  const kategoriLokasi = normalizeUpperText(
    body?.kategori_lokasi ?? body?.kategori
  )
  const garansi = normalizeUpperText(body?.garansi)
  const hariOps = normalizeUpperText(body?.hari_ops)
  const jamOps = normalizeUpperText(body?.jam_ops)
  const waktuOps = normalizeText(body?.waktu_ops)
  const longitude = parseNullableCoordinate(
    body?.longitude,
    "Longitude",
    -180,
    180
  )
  const latitude = parseNullableCoordinate(
    body?.latitude,
    "Latitude",
    -90,
    90
  )
  const isActive = normalizeBoolean(body?.is_active, true)

  if (!tid) {
    return { error: "TID wajib diisi.", data: null }
  }

  if (tid.length > 50) {
    return { error: "TID maksimal 50 karakter.", data: null }
  }

  if (!sn) {
    return { error: "SN wajib diisi.", data: null }
  }

  if (sn.length > 100) {
    return { error: "SN maksimal 100 karakter.", data: null }
  }

  if (dbValue && dbValue.length > 100) {
    return { error: "DB maksimal 100 karakter.", data: null }
  }

  if (!cabangId) {
    return { error: "Cabang pengelola wajib dipilih.", data: null }
  }

  if (!projectId) {
    return { error: "Project wajib dipilih.", data: null }
  }

  if (!lokasi) {
    return { error: "Lokasi fisik mesin wajib diisi.", data: null }
  }

  if (lokasi.length > 500) {
    return { error: "Lokasi maksimal 500 karakter.", data: null }
  }

  if (!SITE_VALUES.has(site)) {
    return { error: "Site tidak valid.", data: null }
  }

  if (!tipeMesinId) {
    return { error: "Tipe Mesin wajib dipilih.", data: null }
  }

  if (kategoriMesin && kategoriMesin.length > 100) {
    return { error: "Kategori Mesin maksimal 100 karakter.", data: null }
  }

  if (!LOCATION_CATEGORY_VALUES.has(kategoriLokasi)) {
    return { error: "Kategori Lokasi tidak valid.", data: null }
  }

  if (!WARRANTY_VALUES.has(garansi)) {
    return { error: "Status garansi tidak valid.", data: null }
  }

  if (!OPERATION_DAY_VALUES.has(hariOps)) {
    return { error: "Hari operasional tidak valid.", data: null }
  }

  if (!OPERATION_HOUR_VALUES.has(jamOps)) {
    return { error: "Jam operasional tidak valid.", data: null }
  }

  if (!OPERATION_TIME_VALUES.has(waktuOps)) {
    return { error: "Waktu operasional tidak valid.", data: null }
  }

  if (jamOps === "24 JAM" && waktuOps !== "00:00 - 23:59") {
    return {
      error: "Mesin dengan Jam Operasional 24 JAM harus memakai waktu 00:00 - 23:59.",
      data: null,
    }
  }

  if (jamOps === "NON 24 JAM" && waktuOps === "00:00 - 23:59") {
    return {
      error: "Mesin NON 24 JAM harus memakai rentang waktu selain 00:00 - 23:59.",
      data: null,
    }
  }

  if (longitude.error) {
    return { error: longitude.error, data: null }
  }

  if (latitude.error) {
    return { error: latitude.error, data: null }
  }

  return {
    error: null,
    data: {
      tid,
      sn,
      dbValue,
      cabangId,
      projectId,
      lokasi,
      site,
      tipeMesinId,
      kategoriMesin,
      kategoriLokasi,
      garansi,
      hariOps,
      jamOps,
      waktuOps,
      longitude: longitude.value,
      latitude: latitude.value,
      isActive,
    },
  }
}

async function authorizeMaster(request) {
  return authorizeApiRequest(request, "/masters")
}

function resolveDataScope(authorization) {
  const scope = getUserDataScope(authorization.user)

  if (!scope.isSuperAdmin && !scope.codeUker) {
    return {
      scope: null,
      response: createErrorResponse(
        "Unit kerja pengguna belum terhubung. Hubungi Super Admin.",
        403
      ),
    }
  }

  return {
    scope,
    response: null,
  }
}


async function getMasterMesinSchema(db) {
  const result = await db.request().query(`
    SELECT
      CASE
        WHEN COL_LENGTH(N'dbo.master_mesin', N'tid') IS NULL THEN CAST(0 AS BIT)
        ELSE CAST(1 AS BIT)
      END AS tid_enabled;
  `)

  return {
    tidEnabled: Boolean(result.recordset[0]?.tid_enabled),
  }
}

async function getCabangById(db, id) {
  const result = await db
    .request()
    .input("id", sql.Int, id)
    .query(`
      SELECT TOP 1
        c.id,
        c.kode_cabang,
        c.nama_cabang,
        c.is_active,
        k.kode_kanwil,
        k.nama_kanwil,
        k.is_active AS kanwil_is_active
      FROM dbo.master_cabang c
      INNER JOIN dbo.master_kanwil k
        ON k.id = c.kanwil_id
      WHERE c.id = @id;
    `)

  return result.recordset[0] || null
}

async function getProjectById(db, id, scopeCodeUker = null) {
  const result = await db
    .request()
    .input("id", sql.BigInt, id)
    .input("scopeCodeUker", sql.NVarChar(20), scopeCodeUker)
    .query(`
      SELECT TOP 1
        p.id,
        p.kode_project,
        p.nama_project,
        p.status_project,
        p.is_active,
        mu.codeuker,
        mu.nama_uker
      FROM dbo.master_project p
      INNER JOIN dbo.master_uker mu
        ON mu.id = p.uker_id
      WHERE p.id = @id
        AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker);
    `)

  return result.recordset[0] || null
}

async function getTipeMesinById(db, id) {
  const result = await db
    .request()
    .input("id", sql.Int, id)
    .query(`
      SELECT TOP 1
        t.id,
        t.jenis_mesin,
        t.nama_model,
        t.is_active,
        m.kode_merk,
        m.nama_merk,
        m.is_active AS merk_is_active
      FROM dbo.master_tipe_mesin t
      INNER JOIN dbo.master_merk m
        ON m.id = t.merk_id
      WHERE t.id = @id;
    `)

  return result.recordset[0] || null
}

async function isTidAvailable(db, tid, ignoredId = null) {
  const request = db.request().input("tid", sql.VarChar(50), tid)

  let query = `
    SELECT TOP 1 id
    FROM dbo.master_mesin
    WHERE UPPER(tid) = UPPER(@tid)
  `

  if (ignoredId !== null) {
    request.input("ignoredId", sql.BigInt, ignoredId)
    query += " AND id <> @ignoredId"
  }

  const result = await request.query(`${query};`)
  return result.recordset.length === 0
}

async function isSnAvailable(db, sn, ignoredId = null) {
  const request = db.request().input("sn", sql.VarChar(100), sn)

  let query = `
    SELECT TOP 1 id
    FROM dbo.master_mesin
    WHERE UPPER(sn) = UPPER(@sn)
  `

  if (ignoredId !== null) {
    request.input("ignoredId", sql.BigInt, ignoredId)
    query += " AND id <> @ignoredId"
  }

  const result = await request.query(`${query};`)
  return result.recordset.length === 0
}

async function getById(db, id, scopeCodeUker = null, schema = { tidEnabled: true }) {
  const tidSelect = schema.tidEnabled
    ? "ms.tid"
    : "CAST(NULL AS VARCHAR(50)) AS tid"

  const result = await db
    .request()
    .input("id", sql.BigInt, id)
    .input("scopeCodeUker", sql.NVarChar(20), scopeCodeUker)
    .query(`
      SELECT TOP 1
        ms.id,
        ${tidSelect},
        ms.sn,
        ms.db,
        ms.cabang_id,
        c.kode_cabang,
        c.nama_cabang,
        k.kode_kanwil,
        k.nama_kanwil,
        ms.project_id,
        p.kode_project,
        p.nama_project,
        ms.lokasi,
        ms.site,
        ms.tipe_mesin_id,
        tm.jenis_mesin,
        tm.nama_model,
        mk.kode_merk,
        mk.nama_merk,
        ms.kategori_mesin,
        ms.kategori_lokasi,
        ms.garansi,
        ms.hari_ops,
        ms.jam_ops,
        ms.waktu_ops,
        ms.longitude,
        ms.latitude,
        ms.is_active,
        ms.created_at,
        ms.updated_at
      FROM dbo.master_mesin ms
      LEFT JOIN dbo.master_cabang c
        ON c.id = ms.cabang_id
      LEFT JOIN dbo.master_kanwil k
        ON k.id = c.kanwil_id
      LEFT JOIN dbo.master_project p
        ON p.id = ms.project_id
      LEFT JOIN dbo.master_uker mu
        ON mu.id = p.uker_id
      LEFT JOIN dbo.master_tipe_mesin tm
        ON tm.id = ms.tipe_mesin_id
      LEFT JOIN dbo.master_merk mk
        ON mk.id = tm.merk_id
      WHERE ms.id = @id
        AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker);
    `)

  return result.recordset[0] || null
}

async function validateReferences(db, data, scopeCodeUker = null) {
  const [cabang, project, tipeMesin] = await Promise.all([
    getCabangById(db, data.cabangId),
    getProjectById(db, data.projectId, scopeCodeUker),
    getTipeMesinById(db, data.tipeMesinId),
  ])

  if (!cabang) {
    return "Cabang pengelola tidak ditemukan."
  }

  if (!cabang.is_active || !cabang.kanwil_is_active) {
    return "Cabang pengelola atau Kanwil induknya sudah nonaktif."
  }

  if (!project) {
    return scopeCodeUker
      ? "Project tidak ditemukan atau bukan milik unit kerja Anda."
      : "Project tidak ditemukan."
  }

  if (!project.is_active) {
    return "Project yang dipilih sudah nonaktif."
  }

  if (!tipeMesin) {
    return "Tipe Mesin tidak ditemukan."
  }

  if (!tipeMesin.is_active || !tipeMesin.merk_is_active) {
    return "Tipe Mesin atau Merk induknya sudah nonaktif."
  }

  // Kategori Mesin mengikuti jenis_mesin dari Master Tipe Mesin.
  // Nilai tidak dipercayakan kepada input browser agar selalu konsisten.
  data.kategoriMesin = normalizeUpperText(tipeMesin.jenis_mesin)

  return null
}

export async function GET(request) {
  const authorization = await authorizeMaster(request)

  if (!authorization.authorized) {
    return authorization.response
  }

  const scopeResolution = resolveDataScope(authorization)

  if (scopeResolution.response) {
    return scopeResolution.response
  }

  const scope = scopeResolution.scope

  try {
    const { searchParams } = new URL(request.url)
    const mode = normalizeText(searchParams.get("mode")).toLowerCase()
    const db = await connectDB()
    const schema = await getMasterMesinSchema(db)

    if (mode === "options") {
      const [cabangResult, projectResult, tipeMesinResult] = await Promise.all([
        db.request().query(`
          SELECT
            c.id,
            c.kode_cabang,
            c.nama_cabang,
            k.kode_kanwil,
            k.nama_kanwil
          FROM dbo.master_cabang c
          INNER JOIN dbo.master_kanwil k
            ON k.id = c.kanwil_id
          WHERE c.is_active = 1
            AND k.is_active = 1
          ORDER BY k.nama_kanwil ASC, c.nama_cabang ASC, c.id ASC;
        `),
        db
          .request()
          .input("scopeCodeUker", sql.NVarChar(20), scope.codeUker)
          .query(`
            SELECT
              p.id,
              p.kode_project,
              p.nama_project,
              p.status_project
            FROM dbo.master_project p
            INNER JOIN dbo.master_uker mu
              ON mu.id = p.uker_id
            WHERE p.is_active = 1
              AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker)
            ORDER BY p.nama_project ASC, p.id ASC;
          `),
        db.request().query(`
          SELECT
            t.id,
            t.jenis_mesin,
            t.nama_model,
            m.kode_merk,
            m.nama_merk
          FROM dbo.master_tipe_mesin t
          INNER JOIN dbo.master_merk m
            ON m.id = t.merk_id
          WHERE t.is_active = 1
            AND m.is_active = 1
          ORDER BY m.nama_merk ASC, t.jenis_mesin ASC, t.nama_model ASC, t.id ASC;
        `),
      ])

      return NextResponse.json({
        success: true,
        data: {
          cabangs: cabangResult.recordset,
          projects: projectResult.recordset,
          tipeMesins: tipeMesinResult.recordset,
          scope: {
            is_super_admin: scope.isSuperAdmin,
            codeuker: scope.codeUker,
            can_manage: true,
          },
          schema: {
            tid_enabled: schema.tidEnabled,
          },
          constants: {
            location_categories: Array.from(LOCATION_CATEGORY_VALUES),
            // Dipertahankan agar UI versi lama tetap dapat membaca opsi.
            categories: Array.from(LOCATION_CATEGORY_VALUES),
            sites: Array.from(SITE_VALUES),
            warranties: Array.from(WARRANTY_VALUES),
            operation_days: Array.from(OPERATION_DAY_VALUES),
            operation_hours: Array.from(OPERATION_HOUR_VALUES),
            operation_times: Array.from(OPERATION_TIME_VALUES),
          },
        },
      })
    }

    const detailId = normalizeId(searchParams.get("id"))

    if (detailId) {
      const item = await getById(db, detailId, scope.codeUker, schema)

      if (!item) {
        return createErrorResponse("Data Mesin tidak ditemukan atau berada di luar scope unit kerja Anda.", 404)
      }

      return NextResponse.json({
        success: true,
        data: { mesin: item },
      })
    }

    const page = normalizePositiveInteger(searchParams.get("page"), 1)
    const pageSize = normalizePositiveInteger(
      searchParams.get("page_size"),
      DEFAULT_PAGE_SIZE,
      MAXIMUM_PAGE_SIZE
    )
    const offset = (page - 1) * pageSize
    const search = normalizeText(searchParams.get("search"))
    const activeFilter = parseActiveFilter(searchParams.get("is_active"))
    const cabangId = normalizeId(searchParams.get("cabang_id"))
    const projectId = normalizeId(searchParams.get("project_id"))
    const tipeMesinId = normalizeId(searchParams.get("tipe_mesin_id"))
    const kategoriMesin = normalizeUpperText(
      searchParams.get("kategori_mesin")
    )
    const kategoriLokasi = normalizeUpperText(
      searchParams.get("kategori_lokasi") ?? searchParams.get("kategori")
    )
    const site = normalizeUpperText(searchParams.get("site"))
    const garansi = normalizeUpperText(searchParams.get("garansi"))

    const listRequest = db
      .request()
      .input("offset", sql.Int, offset)
      .input("pageSize", sql.Int, pageSize)
    const countRequest = db.request()
    const whereParts = []

    if (scope.codeUker) {
      listRequest.input("scopeCodeUker", sql.NVarChar(20), scope.codeUker)
      countRequest.input("scopeCodeUker", sql.NVarChar(20), scope.codeUker)
      whereParts.push("mu.codeuker = @scopeCodeUker")
    }

    if (search) {
      const wildcard = `%${search}%`
      listRequest.input("search", sql.NVarChar(500), wildcard)
      countRequest.input("search", sql.NVarChar(500), wildcard)
      whereParts.push(`(
        ${schema.tidEnabled ? "ms.tid LIKE @search OR" : ""}
        ms.sn LIKE @search
        OR ms.db LIKE @search
        OR ms.lokasi LIKE @search
        OR c.kode_cabang LIKE @search
        OR c.nama_cabang LIKE @search
        OR k.kode_kanwil LIKE @search
        OR k.nama_kanwil LIKE @search
        OR p.kode_project LIKE @search
        OR p.nama_project LIKE @search
        OR tm.jenis_mesin LIKE @search
        OR tm.nama_model LIKE @search
        OR mk.kode_merk LIKE @search
        OR mk.nama_merk LIKE @search
        OR ms.kategori_mesin LIKE @search
        OR ms.kategori_lokasi LIKE @search
      )`)
    }

    if (activeFilter !== null) {
      listRequest.input("isActive", sql.Bit, activeFilter)
      countRequest.input("isActive", sql.Bit, activeFilter)
      whereParts.push("ms.is_active = @isActive")
    }

    if (cabangId) {
      listRequest.input("cabangId", sql.Int, cabangId)
      countRequest.input("cabangId", sql.Int, cabangId)
      whereParts.push("ms.cabang_id = @cabangId")
    }

    if (projectId) {
      listRequest.input("projectId", sql.BigInt, projectId)
      countRequest.input("projectId", sql.BigInt, projectId)
      whereParts.push("ms.project_id = @projectId")
    }

    if (tipeMesinId) {
      listRequest.input("tipeMesinId", sql.Int, tipeMesinId)
      countRequest.input("tipeMesinId", sql.Int, tipeMesinId)
      whereParts.push("ms.tipe_mesin_id = @tipeMesinId")
    }

    if (kategoriMesin) {
      listRequest.input("kategoriMesin", sql.NVarChar(100), kategoriMesin)
      countRequest.input("kategoriMesin", sql.NVarChar(100), kategoriMesin)
      whereParts.push("ms.kategori_mesin = @kategoriMesin")
    }

    if (LOCATION_CATEGORY_VALUES.has(kategoriLokasi)) {
      listRequest.input("kategoriLokasi", sql.NVarChar(50), kategoriLokasi)
      countRequest.input("kategoriLokasi", sql.NVarChar(50), kategoriLokasi)
      whereParts.push("ms.kategori_lokasi = @kategoriLokasi")
    }

    if (SITE_VALUES.has(site)) {
      listRequest.input("site", sql.VarChar(10), site)
      countRequest.input("site", sql.VarChar(10), site)
      whereParts.push("ms.site = @site")
    }


    if (WARRANTY_VALUES.has(garansi)) {
      listRequest.input("garansi", sql.VarChar(20), garansi)
      countRequest.input("garansi", sql.VarChar(20), garansi)
      whereParts.push("ms.garansi = @garansi")
    }

    const whereClause =
      whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : ""
    const tidSelect = schema.tidEnabled
      ? "ms.tid"
      : "CAST(NULL AS VARCHAR(50)) AS tid"

    const [listResult, countResult, summaryResult] = await Promise.all([
      listRequest.query(`
        SELECT
          ms.id,
          ${tidSelect},
          ms.sn,
          ms.db,
          ms.cabang_id,
          c.kode_cabang,
          c.nama_cabang,
          k.kode_kanwil,
          k.nama_kanwil,
          ms.project_id,
          p.kode_project,
          p.nama_project,
          ms.lokasi,
          ms.site,
          ms.tipe_mesin_id,
          tm.jenis_mesin,
          tm.nama_model,
          mk.kode_merk,
          mk.nama_merk,
          ms.kategori_mesin,
          ms.kategori_lokasi,
          ms.garansi,
          ms.hari_ops,
          ms.jam_ops,
          ms.waktu_ops,
          ms.longitude,
          ms.latitude,
          ms.is_active,
          ms.created_at,
          ms.updated_at
        FROM dbo.master_mesin ms
        LEFT JOIN dbo.master_cabang c
          ON c.id = ms.cabang_id
        LEFT JOIN dbo.master_kanwil k
          ON k.id = c.kanwil_id
        LEFT JOIN dbo.master_project p
          ON p.id = ms.project_id
        LEFT JOIN dbo.master_uker mu
          ON mu.id = p.uker_id
        LEFT JOIN dbo.master_tipe_mesin tm
          ON tm.id = ms.tipe_mesin_id
        LEFT JOIN dbo.master_merk mk
          ON mk.id = tm.merk_id
        ${whereClause}
        ORDER BY ms.id DESC
        OFFSET @offset ROWS
        FETCH NEXT @pageSize ROWS ONLY;
      `),
      countRequest.query(`
        SELECT COUNT_BIG(1) AS total
        FROM dbo.master_mesin ms
        LEFT JOIN dbo.master_cabang c
          ON c.id = ms.cabang_id
        LEFT JOIN dbo.master_kanwil k
          ON k.id = c.kanwil_id
        LEFT JOIN dbo.master_project p
          ON p.id = ms.project_id
        LEFT JOIN dbo.master_uker mu
          ON mu.id = p.uker_id
        LEFT JOIN dbo.master_tipe_mesin tm
          ON tm.id = ms.tipe_mesin_id
        LEFT JOIN dbo.master_merk mk
          ON mk.id = tm.merk_id
        ${whereClause};
      `),
      db
        .request()
        .input("scopeCodeUker", sql.NVarChar(20), scope.codeUker)
        .query(`
          SELECT
            COUNT_BIG(1) AS total,
            SUM(CASE WHEN ms.is_active = 1 THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN ms.site = 'ONSITE' THEN 1 ELSE 0 END) AS onsite,
            SUM(CASE WHEN ms.site = 'OFFSITE' THEN 1 ELSE 0 END) AS offsite,
            SUM(CASE WHEN ms.garansi = 'IN WARRANTY' THEN 1 ELSE 0 END) AS in_warranty
          FROM dbo.master_mesin ms
          LEFT JOIN dbo.master_project p
            ON p.id = ms.project_id
          LEFT JOIN dbo.master_uker mu
            ON mu.id = p.uker_id
          WHERE @scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker;
        `),
    ])

    const total = Number(countResult.recordset[0]?.total || 0)
    const summary = summaryResult.recordset[0] || {}

    return NextResponse.json({
      success: true,
      data: {
        mesins: listResult.recordset,
        pagination: {
          page,
          page_size: pageSize,
          total,
          total_pages: Math.max(1, Math.ceil(total / pageSize)),
        },
        summary: {
          total: Number(summary.total || 0),
          active: Number(summary.active || 0),
          onsite: Number(summary.onsite || 0),
          offsite: Number(summary.offsite || 0),
          in_warranty: Number(summary.in_warranty || 0),
        },
        schema: {
          tid_enabled: schema.tidEnabled,
        },
        notice: !schema.tidEnabled
          ? "Kolom TID belum tersedia di database. Data lama tetap ditampilkan, tetapi migration 011 harus dijalankan sebelum menambah atau mengubah Mesin."
          : Number(summary.total || 0) === 0 && scope.codeUker
            ? `Belum ada data Mesin yang terhubung ke Project unit kerja ${scope.codeUker}.`
            : Number(summary.total || 0) === 0
              ? "Tabel master_mesin belum memiliki data."
              : "",
      },
    })
  } catch (error) {
    console.error("GET master mesin error:", error)
    return createInternalErrorResponse(error, "Gagal mengambil data Mesin.")
  }
}

export async function POST(request) {
  const authorization = await authorizeMaster(request)

  if (!authorization.authorized) {
    return authorization.response
  }

  const scopeResolution = resolveDataScope(authorization)

  if (scopeResolution.response) {
    return scopeResolution.response
  }

  const scope = scopeResolution.scope

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
    const schema = await getMasterMesinSchema(db)

    if (!schema.tidEnabled) {
      return createErrorResponse(
        "Kolom TID belum tersedia. Jalankan migration 011-add-master-mesin-tid.sql terlebih dahulu.",
        409
      )
    }

    const data = validation.data
    const referenceError = await validateReferences(db, data, scope.codeUker)

    if (referenceError) {
      return createErrorResponse(referenceError)
    }

    if (!(await isTidAvailable(db, data.tid))) {
      return createErrorResponse("TID sudah digunakan oleh mesin lain.", 409)
    }

    if (!(await isSnAvailable(db, data.sn))) {
      return createErrorResponse("SN sudah digunakan oleh mesin lain.", 409)
    }

    const result = await db
      .request()
      .input("tid", sql.VarChar(50), data.tid)
      .input("sn", sql.VarChar(100), data.sn)
      .input("dbValue", sql.NVarChar(100), data.dbValue)
      .input("cabangId", sql.Int, data.cabangId)
      .input("projectId", sql.BigInt, data.projectId)
      .input("lokasi", sql.NVarChar(500), data.lokasi)
      .input("site", sql.VarChar(10), data.site)
      .input("kategoriMesin", sql.NVarChar(100), data.kategoriMesin)
      .input("tipeMesinId", sql.Int, data.tipeMesinId)
      .input("kategoriLokasi", sql.NVarChar(50), data.kategoriLokasi)
      .input("garansi", sql.VarChar(20), data.garansi)
      .input("hariOps", sql.VarChar(20), data.hariOps)
      .input("jamOps", sql.VarChar(20), data.jamOps)
      .input("waktuOps", sql.VarChar(20), data.waktuOps)
      .input("longitude", sql.Decimal(9, 6), data.longitude)
      .input("latitude", sql.Decimal(9, 6), data.latitude)
      .input("isActive", sql.Bit, data.isActive)
      .query(`
        INSERT INTO dbo.master_mesin (
          tid,
          sn,
          db,
          cabang_id,
          project_id,
          lokasi,
          site,
          kategori_mesin,
          tipe_mesin_id,
          kategori_lokasi,
          garansi,
          hari_ops,
          jam_ops,
          waktu_ops,
          longitude,
          latitude,
          is_active,
          created_at,
          updated_at
        )
        OUTPUT INSERTED.id
        VALUES (
          @tid,
          @sn,
          @dbValue,
          @cabangId,
          @projectId,
          @lokasi,
          @site,
          @kategoriMesin,
          @tipeMesinId,
          @kategoriLokasi,
          @garansi,
          @hariOps,
          @jamOps,
          @waktuOps,
          @longitude,
          @latitude,
          @isActive,
          SYSDATETIME(),
          SYSDATETIME()
        );
      `)

    const createdId = Number(result.recordset[0]?.id)
    const createdItem = await getById(db, createdId, scope.codeUker, schema)

    return NextResponse.json(
      {
        success: true,
        message: "Data Mesin berhasil ditambahkan.",
        data: { mesin: createdItem },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("POST master mesin error:", error)
    const sqlErrorNumber = getSqlErrorNumber(error)

    if (sqlErrorNumber === 2601 || sqlErrorNumber === 2627) {
      return createErrorResponse("TID atau SN sudah digunakan oleh mesin lain.", 409)
    }

    if (sqlErrorNumber === 547) {
      return createErrorResponse(
        "Cabang, Project, atau Tipe Mesin yang dipilih tidak valid.",
        409
      )
    }

    return createInternalErrorResponse(error, "Gagal menambahkan data Mesin.")
  }
}

export async function PUT(request) {
  const authorization = await authorizeMaster(request)

  if (!authorization.authorized) {
    return authorization.response
  }

  const scopeResolution = resolveDataScope(authorization)

  if (scopeResolution.response) {
    return scopeResolution.response
  }

  const scope = scopeResolution.scope

  try {
    let body

    try {
      body = await request.json()
    } catch {
      return createErrorResponse("Format permintaan tidak valid.")
    }

    const id = normalizeId(body?.id)

    if (!id) {
      return createErrorResponse("ID Mesin tidak valid.")
    }

    const validation = validatePayload(body)

    if (validation.error) {
      return createErrorResponse(validation.error)
    }

    const db = await connectDB()
    const schema = await getMasterMesinSchema(db)

    if (!schema.tidEnabled) {
      return createErrorResponse(
        "Kolom TID belum tersedia. Jalankan migration 011-add-master-mesin-tid.sql terlebih dahulu.",
        409
      )
    }

    const existingItem = await getById(db, id, scope.codeUker, schema)

    if (!existingItem) {
      return createErrorResponse("Data Mesin tidak ditemukan.", 404)
    }

    const data = validation.data
    const referenceError = await validateReferences(db, data, scope.codeUker)

    if (referenceError) {
      return createErrorResponse(referenceError)
    }

    if (!(await isTidAvailable(db, data.tid, id))) {
      return createErrorResponse("TID sudah digunakan oleh mesin lain.", 409)
    }

    if (!(await isSnAvailable(db, data.sn, id))) {
      return createErrorResponse("SN sudah digunakan oleh mesin lain.", 409)
    }

    await db
      .request()
      .input("id", sql.BigInt, id)
      .input("scopeCodeUker", sql.NVarChar(20), scope.codeUker)
      .input("tid", sql.VarChar(50), data.tid)
      .input("sn", sql.VarChar(100), data.sn)
      .input("dbValue", sql.NVarChar(100), data.dbValue)
      .input("cabangId", sql.Int, data.cabangId)
      .input("projectId", sql.BigInt, data.projectId)
      .input("lokasi", sql.NVarChar(500), data.lokasi)
      .input("site", sql.VarChar(10), data.site)
      .input("kategoriMesin", sql.NVarChar(100), data.kategoriMesin)
      .input("tipeMesinId", sql.Int, data.tipeMesinId)
      .input("kategoriLokasi", sql.NVarChar(50), data.kategoriLokasi)
      .input("garansi", sql.VarChar(20), data.garansi)
      .input("hariOps", sql.VarChar(20), data.hariOps)
      .input("jamOps", sql.VarChar(20), data.jamOps)
      .input("waktuOps", sql.VarChar(20), data.waktuOps)
      .input("longitude", sql.Decimal(9, 6), data.longitude)
      .input("latitude", sql.Decimal(9, 6), data.latitude)
      .input("isActive", sql.Bit, data.isActive)
      .query(`
        UPDATE dbo.master_mesin
        SET
          tid = @tid,
          sn = @sn,
          db = @dbValue,
          cabang_id = @cabangId,
          project_id = @projectId,
          lokasi = @lokasi,
          site = @site,
          kategori_mesin = @kategoriMesin,
          tipe_mesin_id = @tipeMesinId,
          kategori_lokasi = @kategoriLokasi,
          garansi = @garansi,
          hari_ops = @hariOps,
          jam_ops = @jamOps,
          waktu_ops = @waktuOps,
          longitude = @longitude,
          latitude = @latitude,
          is_active = @isActive,
          updated_at = SYSDATETIME()
        WHERE id = @id
          AND (
            @scopeCodeUker IS NULL
            OR EXISTS (
              SELECT 1
              FROM dbo.master_project scope_project
              INNER JOIN dbo.master_uker scope_uker
                ON scope_uker.id = scope_project.uker_id
              WHERE scope_project.id = dbo.master_mesin.project_id
                AND scope_uker.codeuker = @scopeCodeUker
            )
          );
      `)

    const updatedItem = await getById(db, id, scope.codeUker, schema)

    return NextResponse.json({
      success: true,
      message: "Data Mesin berhasil diperbarui.",
      data: { mesin: updatedItem },
    })
  } catch (error) {
    console.error("PUT master mesin error:", error)
    const sqlErrorNumber = getSqlErrorNumber(error)

    if (sqlErrorNumber === 2601 || sqlErrorNumber === 2627) {
      return createErrorResponse("TID atau SN sudah digunakan oleh mesin lain.", 409)
    }

    if (sqlErrorNumber === 547) {
      return createErrorResponse(
        "Cabang, Project, atau Tipe Mesin yang dipilih tidak valid.",
        409
      )
    }

    return createInternalErrorResponse(error, "Gagal memperbarui data Mesin.")
  }
}

export async function DELETE(request) {
  const authorization = await authorizeMaster(request)

  if (!authorization.authorized) {
    return authorization.response
  }

  const scopeResolution = resolveDataScope(authorization)

  if (scopeResolution.response) {
    return scopeResolution.response
  }

  const scope = scopeResolution.scope

  try {
    let body

    try {
      body = await request.json()
    } catch {
      return createErrorResponse("Format permintaan tidak valid.")
    }

    const id = normalizeId(body?.id)

    if (!id) {
      return createErrorResponse("ID Mesin tidak valid.")
    }

    const db = await connectDB()
    const schema = await getMasterMesinSchema(db)
    const existingItem = await getById(db, id, scope.codeUker, schema)

    if (!existingItem) {
      return createErrorResponse("Data Mesin tidak ditemukan.", 404)
    }

    await db
      .request()
      .input("id", sql.BigInt, id)
      .input("scopeCodeUker", sql.NVarChar(20), scope.codeUker)
      .query(`
        DELETE FROM dbo.master_mesin
        WHERE id = @id
          AND (
            @scopeCodeUker IS NULL
            OR EXISTS (
              SELECT 1
              FROM dbo.master_project scope_project
              INNER JOIN dbo.master_uker scope_uker
                ON scope_uker.id = scope_project.uker_id
              WHERE scope_project.id = dbo.master_mesin.project_id
                AND scope_uker.codeuker = @scopeCodeUker
            )
          );
      `)

    return NextResponse.json({
      success: true,
      message: "Data Mesin berhasil dihapus.",
    })
  } catch (error) {
    console.error("DELETE master mesin error:", error)

    if (getSqlErrorNumber(error) === 547) {
      return createErrorResponse(
        "Mesin sudah digunakan oleh transaksi atau data lain sehingga tidak dapat dihapus. Nonaktifkan data sebagai pengganti.",
        409
      )
    }

    return createInternalErrorResponse(error, "Gagal menghapus data Mesin.")
  }
}
