import { readJsonBody } from "@/lib/http/json-body"
import bcrypt from "bcryptjs"
import { NextResponse } from "next/server"
import { connectDB, sql } from "@/lib/mssql"
import {
  createUserSession,
  serializeAuthenticatedUser,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
} from "@/lib/auth"
import {
  consumeRateLimit,
  rateLimitResponse,
  validateSameOrigin,
} from "@/lib/security/request-security"
import { writeAuditLog } from "@/lib/security/audit-log"

export const runtime = "nodejs"

const MAX_LOGIN_ATTEMPTS = 5
const LOCK_DURATION_MINUTES = 15
const DUMMY_PASSWORD_HASH = "$2b$12$COuwxUN1tIW.LIYeGfMFH.vbqi2qew9JcljbEPR4vETBi8wZSShOq"

function normalizeUsername(value) {
  if (typeof value !== "string") {
    return ""
  }

  return value
    .trim()
    .toLowerCase()
}

export async function POST(request) {
  try {
    const originResponse = validateSameOrigin(request)

    if (originResponse) {
      return originResponse
    }

    let body

    try {
      body = await readJsonBody(request, { maxBytes: 2 * 1024 * 1024 })
    } catch {
      return NextResponse.json(
        {
          success: false,
          message:
            "Format permintaan tidak valid.",
        },
        {
          status: 400,
        }
      )
    }

    const username =
      normalizeUsername(body.username)

    const password =
      typeof body.password === "string"
        ? body.password
        : ""

    if (!username || !password) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Username dan password wajib diisi.",
        },
        {
          status: 400,
        }
      )
    }


    const windowSeconds = Number(
      process.env.LOGIN_RATE_WINDOW_SECONDS || 900
    )
    const ipRateLimit = await consumeRateLimit({
      request,
      namespace: "auth.login.ip",
      limit: Number(process.env.LOGIN_IP_RATE_LIMIT || 50),
      windowSeconds,
    })

    if (!ipRateLimit.allowed) {
      await writeAuditLog({
        request,
        action: "LOGIN_THROTTLED",
        module: "auth.login",
        entityType: "user",
        entityId: username || null,
        metadata: {
          username: username || null,
          reason: "IP_RATE_LIMIT",
          retry_after_seconds: ipRateLimit.retryAfterSeconds || null,
          user_agent: request.headers.get("user-agent")?.slice(0, 500) || null,
        },
      })

      return rateLimitResponse(ipRateLimit)
    }

    const accountRateLimit = await consumeRateLimit({
      request,
      namespace: "auth.login.account",
      identifier: username,
      limit: Number(process.env.LOGIN_RATE_LIMIT || 10),
      windowSeconds,
    })

    if (!accountRateLimit.allowed) {
      await writeAuditLog({
        request,
        action: "LOGIN_THROTTLED",
        module: "auth.login",
        entityType: "user",
        entityId: username,
        metadata: {
          username,
          reason: "ACCOUNT_RATE_LIMIT",
          retry_after_seconds: accountRateLimit.retryAfterSeconds || null,
          user_agent: request.headers.get("user-agent")?.slice(0, 500) || null,
        },
      })

      return rateLimitResponse(accountRateLimit)
    }

    const db = await connectDB()

    const userResult = await db
      .request()
      .input(
        "username",
        sql.VarChar(50),
        username
      )
      .query(`
        SELECT TOP 1
          u.id,
          u.username,
          COALESCE(NULLIF(p.nama, ''), u.full_name) AS full_name,
          COALESCE(NULLIF(p.email, ''), u.email) AS email,
          u.password_hash,
          u.role_id,
          CASE
            WHEN r.role_code = 'SUPER_ADMIN' THEN NULL
            ELSE COALESCE(pegawai_uker.codeuker, u.codeuker)
          END AS codeuker,
          CASE
            WHEN r.role_code = 'SUPER_ADMIN' THEN NULL
            ELSE COALESCE(pegawai_uker.nama_uker, mu.nama_uker)
          END AS uker_name,
          u.is_active,
          u.must_change_password,
          u.failed_login_count,
          u.locked_until,
          r.role_code,
          r.role_name,
          r.is_active AS role_is_active,

          u.pegawai_id,
          p.nip AS pegawai_nip,
          p.nama AS pegawai_nama,
          p.jabatan AS pegawai_jabatan,
          p.handphone AS pegawai_handphone,
          p.email AS pegawai_email,
          p.status AS pegawai_status,
          p.status_peg AS pegawai_status_kepegawaian,
          p.tgl_lahir AS pegawai_tgl_lahir,
          p.tgl_job AS pegawai_tgl_job,
          p.foto AS pegawai_foto,
          p.uker_id AS pegawai_uker_id,
          pegawai_uker.codeuker AS pegawai_codeuker,
          pegawai_uker.nama_uker AS pegawai_uker_name
        FROM dbo.users u
        INNER JOIN dbo.roles r
          ON r.id = u.role_id
        LEFT JOIN dbo.master_uker mu
          ON mu.codeuker = u.codeuker
        LEFT JOIN dbo.pegawai p
          ON p.id = u.pegawai_id
        LEFT JOIN dbo.master_uker pegawai_uker
          ON pegawai_uker.id = p.uker_id
        WHERE u.username = @username;
      `)

    if (userResult.recordset.length === 0) {
      // Keep the response timing close to the invalid-password path to reduce
      // username enumeration through a bcrypt timing side channel.
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH)

      await writeAuditLog({
        request,
        action: "LOGIN_FAILED",
        module: "auth.login",
        entityType: "user",
        entityId: username,
        metadata: {
          username,
          reason: "UNKNOWN_USERNAME",
          user_agent: request.headers.get("user-agent")?.slice(0, 500) || null,
        },
      })

      return NextResponse.json(
        {
          success: false,
          message:
            "Username atau password salah.",
        },
        {
          status: 401,
        }
      )
    }

    const user = userResult.recordset[0]

    if (
      !user.is_active ||
      !user.role_is_active
    ) {
      await writeAuditLog({
        request,
        userId: user.id,
        action: "LOGIN_DENIED",
        module: "auth.login",
        entityType: "user",
        entityId: user.id,
        metadata: {
          username: user.username,
          reason: !user.is_active ? "USER_INACTIVE" : "ROLE_INACTIVE",
          role_code: user.role_code,
          codeuker: user.codeuker,
          user_agent: request.headers.get("user-agent")?.slice(0, 500) || null,
        },
      })

      return NextResponse.json(
        {
          success: false,
          message:
            "Akun tidak aktif. Hubungi administrator.",
        },
        {
          status: 403,
        }
      )
    }

    if (
      user.locked_until &&
      new Date(user.locked_until) >
        new Date()
    ) {
      await writeAuditLog({
        request,
        userId: user.id,
        action: "LOGIN_DENIED",
        module: "auth.login",
        entityType: "user",
        entityId: user.id,
        metadata: {
          username: user.username,
          reason: "ACCOUNT_LOCKED",
          locked_until: user.locked_until,
          role_code: user.role_code,
          codeuker: user.codeuker,
          user_agent: request.headers.get("user-agent")?.slice(0, 500) || null,
        },
      })

      return NextResponse.json(
        {
          success: false,
          message:
            "Akun terkunci sementara karena terlalu banyak percobaan login.",
          lockedUntil:
            user.locked_until,
        },
        {
          status: 423,
        }
      )
    }

    const passwordValid =
      await bcrypt.compare(
        password,
        user.password_hash
      )

    if (!passwordValid) {
      const failedAttemptNumber = Number(user.failed_login_count || 0) + 1
      const accountWillBeLocked = failedAttemptNumber >= MAX_LOGIN_ATTEMPTS

      await db
        .request()
        .input(
          "userId",
          sql.Int,
          user.id
        )
        .input(
          "maxAttempts",
          sql.Int,
          MAX_LOGIN_ATTEMPTS
        )
        .input(
          "lockMinutes",
          sql.Int,
          LOCK_DURATION_MINUTES
        )
        .query(`
          UPDATE dbo.users
          SET
            failed_login_count =
              CASE
                WHEN failed_login_count + 1
                  >= @maxAttempts
                THEN 0
                ELSE failed_login_count + 1
              END,

            locked_until =
              CASE
                WHEN failed_login_count + 1
                  >= @maxAttempts
                THEN DATEADD(
                  MINUTE,
                  @lockMinutes,
                  SYSDATETIME()
                )
                ELSE NULL
              END,

            updated_at =
              SYSDATETIME()
          WHERE id = @userId;
        `)

      await writeAuditLog({
        request,
        userId: user.id,
        action: "LOGIN_FAILED",
        module: "auth.login",
        entityType: "user",
        entityId: user.id,
        metadata: {
          username: user.username,
          reason: "INVALID_PASSWORD",
          failed_attempt_number: failedAttemptNumber,
          account_locked: accountWillBeLocked,
          lock_duration_minutes: accountWillBeLocked
            ? LOCK_DURATION_MINUTES
            : null,
          role_code: user.role_code,
          codeuker: user.codeuker,
          user_agent: request.headers.get("user-agent")?.slice(0, 500) || null,
        },
      })

      return NextResponse.json(
        {
          success: false,
          message:
            "Username atau password salah.",
        },
        {
          status: 401,
        }
      )
    }

    await db
      .request()
      .input(
        "userId",
        sql.Int,
        user.id
      )
      .query(`
        UPDATE dbo.users
        SET
          failed_login_count = 0,
          locked_until = NULL,
          last_login_at =
            SYSDATETIME(),
          updated_at =
            SYSDATETIME()
        WHERE id = @userId;
      `)

    const session =
      await createUserSession(
        user.id,
        request
      )

    await writeAuditLog({
      request,
      userId: user.id,
      action: "LOGIN_SUCCESS",
      module: "auth.login",
      entityType: "user",
      entityId: user.id,
      metadata: {
        username: user.username,
        role_code: user.role_code,
        role_name: user.role_name,
        codeuker: user.codeuker,
        uker_name: user.uker_name,
        must_change_password: Boolean(user.must_change_password),
        session_expires_at: session.expiresAt,
        user_agent: request.headers.get("user-agent")?.slice(0, 500) || null,
      },
    })

    const response =
      NextResponse.json({
        success: true,
        message: "Login berhasil.",
        data: serializeAuthenticatedUser(user),
      })

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: session.token,
      httpOnly: true,
      secure:
        process.env.NODE_ENV ===
        "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    })

    return response
  } catch (error) {
    console.error(
      "Login error:",
      error
    )

    return NextResponse.json(
      {
        success: false,
        message:
          "Terjadi kesalahan pada proses login.",
      },
      {
        status: 500,
      }
    )
  }
}