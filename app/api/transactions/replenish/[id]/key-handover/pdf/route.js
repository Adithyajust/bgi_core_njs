import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope, hasMenuAccess } from "@/lib/access-control"
import { connectDB, sql } from "@/lib/mssql"
import { isReplenishKeyHandoverPrinter } from "@/modules/replenish/authorization"
import { hasReplenishReachedApproval } from "@/modules/replenish/constants"
import {
  canAccessStoredKeyHandoverPdf,
  readStoredKeyHandoverPdf,
} from "@/modules/replenish/key-handover-pdf-storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function errorResponse(message, status = 400) {
  return NextResponse.json({ success: false, message }, { status })
}

function normalizeId(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function parsePdfRange(rangeHeader, size) {
  if (!rangeHeader) return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader).trim())
  if (!match) return { invalid: true }
  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return { invalid: true }

  let start
  let end
  if (!rawStart) {
    const suffixLength = Number(rawEnd)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { invalid: true }
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd ? Number(rawEnd) : size - 1
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    return { invalid: true }
  }
  return { start, end: Math.min(end, size - 1) }
}

function pdfHeaders(stored, contentLength) {
  return {
    "Content-Type": "application/pdf",
    "Content-Length": String(contentLength),
    "Content-Disposition": `inline; filename="${stored.file_name}"`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache, must-revalidate",
    "ETag": `"${stored.pdf_hash}"`,
    "X-Content-Type-Options": "nosniff",
  }
}

async function loadAccessRecord(executor, workOrderId, scopeCodeUker) {
  const result = await new sql.Request(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("scopeCodeUker", sql.NVarChar(4), scopeCodeUker)
    .query(`
      SELECT TOP (1)
        wo.id,
        wo.status,
        wo.created_by,
        mu.codeuker
      FROM dbo.replenish_work_orders wo
      INNER JOIN dbo.master_uker mu ON mu.id = wo.uker_id
      WHERE wo.id = @workOrderId
        AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker);
    `)
  return result.recordset[0] || null
}

export async function GET(request, context) {
  const authorization = await authorizeApiRequest(request, "/transactions", "view")
  if (!authorization.authorized) return authorization.response

  const { id } = await context.params
  const workOrderId = normalizeId(id)
  if (!workOrderId) return errorResponse("ID work order tidak valid.")

  try {
    const scope = getUserDataScope(authorization.user)
    const scopeCodeUker = scope.isSuperAdmin ? null : scope.codeUker
    const db = await connectDB()
    const accessRecord = await loadAccessRecord(db, workOrderId, scopeCodeUker)
    if (!accessRecord) return errorResponse("File PDF Serah Terima Kunci tidak ditemukan.", 404)

    const isOwner = Number(accessRecord.created_by) === Number(authorization.user.id)
    const [canCreateTransaction, canUpdateTransaction] = scope.isSuperAdmin
      ? [true, true]
      : await Promise.all([
          hasMenuAccess(authorization.user.role_id, "/transactions", "create"),
          hasMenuAccess(authorization.user.role_id, "/transactions", "update"),
        ])
    const canPrintKeyHandover = Boolean(
      scope.isSuperAdmin ||
      isOwner ||
      isReplenishKeyHandoverPrinter(authorization.user) ||
      canCreateTransaction ||
      canUpdateTransaction
    )
    if (!canPrintKeyHandover) {
      return errorResponse("Anda tidak memiliki akses cetak PDF Serah Terima Kunci ini.", 403)
    }
    if (!hasReplenishReachedApproval(accessRecord.status)) {
      return errorResponse("PDF Serah Terima Kunci hanya tersedia setelah Work Order pernah disetujui.", 409)
    }

    const stored = await readStoredKeyHandoverPdf(workOrderId, { includeBuffer: true })
    if (!stored || !canAccessStoredKeyHandoverPdf(stored, scope)) {
      return errorResponse("File PDF Serah Terima Kunci belum tersedia.", 404)
    }

    const totalSize = stored.buffer.length
    const requestedRange = parsePdfRange(request.headers.get("range"), totalSize)
    if (requestedRange?.invalid) {
      return new Response(null, {
        status: 416,
        headers: { ...pdfHeaders(stored, 0), "Content-Range": `bytes */${totalSize}` },
      })
    }
    if (requestedRange) {
      const chunk = stored.buffer.subarray(requestedRange.start, requestedRange.end + 1)
      return new Response(chunk, {
        status: 206,
        headers: {
          ...pdfHeaders(stored, chunk.length),
          "Content-Range": `bytes ${requestedRange.start}-${requestedRange.end}/${totalSize}`,
        },
      })
    }

    return new Response(stored.buffer, { status: 200, headers: pdfHeaders(stored, totalSize) })
  } catch (error) {
    console.error("GET key handover PDF error:", error)
    const integrityIssue = error?.code === "KEY_HANDOVER_PDF_INTEGRITY"
    return errorResponse(
      integrityIssue
        ? "Integritas file PDF Serah Terima Kunci gagal diverifikasi. Hubungi administrator."
        : "Gagal membaca file PDF Serah Terima Kunci.",
      500
    )
  }
}
