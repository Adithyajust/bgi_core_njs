import { readJsonBody } from "@/lib/http/json-body"
import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope, hasMenuAccess } from "@/lib/access-control"
import { connectDB, sql } from "@/lib/mssql"
import { writeAuditLog } from "@/lib/security/audit-log"
import { createSearchPatterns, escapeLikePattern } from "@/modules/master-mesin/search"
import { validateMachinePayload } from "@/modules/master-mesin/validation"
import { normalizeRowVersionToken } from "@/modules/master-mesin/row-version"
import {
  LOCATION_CATEGORY_VALUES,
  OPERATION_DAY_VALUES,
  OPERATION_HOUR_VALUES,
  OPERATION_TIME_VALUES,
  SITE_VALUES,
  WARRANTY_VALUES,
} from "@/modules/master-mesin/constants"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_PAGE_SIZE = 10
const MAXIMUM_PAGE_SIZE = 100
const DEFAULT_AUTOCOMPLETE_LIMIT = 20
const MAXIMUM_AUTOCOMPLETE_LIMIT = 50
const AUTOCOMPLETE_SOURCES = new Set(["cabang", "project", "tipe_mesin"])

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

function normalizeId(value) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function normalizeDateSecond(value) {
  if (!value) {
    return null
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return Math.floor(date.getTime() / 1000)
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

function normalizeAutocompleteSource(value) {
  const source = normalizeText(value).toLowerCase().replaceAll("-", "_")
  return AUTOCOMPLETE_SOURCES.has(source) ? source : null
}

function normalizeAutocompleteQuery(value) {
  return normalizeText(value).slice(0, 100)
}


function isDatabaseActive(value) {
  return value === true || value === 1 || value === "1"
}

function mapAutocompleteOption(source, row) {
  if (!row) {
    return null
  }

  if (source === "cabang") {
    return {
      value: String(row.id),
      label: `${row.kode_cabang} · ${row.nama_cabang} · ${row.nama_kanwil}`,
      searchText: `${row.kode_kanwil || ""} ${row.nama_kanwil || ""}`,
      disabled:
        !isDatabaseActive(row.is_active) ||
        !isDatabaseActive(row.kanwil_is_active),
      data: row,
    }
  }

  if (source === "project") {
    return {
      value: String(row.id),
      label: `${row.kode_project} · ${row.nama_project} · ${row.status_project}`,
      searchText: row.status_project || "",
      disabled: !isDatabaseActive(row.is_active),
      data: row,
    }
  }

  return {
    value: String(row.id),
    label: `${row.nama_merk} · ${row.jenis_mesin} · ${row.nama_model}`,
    searchText: row.kode_merk || "",
    disabled:
      !isDatabaseActive(row.is_active) || !isDatabaseActive(row.merk_is_active),
    data: row,
  }
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


async function authorizeMaster(request, action = "view") {
  return authorizeApiRequest(request, "/masters", action)
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
      END AS tid_enabled,
      CASE
        WHEN COL_LENGTH(N'dbo.master_mesin', N'denom') IS NULL THEN CAST(0 AS BIT)
        ELSE CAST(1 AS BIT)
      END AS denom_enabled;
  `)

  return {
    tidEnabled: Boolean(result.recordset[0]?.tid_enabled),
    denomEnabled: Boolean(result.recordset[0]?.denom_enabled),
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

async function getById(db, id, scopeCodeUker = null, schema = { tidEnabled: true, denomEnabled: true }) {
  const tidSelect = schema.tidEnabled
    ? "ms.tid"
    : "CAST(NULL AS VARCHAR(50)) AS tid"
  const denomSelect = schema.denomEnabled
    ? "ms.denom"
    : "CAST(NULL AS NVARCHAR(50)) AS denom"

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
        ${denomSelect},
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
        ms.updated_at,
        CONVERT(VARCHAR(18), CONVERT(VARBINARY(8), ms.row_version), 1) AS row_version,
        CONVERT(VARCHAR(18), CONVERT(VARBINARY(8), ms.row_version), 1) AS row_version_hex
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
  const authorization = await authorizeMaster(request, "view")

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

    if (mode === "options" || mode === "bootstrap") {
      const [machineCategoryResult, canCreate, canUpdate, canDelete] = await Promise.all([
        db.request().query(`
        SELECT DISTINCT TOP (100)
          UPPER(LTRIM(RTRIM(t.jenis_mesin))) AS jenis_mesin
        FROM dbo.master_tipe_mesin t
        INNER JOIN dbo.master_merk m
          ON m.id = t.merk_id
        WHERE t.is_active = 1
          AND m.is_active = 1
          AND NULLIF(LTRIM(RTRIM(t.jenis_mesin)), '') IS NOT NULL
        ORDER BY UPPER(LTRIM(RTRIM(t.jenis_mesin))) ASC;
        `),
        hasMenuAccess(authorization.user.role_id, "/masters", "create"),
        hasMenuAccess(authorization.user.role_id, "/masters", "update"),
        hasMenuAccess(authorization.user.role_id, "/masters", "delete"),
      ])

      return NextResponse.json({
        success: true,
        data: {
          scope: {
            is_super_admin: scope.isSuperAdmin,
            codeuker: scope.codeUker,
            can_view: true,
            can_create: canCreate,
            can_update: canUpdate,
            can_delete: canDelete,
          },
          schema: {
            tid_enabled: schema.tidEnabled,
            denom_enabled: schema.denomEnabled,
          },
          constants: {
            machine_categories: machineCategoryResult.recordset
              .map((item) => normalizeUpperText(item.jenis_mesin))
              .filter(Boolean),
            location_categories: Array.from(LOCATION_CATEGORY_VALUES),
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

    if (mode === "autocomplete") {
      const source = normalizeAutocompleteSource(searchParams.get("source"))

      if (!source) {
        return createErrorResponse(
          "Sumber autocomplete tidak valid. Gunakan cabang, project, atau tipe_mesin.",
          400
        )
      }

      const query = normalizeAutocompleteQuery(searchParams.get("q"))
      const limit = normalizePositiveInteger(
        searchParams.get("limit"),
        DEFAULT_AUTOCOMPLETE_LIMIT,
        MAXIMUM_AUTOCOMPLETE_LIMIT
      )
      const afterId = normalizeId(searchParams.get("after_id")) || 0
      const selectedId = normalizeId(searchParams.get("selected_id"))
      const fetchLimit = limit + 1
      const escapedQuery = escapeLikePattern(query)
      const prefixPattern = `${escapedQuery}%`
      const containsPattern = `%${escapedQuery}%`

      let pageRequest
      let selectedRequest = null

      if (source === "cabang") {
        pageRequest = db
          .request()
          .input("fetchLimit", sql.Int, fetchLimit)
          .input("afterId", sql.BigInt, afterId)
          .input("query", sql.NVarChar(100), query)
          .input("prefixPattern", sql.NVarChar(202), prefixPattern)
          .input("containsPattern", sql.NVarChar(202), containsPattern)
          .query(`
            SELECT TOP (@fetchLimit)
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
            WHERE c.is_active = 1
              AND k.is_active = 1
              AND c.id > @afterId
              AND (
                @query = ''
                OR c.kode_cabang LIKE @prefixPattern ESCAPE '\\'
                OR c.nama_cabang LIKE @containsPattern ESCAPE '\\'
                OR k.kode_kanwil LIKE @prefixPattern ESCAPE '\\'
                OR k.nama_kanwil LIKE @containsPattern ESCAPE '\\'
              )
            ORDER BY c.id ASC;
          `)

        if (selectedId) {
          selectedRequest = db
            .request()
            .input("selectedId", sql.BigInt, selectedId)
            .query(`
              SELECT TOP (1)
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
              WHERE c.id = @selectedId;
            `)
        }
      } else if (source === "project") {
        pageRequest = db
          .request()
          .input("fetchLimit", sql.Int, fetchLimit)
          .input("afterId", sql.BigInt, afterId)
          .input("query", sql.NVarChar(100), query)
          .input("prefixPattern", sql.NVarChar(202), prefixPattern)
          .input("containsPattern", sql.NVarChar(202), containsPattern)
          .input("scopeCodeUker", sql.NVarChar(20), scope.codeUker)
          .query(`
            SELECT TOP (@fetchLimit)
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
            WHERE p.is_active = 1
              AND p.id > @afterId
              AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker)
              AND (
                @query = ''
                OR p.kode_project LIKE @prefixPattern ESCAPE '\\'
                OR p.nama_project LIKE @containsPattern ESCAPE '\\'
                OR p.status_project LIKE @prefixPattern ESCAPE '\\'
              )
            ORDER BY p.id ASC;
          `)

        if (selectedId) {
          selectedRequest = db
            .request()
            .input("selectedId", sql.BigInt, selectedId)
            .input("scopeCodeUker", sql.NVarChar(20), scope.codeUker)
            .query(`
              SELECT TOP (1)
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
              WHERE p.id = @selectedId
                AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker);
            `)
        }
      } else {
        pageRequest = db
          .request()
          .input("fetchLimit", sql.Int, fetchLimit)
          .input("afterId", sql.BigInt, afterId)
          .input("query", sql.NVarChar(100), query)
          .input("prefixPattern", sql.NVarChar(202), prefixPattern)
          .input("containsPattern", sql.NVarChar(202), containsPattern)
          .query(`
            SELECT TOP (@fetchLimit)
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
            WHERE t.is_active = 1
              AND m.is_active = 1
              AND t.id > @afterId
              AND (
                @query = ''
                OR t.jenis_mesin LIKE @containsPattern ESCAPE '\\'
                OR t.nama_model LIKE @containsPattern ESCAPE '\\'
                OR m.kode_merk LIKE @prefixPattern ESCAPE '\\'
                OR m.nama_merk LIKE @containsPattern ESCAPE '\\'
              )
            ORDER BY t.id ASC;
          `)

        if (selectedId) {
          selectedRequest = db
            .request()
            .input("selectedId", sql.BigInt, selectedId)
            .query(`
              SELECT TOP (1)
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
              WHERE t.id = @selectedId;
            `)
        }
      }

      const [pageResult, selectedResult] = await Promise.all([
        pageRequest,
        selectedRequest || Promise.resolve({ recordset: [] }),
      ])
      const hasMore = pageResult.recordset.length > limit
      const pageRecords = pageResult.recordset.slice(0, limit)
      const items = pageRecords.map((row) => mapAutocompleteOption(source, row))
      const selected = mapAutocompleteOption(
        source,
        selectedResult.recordset[0] || null
      )

      return NextResponse.json({
        success: true,
        data: {
          source,
          query,
          items,
          selected,
          pagination: {
            limit,
            has_more: hasMore,
            next_cursor:
              hasMore && pageRecords.length > 0
                ? String(pageRecords[pageRecords.length - 1].id)
                : null,
          },
        },
      })
    }

    if (mode === "summary") {
      const summaryResult = await db
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
          INNER JOIN dbo.master_project p ON p.id = ms.project_id
          INNER JOIN dbo.master_uker mu ON mu.id = p.uker_id
          WHERE @scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker;
        `)
      const row = summaryResult.recordset[0] || {}

      return NextResponse.json({
        success: true,
        data: {
          summary: {
            total: Number(row.total || 0),
            active: Number(row.active || 0),
            onsite: Number(row.onsite || 0),
            offsite: Number(row.offsite || 0),
            in_warranty: Number(row.in_warranty || 0),
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
        data: {
          mesin: item,
          version: {
            row_version: normalizeRowVersionToken(
              item.row_version || item.row_version_hex
            ),
          },
        },
      })
    }

    const pageSize = normalizePositiveInteger(
      searchParams.get("page_size"),
      DEFAULT_PAGE_SIZE,
      MAXIMUM_PAGE_SIZE
    )
    const fetchLimit = pageSize + 1
    const afterId = normalizeId(searchParams.get("after_id"))
    const searchPatterns = createSearchPatterns(searchParams.get("search"))
    const activeFilter = parseActiveFilter(searchParams.get("is_active"))
    const cabangId = normalizeId(searchParams.get("cabang_id"))
    const projectId = normalizeId(searchParams.get("project_id"))
    const tipeMesinId = normalizeId(searchParams.get("tipe_mesin_id"))
    const kategoriMesin = normalizeUpperText(searchParams.get("kategori_mesin"))
    const kategoriLokasi = normalizeUpperText(
      searchParams.get("kategori_lokasi") ?? searchParams.get("kategori")
    )
    const site = normalizeUpperText(searchParams.get("site"))
    const garansi = normalizeUpperText(searchParams.get("garansi"))
    const denom = normalizeUpperText(searchParams.get("denom"))

    const listRequest = db
      .request()
      .input("fetchLimit", sql.Int, fetchLimit)
      .input("afterId", sql.BigInt, afterId)
    const whereParts = ["(@afterId IS NULL OR ms.id < @afterId)"]

    if (scope.codeUker) {
      listRequest.input("scopeCodeUker", sql.NVarChar(20), scope.codeUker)
      whereParts.push("mu.codeuker = @scopeCodeUker")
    }

    if (searchPatterns.normalized) {
      listRequest
        .input("searchExact", sql.NVarChar(100), searchPatterns.exact)
        .input("searchPrefix", sql.NVarChar(202), searchPatterns.prefix)
        .input("searchContains", sql.NVarChar(202), searchPatterns.contains)
      whereParts.push(`(
        ${schema.tidEnabled ? "ms.tid = @searchExact OR ms.tid LIKE @searchPrefix ESCAPE '\\' OR" : ""}
        ms.sn = @searchExact
        OR ms.sn LIKE @searchPrefix ESCAPE '\\'
        OR ms.db LIKE @searchContains ESCAPE '\\'
        ${schema.denomEnabled ? "OR ms.denom LIKE @searchContains ESCAPE '\\'" : ""}
        OR ms.lokasi LIKE @searchContains ESCAPE '\\'
        OR c.kode_cabang LIKE @searchContains ESCAPE '\\'
        OR c.nama_cabang LIKE @searchContains ESCAPE '\\'
        OR k.kode_kanwil LIKE @searchContains ESCAPE '\\'
        OR k.nama_kanwil LIKE @searchContains ESCAPE '\\'
        OR p.kode_project LIKE @searchContains ESCAPE '\\'
        OR p.nama_project LIKE @searchContains ESCAPE '\\'
        OR tm.jenis_mesin LIKE @searchContains ESCAPE '\\'
        OR tm.nama_model LIKE @searchContains ESCAPE '\\'
        OR mk.kode_merk LIKE @searchContains ESCAPE '\\'
        OR mk.nama_merk LIKE @searchContains ESCAPE '\\'
        OR ms.kategori_mesin LIKE @searchContains ESCAPE '\\'
        OR ms.kategori_lokasi LIKE @searchContains ESCAPE '\\'
      )`)
    }

    const addFilter = (name, type, value, clause) => {
      if (value === null || value === undefined || value === "") return
      listRequest.input(name, type, value)
      whereParts.push(clause)
    }

    if (activeFilter !== null) {
      addFilter("isActive", sql.Bit, activeFilter, "ms.is_active = @isActive")
    }
    addFilter("cabangId", sql.Int, cabangId, "ms.cabang_id = @cabangId")
    addFilter("projectId", sql.BigInt, projectId, "ms.project_id = @projectId")
    addFilter("tipeMesinId", sql.Int, tipeMesinId, "ms.tipe_mesin_id = @tipeMesinId")
    if (schema.denomEnabled) {
      addFilter("denom", sql.NVarChar(50), denom, "ms.denom = @denom")
    }
    addFilter(
      "kategoriMesin",
      sql.NVarChar(100),
      kategoriMesin,
      "ms.kategori_mesin = @kategoriMesin"
    )

    if (LOCATION_CATEGORY_VALUES.has(kategoriLokasi)) {
      addFilter(
        "kategoriLokasi",
        sql.NVarChar(50),
        kategoriLokasi,
        "ms.kategori_lokasi = @kategoriLokasi"
      )
    }
    if (SITE_VALUES.has(site)) {
      addFilter("site", sql.VarChar(10), site, "ms.site = @site")
    }
    if (WARRANTY_VALUES.has(garansi)) {
      addFilter("garansi", sql.VarChar(20), garansi, "ms.garansi = @garansi")
    }

    const whereClause = `WHERE ${whereParts.join(" AND ")}`
    const tidSelect = schema.tidEnabled
      ? "ms.tid"
      : "CAST(NULL AS VARCHAR(50)) AS tid"
    const denomSelect = schema.denomEnabled
      ? "ms.denom"
      : "CAST(NULL AS NVARCHAR(50)) AS denom"

    const listResult = await listRequest.query(`
      SELECT TOP (@fetchLimit)
        ms.id,
        ${tidSelect},
        ms.sn,
        ms.db,
        ${denomSelect},
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
        ms.updated_at,
        CONVERT(VARCHAR(18), CONVERT(VARBINARY(8), ms.row_version), 1) AS row_version,
        CONVERT(VARCHAR(18), CONVERT(VARBINARY(8), ms.row_version), 1) AS row_version_hex
      FROM dbo.master_mesin ms
      INNER JOIN dbo.master_cabang c ON c.id = ms.cabang_id
      INNER JOIN dbo.master_kanwil k ON k.id = c.kanwil_id
      INNER JOIN dbo.master_project p ON p.id = ms.project_id
      INNER JOIN dbo.master_uker mu ON mu.id = p.uker_id
      INNER JOIN dbo.master_tipe_mesin tm ON tm.id = ms.tipe_mesin_id
      INNER JOIN dbo.master_merk mk ON mk.id = tm.merk_id
      ${whereClause}
      ORDER BY ms.id DESC;
    `)

    const hasMore = listResult.recordset.length > pageSize
    const mesins = listResult.recordset.slice(0, pageSize)
    const lastItem = mesins.at(-1)

    return NextResponse.json({
      success: true,
      data: {
        mesins,
        pagination: {
          page_size: pageSize,
          has_more: hasMore,
          next_cursor: hasMore && lastItem ? String(lastItem.id) : null,
        },
        schema: {
          tid_enabled: schema.tidEnabled,
          denom_enabled: schema.denomEnabled,
        },
        notice: !schema.tidEnabled
          ? "Kolom TID belum tersedia di database. Jalankan migration 011 sebelum menambah atau mengubah Mesin."
          : !schema.denomEnabled
            ? "Kolom Denom belum tersedia di database. Jalankan migration 030-add-master-mesin-denom.sql."
            : mesins.length === 0 && scope.codeUker
            ? `Tidak ada data Mesin pada halaman ini untuk unit kerja ${scope.codeUker}.`
            : mesins.length === 0
              ? "Tidak ada data Mesin yang sesuai filter."
              : "",
      },
    })
  } catch (error) {
    console.error("GET master mesin error:", error)
    return createInternalErrorResponse(error, "Gagal mengambil data Mesin.")
  }
}

export async function POST(request) {
  const authorization = await authorizeMaster(request, "create")

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
      body = await readJsonBody(request, { maxBytes: 2 * 1024 * 1024 })
    } catch {
      return createErrorResponse("Format permintaan tidak valid.")
    }

    const validation = validateMachinePayload(body)

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

    if (!schema.denomEnabled) {
      return createErrorResponse(
        "Kolom Denom belum tersedia. Jalankan migration 030-add-master-mesin-denom.sql terlebih dahulu.",
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
      .input("denom", sql.NVarChar(50), data.denom)
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
          denom,
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
          @denom,
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

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "CREATE",
      module: "masters.mesin",
      entityType: "master_mesin",
      entityId: createdId,
      metadata: { tid: data.tid, sn: data.sn, denom: data.denom },
    })

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

    if (
      sqlErrorNumber === 547 &&
      /CK_master_mesin_kategori_lokasi/i.test(getServerErrorMessage(error))
    ) {
      return createErrorResponse(
        "Kategori Lokasi belum diizinkan oleh database. Jalankan npm run db:migrate untuk menerapkan migration 020-sync-master-mesin-location-categories.sql.",
        409
      )
    }

    if (
      sqlErrorNumber === 547 &&
      /CK_master_mesin_waktu_ops/i.test(getServerErrorMessage(error))
    ) {
      return createErrorResponse(
        "Waktu Operasional belum diizinkan oleh database. Jalankan npm run db:migrate untuk menerapkan migration 021-sync-master-mesin-operation-times.sql.",
        409
      )
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
  const authorization = await authorizeMaster(request, "update")

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
      body = await readJsonBody(request, { maxBytes: 2 * 1024 * 1024 })
    } catch {
      return createErrorResponse("Format permintaan tidak valid.")
    }

    const id = normalizeId(body?.id)

    if (!id) {
      return createErrorResponse("ID Mesin tidak valid.")
    }

    const requestedRowVersion = normalizeRowVersionToken(body?.row_version)
    const requestedUpdatedAt = normalizeDateSecond(body?.updated_at)

    const validation = validateMachinePayload(body)

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

    if (!schema.denomEnabled) {
      return createErrorResponse(
        "Kolom Denom belum tersedia. Jalankan migration 030-add-master-mesin-denom.sql terlebih dahulu.",
        409
      )
    }

    const existingItem = await getById(db, id, scope.codeUker, schema)

    if (!existingItem) {
      return createErrorResponse("Data Mesin tidak ditemukan.", 404)
    }

    const existingRowVersion = normalizeRowVersionToken(
      existingItem.row_version || existingItem.row_version_hex
    )
    let rowVersion = requestedRowVersion

    if (!rowVersion) {
      const existingUpdatedAt = normalizeDateSecond(existingItem.updated_at)

      if (
        requestedUpdatedAt === null ||
        existingUpdatedAt === null ||
        requestedUpdatedAt !== existingUpdatedAt
      ) {
        return createErrorResponse(
          "Data Mesin telah berubah atau versi data tidak tersedia. Tutup form, buka kembali data, lalu simpan ulang.",
          409
        )
      }

      rowVersion = existingRowVersion
    }

    if (!rowVersion) {
      return createErrorResponse(
        "Token versi data Mesin tidak tersedia pada server. Periksa kolom row_version pada dbo.master_mesin.",
        500
      )
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

    const updateResult = await db
      .request()
      .input("id", sql.BigInt, id)
      .input("rowVersion", sql.VarBinary(8), Buffer.from(rowVersion.slice(2), "hex"))
      .input("scopeCodeUker", sql.NVarChar(20), scope.codeUker)
      .input("tid", sql.VarChar(50), data.tid)
      .input("sn", sql.VarChar(100), data.sn)
      .input("dbValue", sql.NVarChar(100), data.dbValue)
      .input("denom", sql.NVarChar(50), data.denom)
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
          denom = @denom,
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
          AND row_version = @rowVersion
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

    if (Number(updateResult.rowsAffected?.[0] || 0) === 0) {
      return createErrorResponse(
        "Data telah berubah oleh pengguna lain. Muat ulang data sebelum menyimpan.",
        409
      )
    }

    const updatedItem = await getById(db, id, scope.codeUker, schema)

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "UPDATE",
      module: "masters.mesin",
      entityType: "master_mesin",
      entityId: id,
      metadata: { tid: data.tid, sn: data.sn, denom: data.denom },
    })

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

    if (
      sqlErrorNumber === 547 &&
      /CK_master_mesin_kategori_lokasi/i.test(getServerErrorMessage(error))
    ) {
      return createErrorResponse(
        "Kategori Lokasi belum diizinkan oleh database. Jalankan npm run db:migrate untuk menerapkan migration 020-sync-master-mesin-location-categories.sql.",
        409
      )
    }

    if (
      sqlErrorNumber === 547 &&
      /CK_master_mesin_waktu_ops/i.test(getServerErrorMessage(error))
    ) {
      return createErrorResponse(
        "Waktu Operasional belum diizinkan oleh database. Jalankan npm run db:migrate untuk menerapkan migration 021-sync-master-mesin-operation-times.sql.",
        409
      )
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
  const authorization = await authorizeMaster(request, "delete")

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
      body = await readJsonBody(request, { maxBytes: 2 * 1024 * 1024 })
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

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "DELETE",
      module: "masters.mesin",
      entityType: "master_mesin",
      entityId: id,
      metadata: { tid: existingItem.tid, sn: existingItem.sn },
    })

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
