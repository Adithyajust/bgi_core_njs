import bcrypt from "bcryptjs"
import { NextResponse } from "next/server"

import {
  getUserFromSessionToken,
  hashSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth"
import { connectDB, sql } from "@/lib/mssql"
import { writeAuditLog } from "@/lib/security/audit-log"
import { validatePasswordPolicy } from "@/lib/security/password-policy"
import {
  consumeRateLimit,
  rateLimitResponse,
  validateSameOrigin,
} from "@/lib/security/request-security"

export const runtime = "nodejs"

function errorResponse(message, status = 400) {
  return NextResponse.json({ success: false, message }, { status })
}

export async function POST(request) {
  try {
    const originResponse = validateSameOrigin(request)
    if (originResponse) return originResponse

    const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value
    const user = await getUserFromSessionToken(sessionToken)

    if (!user || !sessionToken) {
      return errorResponse("Session tidak valid atau telah berakhir.", 401)
    }

    const rateLimit = await consumeRateLimit({
      request,
      namespace: "auth.change-password",
      identifier: String(user.id),
      limit: Number(process.env.PASSWORD_CHANGE_RATE_LIMIT || 5),
      windowSeconds: Number(process.env.PASSWORD_CHANGE_RATE_WINDOW_SECONDS || 3600),
    })

    if (!rateLimit.allowed) return rateLimitResponse(rateLimit)

    let body
    try {
      body = await request.json()
    } catch {
      return errorResponse("Format permintaan tidak valid.")
    }

    const currentPassword =
      typeof body.current_password === "string" ? body.current_password : ""
    const newPassword =
      typeof body.new_password === "string" ? body.new_password : ""
    const confirmation =
      typeof body.password_confirmation === "string"
        ? body.password_confirmation
        : ""

    if (!currentPassword) {
      return errorResponse("Password saat ini wajib diisi.")
    }

    const passwordError = validatePasswordPolicy(newPassword)
    if (passwordError) return errorResponse(passwordError)

    if (newPassword !== confirmation) {
      return errorResponse("Konfirmasi password baru tidak sama.")
    }

    if (currentPassword === newPassword) {
      return errorResponse("Password baru harus berbeda dari password saat ini.")
    }

    const normalizedUsername = String(user.username || "").toLowerCase()
    if (
      normalizedUsername.length >= 4 &&
      newPassword.toLowerCase().includes(normalizedUsername)
    ) {
      return errorResponse("Password tidak boleh mengandung username.")
    }

    const db = await connectDB()
    const passwordResult = await db
      .request()
      .input("userId", sql.Int, user.id)
      .query(`
        SELECT TOP 1 password_hash
        FROM dbo.users
        WHERE id = @userId
          AND is_active = 1;
      `)

    if (passwordResult.recordset.length === 0) {
      return errorResponse("Akun tidak ditemukan atau tidak aktif.", 403)
    }

    const currentPasswordValid = await bcrypt.compare(
      currentPassword,
      passwordResult.recordset[0].password_hash
    )

    if (!currentPasswordValid) {
      return errorResponse("Password saat ini tidak benar.", 401)
    }

    const rounds = Math.min(
      14,
      Math.max(10, Number(process.env.BCRYPT_ROUNDS || 12))
    )
    const passwordHash = await bcrypt.hash(newPassword, rounds)
    const currentSessionHash = hashSessionToken(sessionToken)

    const transaction = new sql.Transaction(db)
    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED)

    try {
      await new sql.Request(transaction)
        .input("userId", sql.Int, user.id)
        .input("passwordHash", sql.VarChar(255), passwordHash)
        .query(`
          UPDATE dbo.users
          SET
            password_hash = @passwordHash,
            must_change_password = 0,
            password_changed_at = SYSDATETIME(),
            failed_login_count = 0,
            locked_until = NULL,
            updated_at = SYSDATETIME()
          WHERE id = @userId;
        `)

      await new sql.Request(transaction)
        .input("userId", sql.Int, user.id)
        .input("currentSessionHash", sql.Char(64), currentSessionHash)
        .query(`
          UPDATE dbo.user_sessions
          SET revoked_at = SYSDATETIME()
          WHERE user_id = @userId
            AND session_token_hash <> @currentSessionHash
            AND revoked_at IS NULL;
        `)

      await transaction.commit()
    } catch (error) {
      try {
        await transaction.rollback()
      } catch {
        // Transaction may already be rolled back by SQL Server.
      }
      throw error
    }

    await writeAuditLog({
      request,
      userId: user.id,
      action: "CHANGE_PASSWORD",
      module: "AUTH",
      entityType: "USER",
      entityId: user.id,
      metadata: { other_sessions_revoked: true },
    })

    return NextResponse.json({
      success: true,
      message: "Password berhasil diperbarui.",
    })
  } catch (error) {
    console.error("Change password error:", error)
    return errorResponse("Terjadi kesalahan saat memperbarui password.", 500)
  }
}
