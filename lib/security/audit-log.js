import crypto from "node:crypto"

import { connectDB, sql } from "@/lib/mssql"
import { getClientIp } from "@/lib/security/request-security"

const SENSITIVE_METADATA_KEYS = new Set([
  "authorization",
  "cookie",
  "password",
  "password_hash",
  "passwordhash",
  "secret",
  "session_token",
  "session_token_hash",
  "token",
])

function serializeAuditMetadata(metadata) {
  if (metadata === null || metadata === undefined) {
    return null
  }

  const visited = new WeakSet()
  const serialized = JSON.stringify(metadata, (key, value) => {
    if (SENSITIVE_METADATA_KEYS.has(String(key).toLowerCase())) {
      return "[REDACTED]"
    }

    if (typeof value === "bigint") {
      return value.toString()
    }

    if (Buffer.isBuffer(value)) {
      return `0x${value.toString("hex").toUpperCase()}`
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        code: value.code || null,
      }
    }

    if (value && typeof value === "object") {
      if (visited.has(value)) {
        return "[Circular]"
      }
      visited.add(value)
    }

    return value
  })

  return serialized === undefined ? null : serialized
}

/**
 * Menulis audit trail aplikasi ke tabel kanonis dbo.audit_logs.
 *
 * Kegagalan audit tidak membatalkan transaksi bisnis yang telah selesai,
 * tetapi hasil fungsi dan server log tetap memperlihatkan kegagalannya agar
 * masalah konfigurasi database tidak tersembunyi.
 */
export async function writeAuditLog({
  request,
  userId = null,
  action,
  module,
  entityType = null,
  entityId = null,
  metadata = null,
}) {
  const safeAction = String(action || "UNKNOWN").slice(0, 30)
  const safeModule = String(module || "unknown").slice(0, 100)
  const safeEntityType = entityType
    ? String(entityType).slice(0, 100)
    : null
  const safeEntityId =
    entityId === null || entityId === undefined
      ? null
      : String(entityId).slice(0, 100)
  const normalizedUserId = Number(userId)
  const safeUserId =
    userId === null ||
    userId === undefined ||
    userId === "" ||
    !Number.isSafeInteger(normalizedUserId) ||
    normalizedUserId <= 0
      ? null
      : normalizedUserId

  try {
    const db = await connectDB()
    const requestId =
      request?.headers?.get("x-request-id") || crypto.randomUUID()
    const ipAddress = request ? getClientIp(request).slice(0, 45) : "unknown"
    const metadataJson = serializeAuditMetadata(metadata)

    const result = await db
      .request()
      .input("userId", sql.Int, safeUserId)
      .input("action", sql.VarChar(30), safeAction)
      .input("module", sql.VarChar(100), safeModule)
      .input("entityType", sql.VarChar(100), safeEntityType)
      .input("entityId", sql.VarChar(100), safeEntityId)
      .input("ipAddress", sql.VarChar(45), ipAddress)
      .input("requestId", sql.VarChar(64), String(requestId).slice(0, 64))
      .input("metadataJson", sql.NVarChar(sql.MAX), metadataJson)
      .query(`
        IF OBJECT_ID(N'dbo.audit_logs', N'U') IS NULL
          THROW 51000, 'Tabel dbo.audit_logs belum tersedia. Jalankan npm run db:migrate.', 1;

        INSERT INTO dbo.audit_logs
        (
          user_id,
          action,
          module,
          entity_type,
          entity_id,
          ip_address,
          request_id,
          metadata_json
        )
        OUTPUT INSERTED.id
        VALUES
        (
          @userId,
          @action,
          @module,
          @entityType,
          @entityId,
          @ipAddress,
          @requestId,
          @metadataJson
        );
      `)

    return {
      success: true,
      id: Number(result.recordset[0]?.id || 0) || null,
    }
  } catch (error) {
    console.error("Audit log write failed:", {
      action: safeAction,
      module: safeModule,
      entityType: safeEntityType,
      entityId: safeEntityId,
      userId: safeUserId,
      sqlErrorNumber:
        error?.number || error?.originalError?.info?.number || null,
      message:
        error?.originalError?.info?.message ||
        error?.message ||
        "Kesalahan audit tidak diketahui.",
    })

    return { success: false, error }
  }
}
