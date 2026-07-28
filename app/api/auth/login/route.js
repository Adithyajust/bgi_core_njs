import bcrypt from "bcryptjs"
import { NextResponse } from "next/server"
import { connectDB, sql } from "@/lib/mssql"
import {
  createUserSession,
  serializeAuthenticatedUser,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
} from "@/lib/auth"

export const runtime = "nodejs"

const MAX_LOGIN_ATTEMPTS = 5
const LOCK_DURATION_MINUTES = 15

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
    let body

    try {
      body = await request.json()
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