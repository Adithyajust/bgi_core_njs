import bcrypt from "bcryptjs"
import { NextResponse } from "next/server"

import { authorizeApiRequest } from "@/lib/access-control"
import { connectDB, sql } from "@/lib/mssql"
import { normalizePositiveInteger } from "@/lib/database/pagination"
import { normalizeRowVersionToken } from "@/modules/master-mesin/row-version"
import { writeAuditLog } from "@/lib/security/audit-log"
import { validatePasswordPolicy } from "@/lib/security/password-policy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ROLE_CODE_SUPER_ADMIN = "SUPER_ADMIN"

function createErrorResponse(message, status = 400) {
  return NextResponse.json(
    {
      success: false,
      message,
    },
    {
      status,
    }
  )
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeCodeUker(value) {
  return normalizeText(value).toUpperCase()
}

function normalizeBoolean(value, defaultValue = true) {
  if (value === undefined || value === null) {
    return defaultValue
  }

  return (
    value === true ||
    value === 1 ||
    value === "1" ||
    value === "true"
  )
}

function normalizeOptionalId(value) {
  if (value === undefined || value === null || value === "") {
    return null
  }

  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : Number.NaN
}

function validateUsername(username) {
  if (!username) {
    return "Username wajib diisi."
  }

  if (username.length < 4 || username.length > 50) {
    return "Username harus terdiri dari 4 sampai 50 karakter."
  }

  if (!/^[a-z0-9._-]+$/.test(username)) {
    return "Username hanya boleh berisi huruf kecil, angka, titik, garis bawah, dan tanda minus."
  }

  return null
}

function validateFullName(fullName) {
  if (!fullName) {
    return "Nama pegawai wajib tersedia."
  }

  if (fullName.length < 3 || fullName.length > 100) {
    return "Nama lengkap harus terdiri dari 3 sampai 100 karakter."
  }

  return null
}

function validateEmail(email) {
  if (!email) {
    return null
  }

  if (email.length > 150) {
    return "Email maksimal 150 karakter."
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Format email pegawai tidak valid."
  }

  return null
}

async function authorizeSettings(request, action = "view") {
  const authorization = await authorizeApiRequest(request, "/settings", action)

  if (!authorization.authorized) {
    return authorization
  }

  if (authorization.user.role_code !== ROLE_CODE_SUPER_ADMIN) {
    return {
      authorized: false,
      user: authorization.user,
      response: createErrorResponse(
        "Hanya Super Admin yang dapat mengelola user dan role.",
        403
      ),
    }
  }

  return authorization
}

async function findActiveRole(db, roleId) {
  const result = await db
    .request()
    .input("roleId", sql.Int, roleId)
    .query(`
      SELECT TOP 1
        id,
        role_code,
        role_name
      FROM dbo.roles
      WHERE id = @roleId
        AND is_active = 1;
    `)

  return result.recordset[0] || null
}

async function findPegawaiById(db, pegawaiId) {
  if (!pegawaiId) {
    return null
  }

  const result = await db
    .request()
    .input("pegawaiId", sql.Int, pegawaiId)
    .query(`
      SELECT TOP 1
        p.id,
        p.nip,
        p.nama,
        p.email,
        p.jabatan,
        p.status,
        p.status_peg,
        p.uker_id,
        mu.codeuker,
        mu.nama_uker
      FROM dbo.pegawai p
      LEFT JOIN dbo.master_uker mu
        ON mu.id = p.uker_id
      WHERE p.id = @pegawaiId;
    `)

  return result.recordset[0] || null
}

async function ensurePegawaiIsAvailable(db, pegawaiId, ignoredUserId = null) {
  if (!pegawaiId) {
    return null
  }

  const request = db
    .request()
    .input("pegawaiId", sql.Int, pegawaiId)

  let query = `
    SELECT TOP 1
      id,
      username
    FROM dbo.users
    WHERE pegawai_id = @pegawaiId
  `

  if (ignoredUserId) {
    request.input("ignoredUserId", sql.Int, ignoredUserId)
    query += " AND id <> @ignoredUserId"
  }

  const result = await request.query(`${query};`)
  return result.recordset[0] || null
}

async function getUserById(db, userId) {
  const result = await db
    .request()
    .input("userId", sql.Int, userId)
    .query(`
      SELECT TOP 1
        u.id,
        u.username,
        COALESCE(NULLIF(p.nama, ''), u.full_name) AS full_name,
        COALESCE(NULLIF(p.email, ''), u.email) AS email,
        u.pegawai_id,
        p.nip AS pegawai_nip,
        p.nama AS pegawai_nama,
        p.email AS pegawai_email,
        p.jabatan AS pegawai_jabatan,
        p.status AS pegawai_status,
        p.status_peg AS pegawai_status_kepegawaian,
        p.uker_id AS pegawai_uker_id,
        pegawai_uker.codeuker AS pegawai_codeuker,
        pegawai_uker.nama_uker AS pegawai_uker_name,
        u.role_id,
        u.codeuker AS stored_codeuker,
        CASE
          WHEN r.role_code = '${ROLE_CODE_SUPER_ADMIN}' THEN NULL
          ELSE COALESCE(pegawai_uker.codeuker, u.codeuker)
        END AS codeuker,
        CASE
          WHEN r.role_code = '${ROLE_CODE_SUPER_ADMIN}' THEN NULL
          ELSE COALESCE(pegawai_uker.nama_uker, mu.nama_uker)
        END AS uker_name,
        u.is_active,
        r.role_code,
        r.role_name,
        CONVERT(VARCHAR(18), CONVERT(VARBINARY(8), u.row_version), 1) AS row_version
      FROM dbo.users u
      INNER JOIN dbo.roles r
        ON r.id = u.role_id
      LEFT JOIN dbo.master_uker mu
        ON mu.codeuker = u.codeuker
      LEFT JOIN dbo.pegawai p
        ON p.id = u.pegawai_id
      LEFT JOIN dbo.master_uker pegawai_uker
        ON pegawai_uker.id = p.uker_id
      WHERE u.id = @userId;
    `)

  const item = result.recordset[0] || null
  return item ? { ...item, row_version: normalizeRowVersionToken(item.row_version) } : null
}

async function ensureEmailIsUnique(db, email, ignoredUserId = null) {
  if (!email) {
    return true
  }

  const request = db
    .request()
    .input("email", sql.VarChar(150), email)

  let query = `
    SELECT TOP 1 id
    FROM dbo.users
    WHERE email = @email
  `

  if (ignoredUserId) {
    request.input("ignoredUserId", sql.Int, ignoredUserId)
    query += " AND id <> @ignoredUserId"
  }

  const result = await request.query(`${query};`)
  return result.recordset.length === 0
}

async function ensureUsernameIsUnique(db, username) {
  const result = await db
    .request()
    .input("username", sql.VarChar(50), username)
    .query(`
      SELECT TOP 1 id
      FROM dbo.users
      WHERE username = @username;
    `)

  return result.recordset.length === 0
}

async function countOtherActiveSuperAdmins(db, ignoredUserId) {
  const result = await db
    .request()
    .input("ignoredUserId", sql.Int, ignoredUserId)
    .query(`
      SELECT COUNT_BIG(*) AS total
      FROM dbo.users u
      INNER JOIN dbo.roles r
        ON r.id = u.role_id
      WHERE r.role_code = '${ROLE_CODE_SUPER_ADMIN}'
        AND u.is_active = 1
        AND u.id <> @ignoredUserId;
    `)

  return Number(result.recordset[0]?.total || 0)
}

async function loadReferenceData(db) {
  const [rolesResult, menusResult, permissionsResult] = await Promise.all([
    db.request().query(`
      SELECT id, role_code, role_name, description, is_active
      FROM dbo.roles
      WHERE is_active = 1
      ORDER BY id ASC;
    `),
    db.request().query(`
      SELECT id, label, href, icon, badge, sort_order, is_active
      FROM dbo.sidebar_routes
      WHERE is_active = 1
      ORDER BY sort_order ASC, id ASC;
    `),
    db.request().query(`
      SELECT role_id, sidebar_route_id, can_view, can_create, can_update, can_delete
      FROM dbo.role_sidebar_routes;
    `),
  ])

  return {
    roles: rolesResult.recordset,
    menus: menusResult.recordset,
    permissions: permissionsResult.recordset,
  }
}

export async function GET(request) {
  const authorization = await authorizeSettings(request, "view")

  if (!authorization.authorized) {
    return authorization.response
  }

  try {
    const db = await connectDB()
    const { searchParams } = new URL(request.url)
    const mode = normalizeText(searchParams.get("mode")).toLowerCase()

    if (mode === "pegawai-options") {
      const search = normalizeText(searchParams.get("search"))
      const selectedUserId = Number(searchParams.get("selected_user_id"))
      const limit = normalizePositiveInteger(searchParams.get("limit"), 100, 200)

      const result = await db
        .request()
        .input("search", sql.NVarChar(255), search ? `%${search}%` : null)
        .input(
          "selectedUserId",
          sql.Int,
          Number.isSafeInteger(selectedUserId) && selectedUserId > 0
            ? selectedUserId
            : null
        )
        .input("limit", sql.Int, limit)
        .query(`
          SELECT TOP (@limit)
            p.id,
            p.nip,
            p.nama,
            p.email,
            p.jabatan,
            p.status,
            p.status_peg,
            p.uker_id,
            mu.codeuker,
            mu.nama_uker,
            linked_user.user_id,
            linked_user.username
          FROM dbo.pegawai p
          LEFT JOIN dbo.master_uker mu ON mu.id = p.uker_id
          OUTER APPLY (
            SELECT TOP 1 u.id AS user_id, u.username
            FROM dbo.users u
            WHERE u.pegawai_id = p.id
            ORDER BY u.id ASC
          ) linked_user
          WHERE
            (
              (p.status = 1 AND linked_user.user_id IS NULL)
              OR linked_user.user_id = @selectedUserId
            )
            AND UPPER(REPLACE(ISNULL(p.jabatan, ''), ' ', '')) <> 'SUPERADMIN'
            AND (
              @search IS NULL
              OR p.nip LIKE @search
              OR p.nama LIKE @search
              OR p.email LIKE @search
              OR p.jabatan LIKE @search
              OR mu.codeuker LIKE @search
              OR mu.nama_uker LIKE @search
            )
          ORDER BY
            CASE WHEN linked_user.user_id = @selectedUserId THEN 0 ELSE 1 END,
            p.nama ASC,
            p.nip ASC,
            p.id ASC;
        `)

      return NextResponse.json({
        success: true,
        data: { pegawai: result.recordset },
      })
    }

    const page = normalizePositiveInteger(searchParams.get("page"), 1, 1000000)
    const pageSize = normalizePositiveInteger(searchParams.get("page_size"), 20, 100)
    const offset = (page - 1) * pageSize
    const search = normalizeText(searchParams.get("search"))
    const roleCode = normalizeText(searchParams.get("role")).toUpperCase()
    const status = normalizeText(searchParams.get("status")).toUpperCase()

    const addInputs = (dbRequest) =>
      dbRequest
        .input("search", sql.NVarChar(255), search ? `%${search}%` : null)
        .input("roleCode", sql.VarChar(50), roleCode && roleCode !== "ALL" ? roleCode : null)
        .input("status", sql.VarChar(20), status && status !== "ALL" ? status : null)

    const joins = `
      FROM dbo.users u
      INNER JOIN dbo.roles r ON r.id = u.role_id
      LEFT JOIN dbo.master_uker mu ON mu.codeuker = u.codeuker
      LEFT JOIN dbo.pegawai p ON p.id = u.pegawai_id
      LEFT JOIN dbo.master_uker pegawai_uker ON pegawai_uker.id = p.uker_id
    `

    const whereClause = `
      WHERE (@roleCode IS NULL OR r.role_code = @roleCode)
        AND (
          @status IS NULL
          OR (@status = 'ACTIVE' AND u.is_active = 1)
          OR (@status = 'INACTIVE' AND u.is_active = 0)
          OR (
            @status = 'LOCKED'
            AND u.locked_until IS NOT NULL
            AND u.locked_until > SYSDATETIME()
          )
        )
        AND (
          @search IS NULL
          OR u.username LIKE @search
          OR u.full_name LIKE @search
          OR u.email LIKE @search
          OR p.nip LIKE @search
          OR p.nama LIKE @search
          OR p.jabatan LIKE @search
          OR r.role_name LIKE @search
          OR u.codeuker LIKE @search
          OR mu.nama_uker LIKE @search
          OR pegawai_uker.nama_uker LIKE @search
        )
    `

    const [listResult, countResult, summaryResult, referenceData] = await Promise.all([
      addInputs(db.request())
        .input("offset", sql.Int, offset)
        .input("pageSize", sql.Int, pageSize)
        .query(`
          SELECT
            u.id,
            u.username,
            COALESCE(NULLIF(p.nama, ''), u.full_name) AS full_name,
            COALESCE(NULLIF(p.email, ''), u.email) AS email,
            u.pegawai_id,
            p.nip AS pegawai_nip,
            p.nama AS pegawai_nama,
            p.email AS pegawai_email,
            p.jabatan AS pegawai_jabatan,
            p.status AS pegawai_status,
            p.status_peg AS pegawai_status_kepegawaian,
            p.uker_id AS pegawai_uker_id,
            pegawai_uker.codeuker AS pegawai_codeuker,
            pegawai_uker.nama_uker AS pegawai_uker_name,
            u.role_id,
            u.codeuker AS stored_codeuker,
            CASE
              WHEN r.role_code = '${ROLE_CODE_SUPER_ADMIN}' THEN NULL
              ELSE COALESCE(pegawai_uker.codeuker, u.codeuker)
            END AS codeuker,
            CASE
              WHEN r.role_code = '${ROLE_CODE_SUPER_ADMIN}' THEN NULL
              ELSE COALESCE(pegawai_uker.nama_uker, mu.nama_uker)
            END AS uker_name,
            r.role_code,
            r.role_name,
            u.is_active,
            u.must_change_password,
            u.failed_login_count,
            u.locked_until,
            CASE
              WHEN u.locked_until IS NOT NULL AND u.locked_until > SYSDATETIME()
              THEN CAST(1 AS BIT)
              ELSE CAST(0 AS BIT)
            END AS is_locked,
            u.last_login_at,
            u.password_changed_at,
            u.created_at,
            u.updated_at,
            CONVERT(VARCHAR(18), CONVERT(VARBINARY(8), u.row_version), 1) AS row_version
          ${joins}
          ${whereClause}
          ORDER BY
            CASE WHEN r.role_code = '${ROLE_CODE_SUPER_ADMIN}' THEN 0 ELSE 1 END,
            COALESCE(NULLIF(p.nama, ''), u.full_name) ASC,
            u.id ASC
          OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
        `),
      addInputs(db.request()).query(`
        SELECT COUNT_BIG(*) AS total
        ${joins}
        ${whereClause};
      `),
      db.request().query(`
        SELECT
          COUNT_BIG(*) AS total,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN locked_until IS NOT NULL AND locked_until > SYSDATETIME() THEN 1 ELSE 0 END) AS locked
        FROM dbo.users;
      `),
      loadReferenceData(db),
    ])

    const total = Number(countResult.recordset[0]?.total || 0)
    const summaryRow = summaryResult.recordset[0] || {}

    return NextResponse.json({
      success: true,
      data: {
        currentUserId: Number(authorization.user.id),
        users: listResult.recordset.map((item) => ({
          ...item,
          row_version: normalizeRowVersionToken(item.row_version),
        })),
        ...referenceData,
        pegawai: [],
        pagination: {
          page,
          page_size: pageSize,
          total,
          total_pages: Math.max(1, Math.ceil(total / pageSize)),
        },
        summary: {
          total: Number(summaryRow.total || 0),
          active: Number(summaryRow.active || 0),
          locked: Number(summaryRow.locked || 0),
          roleCount: referenceData.roles.length,
        },
      },
    })
  } catch (error) {
    console.error("GET user role error:", error)
    return createErrorResponse("Gagal mengambil data user dan role.", 500)
  }
}

export async function POST(request) {
  const authorization = await authorizeSettings(request, "create")

  if (!authorization.authorized) {
    return authorization.response
  }

  try {
    const body = await request.json()

    const username = normalizeText(body.username).toLowerCase()
    const password = typeof body.password === "string" ? body.password : ""
    const roleId = Number(body.role_id)
    const pegawaiId = normalizeOptionalId(body.pegawai_id)
    const isActive = normalizeBoolean(body.is_active, true)

    const usernameError = validateUsername(username)
    const passwordError = validatePasswordPolicy(password)

    if (usernameError) {
      return createErrorResponse(usernameError)
    }

    if (passwordError) {
      return createErrorResponse(passwordError)
    }

    if (!Number.isInteger(roleId) || roleId <= 0) {
      return createErrorResponse("Role wajib dipilih.")
    }

    if (Number.isNaN(pegawaiId)) {
      return createErrorResponse("Pegawai yang dipilih tidak valid.")
    }

    const db = await connectDB()
    const role = await findActiveRole(db, roleId)

    if (!role) {
      return createErrorResponse("Role tidak ditemukan atau tidak aktif.", 404)
    }

    if (!pegawaiId && role.role_code !== ROLE_CODE_SUPER_ADMIN) {
      return createErrorResponse("Pegawai wajib dipilih untuk user non-Super Admin.")
    }

    const pegawai = pegawaiId ? await findPegawaiById(db, pegawaiId) : null

    if (pegawaiId && !pegawai) {
      return createErrorResponse("Data pegawai tidak ditemukan.", 404)
    }

    if (pegawai && !Boolean(pegawai.status)) {
      return createErrorResponse(
        "Pegawai tidak aktif dan tidak dapat dihubungkan dengan akun user.",
        409
      )
    }

    const linkedUser = await ensurePegawaiIsAvailable(db, pegawaiId)

    if (linkedUser) {
      return createErrorResponse(
        `Pegawai sudah terhubung dengan akun @${linkedUser.username}.`,
        409
      )
    }

    const fullName = pegawai
      ? normalizeText(pegawai.nama)
      : normalizeText(body.full_name)
    const email = pegawai
      ? normalizeEmail(pegawai.email)
      : normalizeEmail(body.email)
    const codeUker =
      role.role_code === ROLE_CODE_SUPER_ADMIN
        ? null
        : normalizeCodeUker(pegawai?.codeuker)

    const fullNameError = validateFullName(fullName)
    const emailError = validateEmail(email)

    if (fullNameError) {
      return createErrorResponse(fullNameError)
    }

    if (emailError) {
      return createErrorResponse(emailError)
    }

    if (role.role_code !== ROLE_CODE_SUPER_ADMIN && !codeUker) {
      return createErrorResponse(
        "Pegawai belum memiliki unit kerja. Lengkapi unit kerja pada master pegawai terlebih dahulu."
      )
    }

    if (!(await ensureUsernameIsUnique(db, username))) {
      return createErrorResponse("Username sudah digunakan.", 409)
    }

    if (!(await ensureEmailIsUnique(db, email))) {
      return createErrorResponse("Email pegawai sudah digunakan oleh akun lain.", 409)
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const result = await db
      .request()
      .input("username", sql.VarChar(50), username)
      .input("fullName", sql.VarChar(100), fullName)
      .input("email", sql.VarChar(150), email || null)
      .input("passwordHash", sql.VarChar(255), passwordHash)
      .input("roleId", sql.Int, role.id)
      .input("pegawaiId", sql.Int, pegawaiId)
      .input("codeUker", sql.NVarChar(4), codeUker)
      .input("isActive", sql.Bit, isActive)
      .query(`
        INSERT INTO dbo.users
        (
          username,
          full_name,
          email,
          password_hash,
          role_id,
          pegawai_id,
          codeuker,
          is_active,
          must_change_password,
          failed_login_count,
          locked_until,
          last_login_at,
          password_changed_at,
          created_at,
          updated_at
        )
        OUTPUT inserted.id
        VALUES
        (
          @username,
          @fullName,
          @email,
          @passwordHash,
          @roleId,
          @pegawaiId,
          @codeUker,
          @isActive,
          1,
          0,
          NULL,
          NULL,
          SYSDATETIME(),
          SYSDATETIME(),
          SYSDATETIME()
        );
      `)

    const createdUser = await getUserById(db, result.recordset[0].id)

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "CREATE",
      module: "settings.user_role",
      entityType: "user",
      entityId: createdUser.id,
      metadata: {
        after: {
          username: createdUser.username,
          pegawai_id: createdUser.pegawai_id,
          role_id: createdUser.role_id,
          role_code: createdUser.role_code,
          codeuker: createdUser.codeuker,
          is_active: createdUser.is_active,
          must_change_password: true,
        },
      },
    })

    return NextResponse.json(
      {
        success: true,
        message: "User berhasil ditambahkan dan dihubungkan ke pegawai.",
        data: createdUser,
      },
      {
        status: 201,
      }
    )
  } catch (error) {
    console.error("POST user role error:", error)

    if (error instanceof SyntaxError) {
      return createErrorResponse("Format data tidak valid.")
    }

    if (error?.number === 2601 || error?.number === 2627) {
      return createErrorResponse("Username, email, atau pegawai sudah digunakan.", 409)
    }

    return createErrorResponse("Gagal menambahkan user.", 500)
  }
}

export async function PUT(request) {
  const authorization = await authorizeSettings(request, "update")

  if (!authorization.authorized) {
    return authorization.response
  }

  try {
    const body = await request.json()

    const userId = Number(body.id)
    const roleId = Number(body.role_id)
    const pegawaiId = normalizeOptionalId(body.pegawai_id)
    const isActive = normalizeBoolean(body.is_active, true)
    const requestedRowVersion = normalizeRowVersionToken(body.row_version)

    if (!Number.isInteger(userId) || userId <= 0) {
      return createErrorResponse("ID user tidak valid.")
    }

    if (!Number.isInteger(roleId) || roleId <= 0) {
      return createErrorResponse("Role wajib dipilih.")
    }

    if (Number.isNaN(pegawaiId)) {
      return createErrorResponse("Pegawai yang dipilih tidak valid.")
    }

    if (!requestedRowVersion) {
      return createErrorResponse(
        "Versi data user tidak tersedia. Muat ulang sebelum menyimpan.",
        409
      )
    }

    const db = await connectDB()
    const existingUser = await getUserById(db, userId)

    if (!existingUser) {
      return createErrorResponse("User tidak ditemukan.", 404)
    }

    if (requestedRowVersion !== normalizeRowVersionToken(existingUser.row_version)) {
      return createErrorResponse(
        "Data user telah berubah oleh pengguna lain. Muat ulang sebelum menyimpan.",
        409
      )
    }

    const targetRole = await findActiveRole(db, roleId)

    if (!targetRole) {
      return createErrorResponse("Role tidak ditemukan atau tidak aktif.", 404)
    }

    if (!pegawaiId && targetRole.role_code !== ROLE_CODE_SUPER_ADMIN) {
      return createErrorResponse("Pegawai wajib dipilih untuk user non-Super Admin.")
    }

    const pegawai = pegawaiId ? await findPegawaiById(db, pegawaiId) : null

    if (pegawaiId && !pegawai) {
      return createErrorResponse("Data pegawai tidak ditemukan.", 404)
    }

    if (
      pegawai &&
      !Boolean(pegawai.status) &&
      Number(existingUser.pegawai_id || 0) !== Number(pegawaiId || 0)
    ) {
      return createErrorResponse(
        "Pegawai tidak aktif dan tidak dapat dihubungkan dengan akun user.",
        409
      )
    }

    const linkedUser = await ensurePegawaiIsAvailable(db, pegawaiId, userId)

    if (linkedUser) {
      return createErrorResponse(
        `Pegawai sudah terhubung dengan akun @${linkedUser.username}.`,
        409
      )
    }

    const fullName = pegawai
      ? normalizeText(pegawai.nama)
      : normalizeText(body.full_name)
    const email = pegawai
      ? normalizeEmail(pegawai.email)
      : normalizeEmail(body.email)
    const codeUker =
      targetRole.role_code === ROLE_CODE_SUPER_ADMIN
        ? null
        : normalizeCodeUker(pegawai?.codeuker)

    const fullNameError = validateFullName(fullName)
    const emailError = validateEmail(email)

    if (fullNameError) {
      return createErrorResponse(fullNameError)
    }

    if (emailError) {
      return createErrorResponse(emailError)
    }

    if (targetRole.role_code !== ROLE_CODE_SUPER_ADMIN && !codeUker) {
      return createErrorResponse(
        "Pegawai belum memiliki unit kerja. Lengkapi unit kerja pada master pegawai terlebih dahulu."
      )
    }

    const currentUserId = Number(authorization.user.id)

    if (userId === currentUserId) {
      if (!isActive) {
        return createErrorResponse("Anda tidak dapat menonaktifkan akun sendiri.", 409)
      }

      if (targetRole.role_code !== ROLE_CODE_SUPER_ADMIN) {
        return createErrorResponse(
          "Role akun Super Admin yang sedang digunakan tidak dapat diubah.",
          409
        )
      }
    }

    const removesActiveSuperAdmin =
      existingUser.role_code === ROLE_CODE_SUPER_ADMIN &&
      Boolean(existingUser.is_active) &&
      (targetRole.role_code !== ROLE_CODE_SUPER_ADMIN || !isActive)

    if (removesActiveSuperAdmin) {
      const otherSuperAdmins = await countOtherActiveSuperAdmins(db, userId)

      if (otherSuperAdmins === 0) {
        return createErrorResponse(
          "Minimal satu akun Super Admin harus tetap aktif.",
          409
        )
      }
    }

    if (!(await ensureEmailIsUnique(db, email, userId))) {
      return createErrorResponse("Email pegawai sudah digunakan oleh akun lain.", 409)
    }

    const updateResult = await db
      .request()
      .input("userId", sql.Int, userId)
      .input(
        "rowVersion",
        sql.VarBinary(8),
        Buffer.from(requestedRowVersion.slice(2), "hex")
      )
      .input("fullName", sql.VarChar(100), fullName)
      .input("email", sql.VarChar(150), email || null)
      .input("roleId", sql.Int, targetRole.id)
      .input("pegawaiId", sql.Int, pegawaiId)
      .input("codeUker", sql.NVarChar(4), codeUker)
      .input("isActive", sql.Bit, isActive)
      .query(`
        UPDATE dbo.users
        SET
          full_name = @fullName,
          email = @email,
          role_id = @roleId,
          pegawai_id = @pegawaiId,
          codeuker = @codeUker,
          is_active = @isActive,
          updated_at = SYSDATETIME()
        WHERE id = @userId
          AND row_version = @rowVersion;
      `)

    if (Number(updateResult.rowsAffected?.[0] || 0) === 0) {
      return createErrorResponse(
        "Data user telah berubah oleh pengguna lain. Muat ulang sebelum menyimpan.",
        409
      )
    }

    const identityOrScopeChanged =
      Number(existingUser.pegawai_id || 0) !== Number(pegawaiId || 0) ||
      String(existingUser.stored_codeuker || "") !== String(codeUker || "") ||
      Number(existingUser.role_id) !== Number(targetRole.id)

    if (!isActive || identityOrScopeChanged) {
      await db
        .request()
        .input("userId", sql.Int, userId)
        .query(`
          UPDATE dbo.user_sessions
          SET revoked_at = SYSDATETIME()
          WHERE user_id = @userId
            AND revoked_at IS NULL;
        `)
    }

    const updatedUser = await getUserById(db, userId)

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "UPDATE",
      module: "settings.user_role",
      entityType: "user",
      entityId: userId,
      metadata: {
        before: {
          username: existingUser.username,
          pegawai_id: existingUser.pegawai_id,
          role_id: existingUser.role_id,
          role_code: existingUser.role_code,
          codeuker: existingUser.codeuker,
          is_active: existingUser.is_active,
        },
        after: {
          username: updatedUser.username,
          pegawai_id: updatedUser.pegawai_id,
          role_id: updatedUser.role_id,
          role_code: updatedUser.role_code,
          codeuker: updatedUser.codeuker,
          is_active: updatedUser.is_active,
        },
        sessions_revoked: !isActive || identityOrScopeChanged,
      },
    })

    return NextResponse.json({
      success: true,
      message: "Data user dan relasi pegawai berhasil diperbarui.",
      data: updatedUser,
    })
  } catch (error) {
    console.error("PUT user role error:", error)

    if (error instanceof SyntaxError) {
      return createErrorResponse("Format data tidak valid.")
    }

    if (error?.number === 2601 || error?.number === 2627) {
      return createErrorResponse("Email atau pegawai sudah digunakan oleh akun lain.", 409)
    }

    return createErrorResponse("Gagal memperbarui user.", 500)
  }
}


export async function DELETE(request) {
  const authorization = await authorizeSettings(request, "delete")

  if (!authorization.authorized) {
    return authorization.response
  }

  try {
    const body = await request.json()
    const userId = Number(body.user_id ?? body.id)

    if (!Number.isInteger(userId) || userId <= 0) {
      return createErrorResponse("ID user tidak valid.")
    }

    const currentUserId = Number(authorization.user.id)

    if (userId === currentUserId) {
      return createErrorResponse(
        "Akun yang sedang digunakan tidak dapat dihapus.",
        409
      )
    }

    const db = await connectDB()
    const existingUser = await getUserById(db, userId)

    if (!existingUser) {
      return createErrorResponse("User tidak ditemukan.", 404)
    }

    if (
      existingUser.role_code === ROLE_CODE_SUPER_ADMIN &&
      Boolean(existingUser.is_active)
    ) {
      const otherSuperAdmins = await countOtherActiveSuperAdmins(db, userId)

      if (otherSuperAdmins === 0) {
        return createErrorResponse(
          "Minimal satu akun Super Admin harus tetap aktif.",
          409
        )
      }
    }

    const transaction = new sql.Transaction(db)
    await transaction.begin()

    try {
      await new sql.Request(transaction)
        .input("userId", sql.Int, userId)
        .query(`
          DELETE FROM dbo.user_sessions
          WHERE user_id = @userId;

          DELETE FROM dbo.users
          WHERE id = @userId;
        `)

      await transaction.commit()
    } catch (error) {
      await transaction.rollback()
      throw error
    }

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "DELETE",
      module: "settings.user_role",
      entityType: "user",
      entityId: userId,
      metadata: {
        before: {
          username: existingUser.username,
          pegawai_id: existingUser.pegawai_id,
          role_id: existingUser.role_id,
          role_code: existingUser.role_code,
          codeuker: existingUser.codeuker,
          is_active: existingUser.is_active,
        },
        sessions_deleted: true,
      },
    })

    return NextResponse.json({
      success: true,
      message: `Akun @${existingUser.username} berhasil dihapus. Data pegawai tetap tersimpan.`,
      data: {
        user_id: userId,
        pegawai_id: existingUser.pegawai_id || null,
      },
    })
  } catch (error) {
    console.error("DELETE user role error:", error)

    if (error instanceof SyntaxError) {
      return createErrorResponse("Format data tidak valid.")
    }

    const sqlErrorNumber =
      error?.number ||
      error?.originalError?.info?.number ||
      error?.precedingErrors?.[0]?.number ||
      null

    if (sqlErrorNumber === 547) {
      return createErrorResponse(
        "Akun masih digunakan oleh data lain dan belum dapat dihapus.",
        409
      )
    }

    return createErrorResponse("Gagal menghapus user.", 500)
  }
}

export async function PATCH(request) {
  const authorization = await authorizeSettings(request, "update")

  if (!authorization.authorized) {
    return authorization.response
  }

  try {
    const body = await request.json()
    const action = normalizeText(body.action)
    const db = await connectDB()

    if (action === "unlock_user") {
      const userId = Number(body.user_id)

      if (!Number.isInteger(userId) || userId <= 0) {
        return createErrorResponse("ID user tidak valid.")
      }

      const existingUser = await getUserById(db, userId)

      if (!existingUser) {
        return createErrorResponse("User tidak ditemukan.", 404)
      }

      await db
        .request()
        .input("userId", sql.Int, userId)
        .query(`
          UPDATE dbo.users
          SET
            failed_login_count = 0,
            locked_until = NULL,
            updated_at = SYSDATETIME()
          WHERE id = @userId;
        `)

      await writeAuditLog({
        request,
        userId: authorization.user.id,
        action: "UNLOCK_USER",
        module: "settings.user_role",
        entityType: "user",
        entityId: userId,
        metadata: {
          target_username: existingUser.username,
          failed_login_count_reset: true,
          locked_until_cleared: true,
        },
      })

      return NextResponse.json({
        success: true,
        message: "Kunci akun berhasil dibuka.",
      })
    }

    if (action === "reset_password") {
      const userId = Number(body.user_id)
      const password = typeof body.password === "string" ? body.password : ""

      if (!Number.isInteger(userId) || userId <= 0) {
        return createErrorResponse("ID user tidak valid.")
      }

      const passwordError = validatePasswordPolicy(password)

      if (passwordError) {
        return createErrorResponse(passwordError)
      }

      const existingUser = await getUserById(db, userId)

      if (!existingUser) {
        return createErrorResponse("User tidak ditemukan.", 404)
      }

      const passwordHash = await bcrypt.hash(password, 12)

      const transaction = new sql.Transaction(db)
      await transaction.begin()

      try {
        await new sql.Request(transaction)
          .input("userId", sql.Int, userId)
          .input("passwordHash", sql.VarChar(255), passwordHash)
          .query(`
            UPDATE dbo.users
            SET
              password_hash = @passwordHash,
              must_change_password = 1,
              failed_login_count = 0,
              locked_until = NULL,
              password_changed_at = SYSDATETIME(),
              updated_at = SYSDATETIME()
            WHERE id = @userId;

            UPDATE dbo.user_sessions
            SET revoked_at = SYSDATETIME()
            WHERE user_id = @userId
              AND revoked_at IS NULL;
          `)

        await transaction.commit()
      } catch (error) {
        await transaction.rollback()
        throw error
      }

      await writeAuditLog({
        request,
        userId: authorization.user.id,
        action: "RESET_PASSWORD",
        module: "settings.user_role",
        entityType: "user",
        entityId: userId,
        metadata: {
          target_username: existingUser.username,
          must_change_password: true,
          sessions_revoked: true,
          self_reset: userId === Number(authorization.user.id),
        },
      })

      return NextResponse.json({
        success: true,
        message:
          userId === Number(authorization.user.id)
            ? "Password berhasil direset. Session Anda telah diakhiri."
            : "Password user berhasil direset.",
        data: {
          selfReset: userId === Number(authorization.user.id),
        },
      })
    }

    if (action === "save_permissions") {
      const roleId = Number(body.role_id)

      if (!Number.isInteger(roleId) || roleId <= 0) {
        return createErrorResponse("Role tidak valid.")
      }

      const role = await findActiveRole(db, roleId)

      if (!role) {
        return createErrorResponse("Role tidak ditemukan atau tidak aktif.", 404)
      }

      const activeMenusResult = await db.request().query(`
        SELECT id, href
        FROM dbo.sidebar_routes
        WHERE is_active = 1
        ORDER BY sort_order ASC, id ASC;
      `)

      const activeMenus = activeMenusResult.recordset
      const activeMenuIdSet = new Set(activeMenus.map((menu) => Number(menu.id)))
      const legacyMenuIds = Array.isArray(body.menu_ids)
        ? body.menu_ids.map(Number).filter(Number.isInteger)
        : []
      const requestedPermissions = Array.isArray(body.permissions)
        ? body.permissions
        : legacyMenuIds.map((menuId) => ({ menu_id: menuId, can_view: true }))

      const normalizedPermissionMap = new Map()

      for (const item of requestedPermissions) {
        const menuId = Number(item?.menu_id ?? item?.sidebar_route_id)

        if (!Number.isInteger(menuId) || !activeMenuIdSet.has(menuId)) {
          continue
        }

        const canCreate = Boolean(item?.can_create)
        const canUpdate = Boolean(item?.can_update)
        const canDelete = Boolean(item?.can_delete)
        const canView = Boolean(item?.can_view) || canCreate || canUpdate || canDelete

        if (canView) {
          normalizedPermissionMap.set(menuId, {
            menu_id: menuId,
            can_view: true,
            can_create: canCreate,
            can_update: canUpdate,
            can_delete: canDelete,
          })
        }
      }

      if (role.role_code === ROLE_CODE_SUPER_ADMIN) {
        for (const menu of activeMenus) {
          normalizedPermissionMap.set(Number(menu.id), {
            menu_id: Number(menu.id),
            can_view: true,
            can_create: true,
            can_update: true,
            can_delete: true,
          })
        }
      } else {
        const dashboardMenu = activeMenus.find((menu) => menu.href === "/dashboard")
        if (dashboardMenu) {
          const dashboardId = Number(dashboardMenu.id)
          const existing = normalizedPermissionMap.get(dashboardId) || {}
          normalizedPermissionMap.set(dashboardId, {
            menu_id: dashboardId,
            can_view: true,
            can_create: Boolean(existing.can_create),
            can_update: Boolean(existing.can_update),
            can_delete: Boolean(existing.can_delete),
          })
        }
      }

      const normalizedPermissions = [...normalizedPermissionMap.values()]

      if (normalizedPermissions.length === 0) {
        return createErrorResponse("Minimal satu menu harus memiliki akses lihat.")
      }

      const existingPermissionsResult = await db
        .request()
        .input("roleId", sql.Int, roleId)
        .query(`
          SELECT
            sidebar_route_id AS menu_id,
            can_view,
            can_create,
            can_update,
            can_delete
          FROM dbo.role_sidebar_routes
          WHERE role_id = @roleId
          ORDER BY sidebar_route_id ASC;
        `)
      const existingPermissions = existingPermissionsResult.recordset

      const transaction = new sql.Transaction(db)
      await transaction.begin()

      try {
        await new sql.Request(transaction)
          .input("roleId", sql.Int, roleId)
          .query(`
            DELETE FROM dbo.role_sidebar_routes
            WHERE role_id = @roleId;
          `)

        for (const permission of normalizedPermissions) {
          await new sql.Request(transaction)
            .input("roleId", sql.Int, roleId)
            .input("menuId", sql.Int, permission.menu_id)
            .input("canView", sql.Bit, permission.can_view)
            .input("canCreate", sql.Bit, permission.can_create)
            .input("canUpdate", sql.Bit, permission.can_update)
            .input("canDelete", sql.Bit, permission.can_delete)
            .query(`
              INSERT INTO dbo.role_sidebar_routes
              (
                role_id,
                sidebar_route_id,
                can_view,
                can_create,
                can_update,
                can_delete,
                created_at,
                updated_at
              )
              VALUES
              (
                @roleId,
                @menuId,
                @canView,
                @canCreate,
                @canUpdate,
                @canDelete,
                SYSDATETIME(),
                SYSDATETIME()
              );
            `)
        }

        await transaction.commit()
      } catch (error) {
        await transaction.rollback()
        throw error
      }

      await writeAuditLog({
        request,
        userId: authorization.user.id,
        action: "UPDATE_PERMISSIONS",
        module: "settings.user_role",
        entityType: "role_permissions",
        entityId: roleId,
        metadata: {
          role_code: role.role_code,
          role_name: role.role_name,
          before: existingPermissions,
          after: normalizedPermissions,
        },
      })

      return NextResponse.json({
        success: true,
        message: `Hak akses ${role.role_name} berhasil diperbarui.`,
        data: {
          role_id: roleId,
          permissions: normalizedPermissions,
        },
      })
    }

    return createErrorResponse("Aksi tidak dikenali.")
  } catch (error) {
    console.error("PATCH user role error:", error)

    if (error instanceof SyntaxError) {
      return createErrorResponse("Format data tidak valid.")
    }

    return createErrorResponse("Proses perubahan gagal.", 500)
  }
}
