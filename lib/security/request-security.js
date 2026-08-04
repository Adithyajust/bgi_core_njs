import crypto from "node:crypto"

import { NextResponse } from "next/server"

import { connectDB, sql } from "@/lib/mssql"

function firstHeaderValue(value) {
  return String(value || "").split(",")[0].trim()
}

export function getClientIp(request) {
  return (
    firstHeaderValue(request.headers.get("x-forwarded-for")) ||
    firstHeaderValue(request.headers.get("x-real-ip")) ||
    "unknown"
  ).slice(0, 64)
}

export function validateSameOrigin(request) {
  const method = String(request.method || "GET").toUpperCase()

  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return null
  }

  const fetchSite = String(request.headers.get("sec-fetch-site") || "").toLowerCase()
  if (fetchSite === "cross-site") {
    return NextResponse.json(
      { success: false, message: "Permintaan lintas situs ditolak." },
      { status: 403 }
    )
  }

  const host = firstHeaderValue(
    request.headers.get("x-forwarded-host") || request.headers.get("host")
  )
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"))
  const protocol = forwardedProto || new URL(request.url).protocol.replace(":", "")
  const origin = request.headers.get("origin")
  const referer = request.headers.get("referer")
  const sourceUrlValue = origin || referer
  const requireOrigin =
    process.env.SECURITY_REQUIRE_ORIGIN === "true" ||
    (process.env.SECURITY_REQUIRE_ORIGIN !== "false" &&
      process.env.NODE_ENV === "production")

  if (!sourceUrlValue) {
    if (!requireOrigin) return null

    return NextResponse.json(
      { success: false, message: "Header Origin atau Referer wajib tersedia." },
      { status: 403 }
    )
  }

  let sourceUrl
  try {
    sourceUrl = new URL(sourceUrlValue)
  } catch {
    return NextResponse.json(
      { success: false, message: "Origin permintaan tidak valid." },
      { status: 403 }
    )
  }

  if (!host || sourceUrl.host !== host || sourceUrl.protocol !== `${protocol}:`) {
    return NextResponse.json(
      { success: false, message: "Permintaan lintas origin ditolak." },
      { status: 403 }
    )
  }

  return null
}

function hashRateLimitKey(value) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

export async function consumeRateLimit({
  request,
  namespace,
  identifier = "",
  limit,
  windowSeconds,
}) {
  const safeLimit = Math.max(1, Number(limit) || 1)
  const safeWindow = Math.max(1, Number(windowSeconds) || 60)
  const ip = getClientIp(request)
  const keyHash = hashRateLimitKey(
    `${namespace}:${ip}:${String(identifier || "").toLowerCase()}`
  )
  const db = await connectDB()
  const result = await db
    .request()
    .input("keyHash", sql.Char(64), keyHash)
    .input("namespace", sql.VarChar(80), String(namespace).slice(0, 80))
    .input("windowSeconds", sql.Int, safeWindow)
    .input("requestLimit", sql.Int, safeLimit)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;

      DECLARE @now DATETIME2(0) = SYSDATETIME();

      DELETE TOP (100)
      FROM dbo.security_rate_limits
      WHERE updated_at < DATEADD(DAY, -2, @now);
      DECLARE @windowStart DATETIME2(0);
      DECLARE @requestCount INT;

      SELECT
        @windowStart = window_started_at,
        @requestCount = request_count
      FROM dbo.security_rate_limits WITH (UPDLOCK, HOLDLOCK)
      WHERE key_hash = @keyHash;

      IF @windowStart IS NULL
      BEGIN
        INSERT INTO dbo.security_rate_limits
        (
          key_hash,
          namespace,
          window_started_at,
          request_count,
          updated_at
        )
        VALUES
        (
          @keyHash,
          @namespace,
          @now,
          1,
          @now
        );

        SET @windowStart = @now;
        SET @requestCount = 1;
      END
      ELSE IF DATEADD(SECOND, @windowSeconds, @windowStart) <= @now
      BEGIN
        UPDATE dbo.security_rate_limits
        SET
          namespace = @namespace,
          window_started_at = @now,
          request_count = 1,
          updated_at = @now
        WHERE key_hash = @keyHash;

        SET @windowStart = @now;
        SET @requestCount = 1;
      END
      ELSE
      BEGIN
        UPDATE dbo.security_rate_limits
        SET
          request_count = request_count + 1,
          updated_at = @now
        WHERE key_hash = @keyHash;

        SET @requestCount = ISNULL(@requestCount, 0) + 1;
      END;

      COMMIT TRANSACTION;

      SELECT
        CAST(CASE WHEN @requestCount <= @requestLimit THEN 1 ELSE 0 END AS BIT) AS allowed,
        @requestCount AS request_count,
        @requestLimit AS request_limit,
        DATEDIFF(
          SECOND,
          @now,
          DATEADD(SECOND, @windowSeconds, @windowStart)
        ) AS retry_after_seconds;
    `)

  const row = result.recordset[0]
  return {
    allowed: Boolean(row?.allowed),
    count: Number(row?.request_count || 0),
    limit: safeLimit,
    retryAfterSeconds: Math.max(1, Number(row?.retry_after_seconds || safeWindow)),
  }
}

export function rateLimitResponse(result) {
  return NextResponse.json(
    {
      success: false,
      message: "Terlalu banyak permintaan. Coba kembali beberapa saat lagi.",
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
      },
    }
  )
}
