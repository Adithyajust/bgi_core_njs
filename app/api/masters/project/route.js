import { NextResponse } from "next/server"

import {
  authorizeApiRequest,
  getUserDataScope,
} from "@/lib/access-control"
import { connectDB, sql } from "@/lib/mssql"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PROJECT_STATUSES = new Set([
  "PERENCANAAN",
  "BERJALAN",
  "DITUNDA",
  "SELESAI",
  "DIBATALKAN",
])

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

function normalizeNullableText(value) {
  const normalized = normalizeText(value)
  return normalized || null
}

function normalizeProjectCode(value) {
  return normalizeText(value).toUpperCase()
}

function normalizeId(value) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function normalizePositiveInteger(value, defaultValue, maximum = null) {
  if (value === undefined || value === null || value === "") {
    return defaultValue
  }

  const result = Number(value)

  if (!Number.isSafeInteger(result) || result <= 0) {
    return defaultValue
  }

  if (maximum !== null) {
    return Math.min(result, maximum)
  }

  return result
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

function parseOptionalBooleanFilter(value) {
  const normalized = normalizeText(value).toLowerCase()

  if (!normalized || normalized === "all") {
    return null
  }

  if (["1", "true", "active", "aktif"].includes(normalized)) {
    return true
  }

  if (["0", "false", "inactive", "nonaktif"].includes(normalized)) {
    return false
  }

  return null
}

function parseOptionalDate(value, label) {
  const normalized = normalizeText(value)

  if (!normalized) {
    return { value: null, error: null }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return {
      value: null,
      error: `${label} harus menggunakan format YYYY-MM-DD.`,
    }
  }

  const [year, month, day] = normalized.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { value: null, error: `${label} tidak valid.` }
  }

  return { value: date, error: null }
}

function parseOptionalProjectValue(value) {
  if (value === undefined || value === null || value === "") {
    return { value: null, error: null }
  }

  const normalized = String(value).trim().replace(",", ".")

  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(normalized)) {
    return {
      value: null,
      error:
        "Nilai project harus berupa angka positif dengan maksimal dua angka desimal.",
    }
  }

  const parsedValue = Number(normalized)

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return {
      value: null,
      error: "Nilai project tidak boleh negatif.",
    }
  }

  return { value: parsedValue, error: null }
}

function parseProgress(value) {
  if (value === undefined || value === null || value === "") {
    return { value: 0, error: null }
  }

  const progress = Number(value)

  if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
    return {
      value: null,
      error: "Progress harus berupa bilangan bulat antara 0 sampai 100.",
    }
  }

  return { value: progress, error: null }
}

function validateMaximumLength(label, value, maximumLength) {
  if (value && value.length > maximumLength) {
    return `${label} maksimal ${maximumLength} karakter.`
  }

  return null
}

function validateProjectPayload(body) {
  const kodeProject = normalizeProjectCode(body.kode_project)
  const namaProject = normalizeText(body.nama_project)
  const customer = normalizeNullableText(body.customer)
  const lokasi = normalizeNullableText(body.lokasi)
  const projectManager = normalizeNullableText(body.project_manager)
  const statusProject = normalizeText(
    body.status_project || "PERENCANAAN"
  ).toUpperCase()
  const keterangan = normalizeNullableText(body.keterangan)
  const isActive = normalizeBoolean(body.is_active, true)
  const ukerId = normalizeId(body.uker_id)
  const tanggalMulai = parseOptionalDate(body.tanggal_mulai, "Tanggal mulai")
  const tanggalSelesai = parseOptionalDate(
    body.tanggal_selesai,
    "Tanggal selesai"
  )
  const nilaiProject = parseOptionalProjectValue(body.nilai_project)
  const progress = parseProgress(body.progress)

  if (!kodeProject) {
    return { error: "Kode project wajib diisi.", data: null }
  }

  if (!namaProject) {
    return { error: "Nama project wajib diisi.", data: null }
  }

  if (!ukerId) {
    return { error: "Unit kerja wajib dipilih.", data: null }
  }

  const validationErrors = [
    validateMaximumLength("Kode project", kodeProject, 30),
    validateMaximumLength("Nama project", namaProject, 150),
    validateMaximumLength("Customer", customer, 150),
    validateMaximumLength("Lokasi", lokasi, 255),
    validateMaximumLength("Project Manager", projectManager, 150),
    validateMaximumLength("Keterangan", keterangan, 500),
    !PROJECT_STATUSES.has(statusProject)
      ? "Status project tidak valid."
      : null,
    tanggalMulai.error,
    tanggalSelesai.error,
    nilaiProject.error,
    progress.error,
  ].filter(Boolean)

  if (validationErrors.length > 0) {
    return { error: validationErrors[0], data: null }
  }

  if (
    tanggalMulai.value &&
    tanggalSelesai.value &&
    tanggalSelesai.value < tanggalMulai.value
  ) {
    return {
      error: "Tanggal selesai tidak boleh lebih awal dari tanggal mulai.",
      data: null,
    }
  }

  return {
    error: null,
    data: {
      kodeProject,
      namaProject,
      customer,
      lokasi,
      ukerId,
      projectManager,
      tanggalMulai: tanggalMulai.value,
      tanggalSelesai: tanggalSelesai.value,
      nilaiProject: nilaiProject.value,
      statusProject,
      progress: progress.value,
      keterangan,
      isActive,
    },
  }
}

async function authorizeMaster(request) {
  return authorizeApiRequest(request, "/masters")
}

function requireSuperAdmin(authorization) {
  if (authorization.user.role_code === "SUPER_ADMIN") {
    return null
  }

  return createErrorResponse(
    "Hanya Super Admin yang dapat mengubah master project.",
    403
  )
}

async function getUkerById(db, ukerId) {
  const result = await db
    .request()
    .input("ukerId", sql.BigInt, ukerId)
    .query(`
      SELECT TOP 1
        id,
        codeuker,
        nama_uker
      FROM dbo.master_uker
      WHERE id = @ukerId;
    `)

  return result.recordset[0] || null
}

async function getProjectSummary(db, scopeCodeUker = null) {
  const result = await db
    .request()
    .input("scopeCodeUker", sql.NVarChar(4), scopeCodeUker)
    .query(`
      SELECT
        COUNT_BIG(1) AS total,
        SUM(CASE WHEN p.is_active = 1 THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN p.status_project = 'BERJALAN' THEN 1 ELSE 0 END) AS ongoing,
        SUM(CASE WHEN p.status_project = 'SELESAI' THEN 1 ELSE 0 END) AS completed
      FROM dbo.master_project p
      INNER JOIN dbo.master_uker mu
        ON mu.id = p.uker_id
      WHERE (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker);
    `)

  const summary = result.recordset[0] || {}

  return {
    total: Number(summary.total || 0),
    active: Number(summary.active || 0),
    ongoing: Number(summary.ongoing || 0),
    completed: Number(summary.completed || 0),
  }
}

async function getProjectById(db, id, scopeCodeUker = null) {
  const result = await db
    .request()
    .input("id", sql.BigInt, id)
    .input("scopeCodeUker", sql.NVarChar(4), scopeCodeUker)
    .query(`
      SELECT TOP 1
        p.id,
        p.kode_project,
        p.nama_project,
        p.customer,
        p.lokasi,
        p.uker_id,
        mu.codeuker,
        mu.nama_uker,
        p.project_manager,
        CONVERT(CHAR(10), p.tanggal_mulai, 23) AS tanggal_mulai,
        CONVERT(CHAR(10), p.tanggal_selesai, 23) AS tanggal_selesai,
        p.nilai_project,
        p.status_project,
        p.progress,
        p.keterangan,
        p.is_active,
        p.created_at,
        p.updated_at
      FROM dbo.master_project p
      INNER JOIN dbo.master_uker mu
        ON mu.id = p.uker_id
      WHERE p.id = @id
        AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker);
    `)

  return result.recordset[0] || null
}

async function isProjectCodeAvailable(db, kodeProject, ignoredId = null) {
  const dbRequest = db
    .request()
    .input("kodeProject", sql.VarChar(30), kodeProject)

  let query = `
    SELECT TOP 1 id
    FROM dbo.master_project
    WHERE UPPER(kode_project) = @kodeProject
  `

  if (ignoredId !== null) {
    dbRequest.input("ignoredId", sql.BigInt, ignoredId)
    query += " AND id <> @ignoredId"
  }

  const result = await dbRequest.query(`${query};`)
  return result.recordset.length === 0
}

function addProjectPayloadInputs(dbRequest, data) {
  return dbRequest
    .input("kodeProject", sql.VarChar(30), data.kodeProject)
    .input("namaProject", sql.NVarChar(150), data.namaProject)
    .input("customer", sql.NVarChar(150), data.customer)
    .input("lokasi", sql.NVarChar(255), data.lokasi)
    .input("ukerId", sql.BigInt, data.ukerId)
    .input("projectManager", sql.NVarChar(150), data.projectManager)
    .input("tanggalMulai", sql.Date, data.tanggalMulai)
    .input("tanggalSelesai", sql.Date, data.tanggalSelesai)
    .input("nilaiProject", sql.Decimal(18, 2), data.nilaiProject)
    .input("statusProject", sql.VarChar(20), data.statusProject)
    .input("progress", sql.TinyInt, data.progress)
    .input("keterangan", sql.NVarChar(500), data.keterangan)
    .input("isActive", sql.Bit, data.isActive)
}

export async function GET(request) {
  const authorization = await authorizeMaster(request)

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
    const projectId = normalizeId(searchParams.get("id"))
    const db = await connectDB()

    if (searchParams.has("id")) {
      if (!projectId) {
        return createErrorResponse("ID project tidak valid.")
      }

      const project = await getProjectById(db, projectId, scope.codeUker)

      if (!project) {
        return createErrorResponse("Data project tidak ditemukan.", 404)
      }

      return NextResponse.json({
        success: true,
        data: project,
      })
    }

    const page = normalizePositiveInteger(searchParams.get("page"), 1)
    const pageSize = normalizePositiveInteger(
      searchParams.get("page_size"),
      DEFAULT_PAGE_SIZE,
      MAXIMUM_PAGE_SIZE
    )
    const search = normalizeText(searchParams.get("search")).slice(0, 150)
    const statusProject = normalizeText(
      searchParams.get("status_project")
    ).toUpperCase()
    const requestedUkerId = normalizeId(searchParams.get("uker_id"))
    const isActive = parseOptionalBooleanFilter(searchParams.get("is_active"))

    if (statusProject && !PROJECT_STATUSES.has(statusProject)) {
      return createErrorResponse("Filter status project tidak valid.")
    }

    if (searchParams.has("uker_id") && !requestedUkerId) {
      return createErrorResponse("Filter unit kerja tidak valid.")
    }

    const whereClauses = []
    const countRequest = db.request()
    const listRequest = db.request()

    function addInput(name, type, value) {
      countRequest.input(name, type, value)
      listRequest.input(name, type, value)
    }

    if (scope.codeUker) {
      addInput("scopeCodeUker", sql.NVarChar(4), scope.codeUker)
      whereClauses.push("mu.codeuker = @scopeCodeUker")
    }

    if (requestedUkerId) {
      addInput("filterUkerId", sql.BigInt, requestedUkerId)
      whereClauses.push("p.uker_id = @filterUkerId")
    }

    if (search) {
      addInput("search", sql.NVarChar(200), `%${search}%`)
      whereClauses.push(`(
        p.kode_project LIKE @search
        OR p.nama_project LIKE @search
        OR p.customer LIKE @search
        OR p.lokasi LIKE @search
        OR p.project_manager LIKE @search
        OR mu.nama_uker LIKE @search
        OR mu.codeuker LIKE @search
      )`)
    }

    if (statusProject) {
      addInput("statusProject", sql.VarChar(20), statusProject)
      whereClauses.push("p.status_project = @statusProject")
    }

    if (isActive !== null) {
      addInput("isActive", sql.Bit, isActive)
      whereClauses.push("p.is_active = @isActive")
    }

    const whereClause =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : ""

    const summary = await getProjectSummary(db, scope.codeUker)

    const countResult = await countRequest.query(`
      SELECT COUNT_BIG(1) AS total
      FROM dbo.master_project p
      INNER JOIN dbo.master_uker mu
        ON mu.id = p.uker_id
      ${whereClause};
    `)

    const totalItems = Number(countResult.recordset[0]?.total || 0)
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
    const currentPage = Math.min(page, totalPages)
    const offset = (currentPage - 1) * pageSize

    listRequest.input("offset", sql.Int, offset)
    listRequest.input("pageSize", sql.Int, pageSize)

    const listResult = await listRequest.query(`
      SELECT
        p.id,
        p.kode_project,
        p.nama_project,
        p.customer,
        p.lokasi,
        p.uker_id,
        mu.codeuker,
        mu.nama_uker,
        p.project_manager,
        CONVERT(CHAR(10), p.tanggal_mulai, 23) AS tanggal_mulai,
        CONVERT(CHAR(10), p.tanggal_selesai, 23) AS tanggal_selesai,
        p.nilai_project,
        p.status_project,
        p.progress,
        p.keterangan,
        p.is_active,
        p.created_at,
        p.updated_at
      FROM dbo.master_project p
      INNER JOIN dbo.master_uker mu
        ON mu.id = p.uker_id
      ${whereClause}
      ORDER BY
        p.created_at DESC,
        p.id DESC
      OFFSET @offset ROWS
      FETCH NEXT @pageSize ROWS ONLY;
    `)

    return NextResponse.json({
      success: true,
      data: {
        projects: listResult.recordset,
        summary,
        pagination: {
          page: currentPage,
          page_size: pageSize,
          total_items: totalItems,
          total_pages: totalPages,
        },
        filters: {
          search,
          status_project: statusProject || null,
          uker_id: requestedUkerId,
          is_active: isActive,
        },
        scope: {
          isSuperAdmin: scope.isSuperAdmin,
          codeUker: scope.codeUker,
        },
      },
    })
  } catch (error) {
    console.error("GET master project error:", error)
    return createInternalErrorResponse(error, "Gagal mengambil data project.")
  }
}

export async function POST(request) {
  const authorization = await authorizeMaster(request)

  if (!authorization.authorized) {
    return authorization.response
  }

  const forbiddenResponse = requireSuperAdmin(authorization)
  if (forbiddenResponse) return forbiddenResponse

  try {
    const body = await request.json()
    const validation = validateProjectPayload(body)

    if (validation.error) {
      return createErrorResponse(validation.error)
    }

    const db = await connectDB()
    const uker = await getUkerById(db, validation.data.ukerId)

    if (!uker) {
      return createErrorResponse("Unit kerja tidak ditemukan.", 404)
    }

    if (!(await isProjectCodeAvailable(db, validation.data.kodeProject))) {
      return createErrorResponse(
        `Kode project ${validation.data.kodeProject} sudah digunakan.`,
        409
      )
    }

    const result = await addProjectPayloadInputs(
      db.request(),
      validation.data
    ).query(`
      INSERT INTO dbo.master_project
      (
        kode_project,
        nama_project,
        customer,
        lokasi,
        uker_id,
        project_manager,
        tanggal_mulai,
        tanggal_selesai,
        nilai_project,
        status_project,
        progress,
        keterangan,
        is_active,
        created_at,
        updated_at
      )
      OUTPUT inserted.id
      VALUES
      (
        @kodeProject,
        @namaProject,
        @customer,
        @lokasi,
        @ukerId,
        @projectManager,
        @tanggalMulai,
        @tanggalSelesai,
        @nilaiProject,
        @statusProject,
        @progress,
        @keterangan,
        @isActive,
        SYSDATETIME(),
        SYSDATETIME()
      );
    `)

    const createdId = result.recordset[0]?.id
    const createdProject = await getProjectById(db, createdId)

    return NextResponse.json(
      {
        success: true,
        message: "Data project berhasil ditambahkan.",
        data: createdProject,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("POST master project error:", error)

    if (error instanceof SyntaxError) {
      return createErrorResponse("Format data tidak valid.")
    }

    const errorNumber = getSqlErrorNumber(error)

    if (errorNumber === 2601 || errorNumber === 2627) {
      return createErrorResponse("Kode project sudah digunakan.", 409)
    }

    if (errorNumber === 547) {
      return createErrorResponse(
        "Unit kerja atau nilai data project tidak valid.",
        409
      )
    }

    return createInternalErrorResponse(error, "Gagal menambahkan data project.")
  }
}

export async function PUT(request) {
  const authorization = await authorizeMaster(request)

  if (!authorization.authorized) {
    return authorization.response
  }

  const forbiddenResponse = requireSuperAdmin(authorization)
  if (forbiddenResponse) return forbiddenResponse

  try {
    const body = await request.json()
    const id = normalizeId(body.id)

    if (!id) {
      return createErrorResponse("ID project tidak valid.")
    }

    const validation = validateProjectPayload(body)

    if (validation.error) {
      return createErrorResponse(validation.error)
    }

    const db = await connectDB()
    const existingProject = await getProjectById(db, id)

    if (!existingProject) {
      return createErrorResponse("Data project tidak ditemukan.", 404)
    }

    const uker = await getUkerById(db, validation.data.ukerId)

    if (!uker) {
      return createErrorResponse("Unit kerja tidak ditemukan.", 404)
    }

    if (
      !(await isProjectCodeAvailable(
        db,
        validation.data.kodeProject,
        id
      ))
    ) {
      return createErrorResponse(
        `Kode project ${validation.data.kodeProject} sudah digunakan.`,
        409
      )
    }

    await addProjectPayloadInputs(db.request(), validation.data)
      .input("id", sql.BigInt, id)
      .query(`
        UPDATE dbo.master_project
        SET
          kode_project = @kodeProject,
          nama_project = @namaProject,
          customer = @customer,
          lokasi = @lokasi,
          uker_id = @ukerId,
          project_manager = @projectManager,
          tanggal_mulai = @tanggalMulai,
          tanggal_selesai = @tanggalSelesai,
          nilai_project = @nilaiProject,
          status_project = @statusProject,
          progress = @progress,
          keterangan = @keterangan,
          is_active = @isActive,
          updated_at = SYSDATETIME()
        WHERE id = @id;
      `)

    const updatedProject = await getProjectById(db, id)

    return NextResponse.json({
      success: true,
      message: "Data project berhasil diperbarui.",
      data: updatedProject,
    })
  } catch (error) {
    console.error("PUT master project error:", error)

    if (error instanceof SyntaxError) {
      return createErrorResponse("Format data tidak valid.")
    }

    const errorNumber = getSqlErrorNumber(error)

    if (errorNumber === 2601 || errorNumber === 2627) {
      return createErrorResponse("Kode project sudah digunakan.", 409)
    }

    if (errorNumber === 547) {
      return createErrorResponse(
        "Unit kerja atau nilai data project tidak valid.",
        409
      )
    }

    return createInternalErrorResponse(error, "Gagal memperbarui data project.")
  }
}

export async function DELETE(request) {
  const authorization = await authorizeMaster(request)

  if (!authorization.authorized) {
    return authorization.response
  }

  const forbiddenResponse = requireSuperAdmin(authorization)
  if (forbiddenResponse) return forbiddenResponse

  try {
    const body = await request.json()
    const id = normalizeId(body.id)

    if (!id) {
      return createErrorResponse("ID project tidak valid.")
    }

    const db = await connectDB()
    const existingProject = await getProjectById(db, id)

    if (!existingProject) {
      return createErrorResponse("Data project tidak ditemukan.", 404)
    }

    await db
      .request()
      .input("id", sql.BigInt, id)
      .query(`DELETE FROM dbo.master_project WHERE id = @id;`)

    return NextResponse.json({
      success: true,
      message: `Project ${existingProject.kode_project} berhasil dihapus.`,
    })
  } catch (error) {
    console.error("DELETE master project error:", error)

    if (error instanceof SyntaxError) {
      return createErrorResponse("Format data tidak valid.")
    }

    if (getSqlErrorNumber(error) === 547) {
      return createErrorResponse(
        "Data project masih digunakan oleh data lain dan tidak dapat dihapus.",
        409
      )
    }

    return createInternalErrorResponse(error, "Gagal menghapus data project.")
  }
}
