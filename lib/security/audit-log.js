import crypto from "node:crypto"

import { connectDB, sql } from "@/lib/mssql"
import { getClientIp } from "@/lib/security/request-security"

const SENSITIVE_METADATA_KEYS = new Set([
  "authorization", "cookie", "password", "password_hash", "passwordhash",
  "secret", "session_token", "session_token_hash", "token",
])

function serializeAuditMetadata(metadata) {
  if (metadata === null || metadata === undefined) return null
  const visited = new WeakSet()
  const serialized = JSON.stringify(metadata, (key, value) => {
    if (SENSITIVE_METADATA_KEYS.has(String(key).toLowerCase())) return "[REDACTED]"
    if (typeof value === "bigint") return value.toString()
    if (Buffer.isBuffer(value)) return `0x${value.toString("hex").toUpperCase()}`
    if (value instanceof Error) return { name: value.name, message: value.message, code: value.code || null }
    if (value && typeof value === "object") {
      if (visited.has(value)) return "[Circular]"
      visited.add(value)
    }
    return value
  })
  return serialized === undefined ? null : serialized
}

function normalizeAuditPayload({ request, userId = null, action, module, entityType = null, entityId = null, metadata = null }) {
  const normalizedUserId = Number(userId)
  const safeUserId = userId === null || userId === undefined || userId === "" ||
    !Number.isSafeInteger(normalizedUserId) || normalizedUserId <= 0 ? null : normalizedUserId
  return {
    userId: safeUserId,
    action: String(action || "UNKNOWN").slice(0, 30),
    module: String(module || "unknown").slice(0, 100),
    entityType: entityType ? String(entityType).slice(0, 100) : null,
    entityId: entityId === null || entityId === undefined ? null : String(entityId).slice(0, 100),
    ipAddress: request ? getClientIp(request).slice(0, 45) : "unknown",
    requestId: String(request?.headers?.get("x-request-id") || crypto.randomUUID()).slice(0, 64),
    metadataJson: serializeAuditMetadata(metadata),
  }
}

export async function insertAuditLog(executor, input) {
  const payload = normalizeAuditPayload(input)
  const result = await new sql.Request(executor)
    .input("userId", sql.Int, payload.userId)
    .input("action", sql.VarChar(30), payload.action)
    .input("module", sql.VarChar(100), payload.module)
    .input("entityType", sql.VarChar(100), payload.entityType)
    .input("entityId", sql.VarChar(100), payload.entityId)
    .input("ipAddress", sql.VarChar(45), payload.ipAddress)
    .input("requestId", sql.VarChar(64), payload.requestId)
    .input("metadataJson", sql.NVarChar(sql.MAX), payload.metadataJson)
    .query(`
      IF OBJECT_ID(N'dbo.audit_logs', N'U') IS NULL
        THROW 51000, 'Tabel dbo.audit_logs belum tersedia. Jalankan npm run db:migrate.', 1;
      INSERT INTO dbo.audit_logs
      (user_id, action, module, entity_type, entity_id, ip_address, request_id, metadata_json)
      OUTPUT INSERTED.id
      VALUES (@userId, @action, @module, @entityType, @entityId, @ipAddress, @requestId, @metadataJson);
    `)
  return { success: true, id: Number(result.recordset[0]?.id || 0) || null }
}

export async function writeAuditLog(input) {
  const payload = normalizeAuditPayload(input)
  try {
    const db = await connectDB()
    return await insertAuditLog(db, input)
  } catch (error) {
    console.error("Audit log write failed:", {
      action: payload.action, module: payload.module, entityType: payload.entityType,
      entityId: payload.entityId, userId: payload.userId,
      sqlErrorNumber: error?.number || error?.originalError?.info?.number || null,
      message: error?.originalError?.info?.message || error?.message || "Kesalahan audit tidak diketahui.",
    })
    return { success: false, error }
  }
}
