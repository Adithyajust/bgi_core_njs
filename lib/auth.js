import crypto from "node:crypto"
import { connectDB, sql } from "@/lib/mssql"

export const SESSION_COOKIE_NAME =
  "bgi_session"

export const SESSION_MAX_AGE =
  60 * 60 * 8

const SESSION_DURATION_HOURS = 8

export function serializeAuthenticatedUser(user) {
  if (!user) {
    return null
  }

  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    email: user.email,
    roleId: user.role_id,
    roleCode: user.role_code,
    roleName: user.role_name,
    codeUker: user.codeuker,
    ukerName: user.uker_name,
    mustChangePassword:
      user.must_change_password,
    pegawai: user.pegawai_id
      ? {
          id: user.pegawai_id,
          nip: user.pegawai_nip,
          nama: user.pegawai_nama,
          jabatan: user.pegawai_jabatan,
          handphone: user.pegawai_handphone,
          email: user.pegawai_email,
          status: user.pegawai_status,
          statusPeg:
            user.pegawai_status_kepegawaian,
          tglLahir: user.pegawai_tgl_lahir,
          tglJob: user.pegawai_tgl_job,
          foto: user.pegawai_foto,
          unitKerja: {
            id: user.pegawai_uker_id,
            codeUker:
              user.pegawai_codeuker,
            namaUker:
              user.pegawai_uker_name,
          },
        }
      : null,
  }
}

export function hashSessionToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex")
}

function getClientIp(request) {
  const forwardedFor =
    request.headers.get("x-forwarded-for")

  if (forwardedFor) {
    return forwardedFor
      .split(",")[0]
      .trim()
      .slice(0, 45)
  }

  const realIp =
    request.headers.get("x-real-ip")

  if (realIp) {
    return realIp.slice(0, 45)
  }

  return null
}

function getUserAgent(request) {
  const userAgent =
    request.headers.get("user-agent")

  if (!userAgent) {
    return null
  }

  return userAgent.slice(0, 500)
}

export async function createUserSession(
  userId,
  request
) {
  const sessionToken = crypto
    .randomBytes(32)
    .toString("hex")

  const sessionTokenHash =
    hashSessionToken(sessionToken)

  const ipAddress = getClientIp(request)
  const userAgent = getUserAgent(request)

  const db = await connectDB()

  const result = await db
    .request()
    .input(
      "userId",
      sql.Int,
      userId
    )
    .input(
      "sessionTokenHash",
      sql.VarChar(255),
      sessionTokenHash
    )
    .input(
      "ipAddress",
      sql.VarChar(45),
      ipAddress
    )
    .input(
      "userAgent",
      sql.VarChar(500),
      userAgent
    )
    .input(
      "durationHours",
      sql.Int,
      SESSION_DURATION_HOURS
    )
    .query(`
      DELETE FROM dbo.user_sessions
      WHERE user_id = @userId
        AND
        (
          expires_at <= SYSDATETIME()
          OR revoked_at IS NOT NULL
        );

      INSERT INTO dbo.user_sessions
      (
        user_id,
        session_token_hash,
        ip_address,
        user_agent,
        expires_at,
        revoked_at,
        created_at,
        last_activity_at
      )
      OUTPUT
        inserted.id,
        inserted.expires_at
      VALUES
      (
        @userId,
        @sessionTokenHash,
        @ipAddress,
        @userAgent,
        DATEADD(
          HOUR,
          @durationHours,
          SYSDATETIME()
        ),
        NULL,
        SYSDATETIME(),
        SYSDATETIME()
      );
    `)

  return {
    token: sessionToken,
    expiresAt:
      result.recordset[0].expires_at,
  }
}

export async function getUserFromSessionToken(
  sessionToken
) {
  if (!sessionToken) {
    return null
  }

  const sessionTokenHash =
    hashSessionToken(sessionToken)

  const db = await connectDB()

  const result = await db
    .request()
    .input(
      "sessionTokenHash",
      sql.VarChar(255),
      sessionTokenHash
    )
    .query(`
      SELECT TOP 1
        us.id AS session_id,
        us.expires_at,
        u.id,
        u.username,
        COALESCE(NULLIF(p.nama, ''), u.full_name) AS full_name,
        COALESCE(NULLIF(p.email, ''), u.email) AS email,
        u.role_id,
        CASE
          WHEN r.role_code = 'SUPER_ADMIN' THEN NULL
          ELSE COALESCE(pegawai_uker.codeuker, u.codeuker)
        END AS codeuker,
        CASE
          WHEN r.role_code = 'SUPER_ADMIN' THEN NULL
          ELSE COALESCE(pegawai_uker.nama_uker, mu.nama_uker)
        END AS uker_name,
        u.must_change_password,
        r.role_code,
        r.role_name,

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
      FROM dbo.user_sessions us
      INNER JOIN dbo.users u
        ON u.id = us.user_id
      INNER JOIN dbo.roles r
        ON r.id = u.role_id
      LEFT JOIN dbo.master_uker mu
        ON mu.codeuker = u.codeuker
      LEFT JOIN dbo.pegawai p
        ON p.id = u.pegawai_id
      LEFT JOIN dbo.master_uker pegawai_uker
        ON pegawai_uker.id = p.uker_id
      WHERE
        us.session_token_hash =
          @sessionTokenHash
        AND us.revoked_at IS NULL
        AND us.expires_at >
          SYSDATETIME()
        AND u.is_active = 1
        AND r.is_active = 1;
    `)

  if (result.recordset.length === 0) {
    return null
  }

  const user = result.recordset[0]

  await db
    .request()
    .input(
      "sessionId",
      sql.BigInt,
      user.session_id
    )
    .query(`
      UPDATE dbo.user_sessions
      SET last_activity_at = SYSDATETIME()
      WHERE id = @sessionId
        AND last_activity_at < DATEADD(MINUTE, -5, SYSDATETIME());
    `)

  return user
}

export async function revokeUserSession(
  sessionToken
) {
  if (!sessionToken) {
    return
  }

  const sessionTokenHash =
    hashSessionToken(sessionToken)

  const db = await connectDB()

  await db
    .request()
    .input(
      "sessionTokenHash",
      sql.VarChar(255),
      sessionTokenHash
    )
    .query(`
      UPDATE dbo.user_sessions
      SET revoked_at =
        SYSDATETIME()
      WHERE session_token_hash =
        @sessionTokenHash
        AND revoked_at IS NULL;
    `)
}