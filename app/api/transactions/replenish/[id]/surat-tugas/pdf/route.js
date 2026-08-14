import path from "node:path"

import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { connectDB, sql } from "@/lib/mssql"
import { validateSameOrigin } from "@/lib/security/request-security"
import { insertAuditLog } from "@/lib/security/audit-log"
import {
  getAssignmentLetterByWorkOrder,
} from "@/modules/replenish/assignment-letter"
import { generateAssignmentLetterPdf, hashPdfBuffer } from "@/modules/replenish/assignment-letter-pdf"
import {
  canAccessStoredAssignmentLetterPdf,
  readStoredAssignmentLetterPdf,
  writeStoredAssignmentLetterPdf,
} from "@/modules/replenish/assignment-letter-pdf-storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function errorResponse(message, status = 400) {
  return NextResponse.json({ success: false, message }, { status })
}

function normalizeId(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function pdfUrl(request, workOrderId) {
  const currentUrl = new URL(request.url)
  if (currentUrl.searchParams.get("resource") === "surat-tugas-pdf") {
    const fallbackUrl = new URL(`/api/transactions/replenish/${workOrderId}`, request.url)
    fallbackUrl.searchParams.set("resource", "surat-tugas-pdf")
    return fallbackUrl.toString()
  }
  return new URL(`/api/transactions/replenish/${workOrderId}/surat-tugas/pdf`, request.url).toString()
}

function verificationUrl(request, token) {
  return token
    ? new URL(`/transactions/replenish/surat-tugas/verify/${token}`, request.url).toString()
    : null
}

function isPrintableLetter(letter) {
  return Boolean(
    letter?.payload_valid &&
    letter?.status === "DISETUJUI" &&
    letter?.approval_valid
  )
}

function letterWorkflowMetadata(letter, canPrepare) {
  return {
    letter_status: letter?.status || null,
    letter_ready: Boolean(
      letter?.payload_valid &&
      letter?.status === "MENUNGGU_PERSETUJUAN"
    ),
    approved: Boolean(
      letter?.payload_valid &&
      letter?.status === "DISETUJUI" &&
      letter?.approval_valid
    ),
    can_prepare: Boolean(canPrepare),
    can_print: Boolean(canPrepare && isPrintableLetter(letter)),
  }
}

async function getPrintConfirmation(executor, letter) {
  if (!letter?.id || !letter?.document_hash) return null

  const result = await new sql.Request(executor)
    .input("entityId", sql.VarChar(100), String(letter.id))
    .input("documentHash", sql.Char(64), letter.document_hash)
    .query(`
      SELECT TOP (1)
        audit.user_id,
        actor.full_name AS user_name,
        CONVERT(CHAR(19), audit.created_at, 126) AS printed_at
      FROM dbo.audit_logs audit
      LEFT JOIN dbo.users actor ON actor.id = audit.user_id
      WHERE audit.action = 'PRINT_CONFIRMED'
        AND audit.module = 'transactions.replenish.surat-tugas'
        AND audit.entity_type = 'replenish_assignment_letter'
        AND audit.entity_id = @entityId
        AND JSON_VALUE(audit.metadata_json, '$.document_hash') = @documentHash
      ORDER BY audit.id DESC;
    `)

  return result.recordset[0] || null
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

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return { invalid: true }
  }

  return { start, end: Math.min(end, size - 1) }
}

function pdfResponseHeaders(stored, contentLength) {
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

function responseMetadata(request, metadata, printConfirmation = null, { canPrepare = false, letter = null } = {}) {
  return {
    exists: true,
    work_order_id: metadata.work_order_id,
    letter_no: metadata.letter_no,
    document_hash: metadata.document_hash,
    generated_at: metadata.generated_at,
    pdf_hash: metadata.pdf_hash,
    size: metadata.size,
    file_name: metadata.file_name,
    pdf_url: pdfUrl(request, metadata.work_order_id),
    printed: Boolean(printConfirmation?.printed_at),
    printed_at: printConfirmation?.printed_at || null,
    printed_by: printConfirmation?.user_id ? Number(printConfirmation.user_id) : null,
    printed_by_name: printConfirmation?.user_name || null,
    ...letterWorkflowMetadata(letter, canPrepare),
  }
}

async function authorize(request) {
  return authorizeApiRequest(request, "/transactions", "view")
}

async function authorizePreparation(request) {
  let lastAuthorization = null
  for (const action of ["update", "create"]) {
    const authorization = await authorizeApiRequest(request, "/transactions", action)
    if (authorization.authorized) return authorization
    lastAuthorization = authorization
    if (authorization.response?.status !== 403) return authorization
  }
  return lastAuthorization
}

export async function GET(request, context) {
  const authorization = await authorize(request)
  if (!authorization.authorized) return authorization.response

  const { id } = await context.params
  const workOrderId = normalizeId(id)
  if (!workOrderId) return errorResponse("ID work order tidak valid.")

  try {
    const scope = getUserDataScope(authorization.user)
    const scopeCodeUker = scope.isSuperAdmin ? null : scope.codeUker
    const statusOnly = new URL(request.url).searchParams.get("status") === "1"
    const db = await connectDB()
    const letter = await getAssignmentLetterByWorkOrder(db, workOrderId, scopeCodeUker)
    const canPrepare = Boolean(
      scope.isSuperAdmin ||
      (letter && Number(letter.work_order_created_by) === Number(authorization.user.id))
    )
    const stored = await readStoredAssignmentLetterPdf(workOrderId, { includeBuffer: !statusOnly })

    if (
      !letter ||
      !stored ||
      stored.document_hash !== String(letter.document_hash || "").toLowerCase()
    ) {
      if (statusOnly) {
        return NextResponse.json({
          success: true,
          data: {
            exists: false,
            work_order_id: workOrderId,
            printed: false,
            stale: Boolean(stored),
            ...letterWorkflowMetadata(letter, canPrepare),
          },
        })
      }
      if (!isPrintableLetter(letter)) {
        return errorResponse(
          "Surat Tugas baru dapat dicetak setelah Work Order disetujui Manager Operasional / Asisten Manager CRO.",
          409
        )
      }
      return errorResponse(
        stored ? "File PDF Surat Tugas sudah tidak sesuai dengan Work Order terbaru." : "File PDF Surat Tugas belum terbentuk.",
        stored ? 409 : 404
      )
    }

    if (!canAccessStoredAssignmentLetterPdf(stored, scope)) {
      return errorResponse("File PDF Surat Tugas tidak ditemukan.", 404)
    }

    if (!isPrintableLetter(letter)) {
      if (statusOnly) {
        return NextResponse.json({
          success: true,
          data: {
            exists: false,
            work_order_id: workOrderId,
            printed: false,
            stale: false,
            ...letterWorkflowMetadata(letter, canPrepare),
          },
        })
      }
      return errorResponse(
        "Surat Tugas baru dapat dicetak setelah Work Order disetujui Manager Operasional / Asisten Manager CRO.",
        409
      )
    }

    const printConfirmation = await getPrintConfirmation(db, letter)
    if (statusOnly) {
      return NextResponse.json({
        success: true,
        data: responseMetadata(request, stored, printConfirmation, { canPrepare, letter }),
      })
    }

    const totalSize = stored.buffer.length
    const requestedRange = parsePdfRange(request.headers.get("range"), totalSize)

    if (requestedRange?.invalid) {
      return new Response(null, {
        status: 416,
        headers: {
          ...pdfResponseHeaders(stored, 0),
          "Content-Range": `bytes */${totalSize}`,
        },
      })
    }

    if (requestedRange) {
      const chunk = stored.buffer.subarray(requestedRange.start, requestedRange.end + 1)
      return new Response(chunk, {
        status: 206,
        headers: {
          ...pdfResponseHeaders(stored, chunk.length),
          "Content-Range": `bytes ${requestedRange.start}-${requestedRange.end}/${totalSize}`,
        },
      })
    }

    return new Response(stored.buffer, {
      status: 200,
      headers: pdfResponseHeaders(stored, totalSize),
    })
  } catch (error) {
    console.error("GET stored assignment letter PDF error:", error)
    return errorResponse("Gagal membaca file PDF Surat Tugas.", 500)
  }
}

export async function POST(request, context) {
  const originResponse = validateSameOrigin(request)
  if (originResponse) return originResponse

  const authorization = await authorizePreparation(request)
  if (!authorization.authorized) return authorization.response

  const { id } = await context.params
  const workOrderId = normalizeId(id)
  if (!workOrderId) return errorResponse("ID work order tidak valid.")

  try {
    const scope = getUserDataScope(authorization.user)
    const db = await connectDB()
    const scopeCodeUker = scope.isSuperAdmin ? null : scope.codeUker
    const letter = await getAssignmentLetterByWorkOrder(db, workOrderId, scopeCodeUker)
    if (!letter) return errorResponse("Surat Tugas belum tersedia.", 404)
    const canPrepare = scope.isSuperAdmin || Number(letter.work_order_created_by) === Number(authorization.user.id)
    if (!canPrepare) {
      return errorResponse(
        "Penyelesaian dan pencetakan Surat Tugas merupakan tugas Admin CRO pembuat Work Order.",
        403
      )
    }
    if (!isPrintableLetter(letter)) {
      return errorResponse(
        "Surat Tugas baru dapat dicetak setelah Work Order disetujui Manager Operasional / Asisten Manager CRO.",
        409
      )
    }

    const existing = await readStoredAssignmentLetterPdf(workOrderId)
    if (existing && !canAccessStoredAssignmentLetterPdf(existing, scope)) {
      return errorResponse("File PDF Surat Tugas tidak ditemukan.", 404)
    }

    if (existing?.document_hash === String(letter.document_hash).toLowerCase()) {
      const printConfirmation = await getPrintConfirmation(db, letter)
      return NextResponse.json({
        success: true,
        message: "File PDF Surat Tugas sudah tersedia.",
        data: responseMetadata(request, existing, printConfirmation, { canPrepare, letter }),
      })
    }

    const output = await generateAssignmentLetterPdf({
      letter,
      verificationUrl: letter.status === "DISETUJUI"
        ? verificationUrl(request, letter.verification_token)
        : null,
      logoPath: path.join(process.cwd(), "public", "bgi-logo-surat-tugas-pdf.jpg"),
    })
    const pdfHash = hashPdfBuffer(output)
    const generatedAt = new Date().toISOString()
    const stored = await writeStoredAssignmentLetterPdf(workOrderId, output, {
      letter_no: letter.letter_no,
      codeuker: letter.codeuker,
      document_hash: letter.document_hash,
      pdf_hash: pdfHash,
      generated_at: generatedAt,
      generated_by: authorization.user.id,
    }, { overwrite: Boolean(existing) })

    await insertAuditLog(db, {
      request,
      userId: authorization.user.id,
      action: "GENERATE_PDF",
      module: "transactions.replenish.surat-tugas",
      entityType: "replenish_assignment_letter",
      entityId: letter.id,
      metadata: {
        work_order_id: workOrderId,
        letter_no: letter.letter_no,
        document_hash: letter.document_hash,
        pdf_hash: stored.pdf_hash,
        file_name: stored.file_name,
        letter_status: letter.status,
      },
    })

    return NextResponse.json({
      success: true,
      message: existing
        ? "File PDF Surat Tugas diperbarui sesuai Work Order terbaru."
        : "File PDF Surat Tugas berhasil dibentuk dan disimpan.",
      data: responseMetadata(request, stored, null, { canPrepare, letter }),
    }, { status: existing ? 200 : 201 })
  } catch (error) {
    console.error("POST generate assignment letter PDF error:", error)
    const detail = process.env.NODE_ENV === "production" ? "" : ` Detail: ${error.message}`
    return errorResponse(`Gagal membentuk file PDF Surat Tugas.${detail}`, 500)
  }
}

export async function PATCH(request, context) {
  const originResponse = validateSameOrigin(request)
  if (originResponse) return originResponse

  const authorization = await authorizePreparation(request)
  if (!authorization.authorized) return authorization.response

  const { id } = await context.params
  const workOrderId = normalizeId(id)
  if (!workOrderId) return errorResponse("ID work order tidak valid.")

  try {
    const scope = getUserDataScope(authorization.user)
    const db = await connectDB()
    const scopeCodeUker = scope.isSuperAdmin ? null : scope.codeUker
    const letter = await getAssignmentLetterByWorkOrder(db, workOrderId, scopeCodeUker)
    const stored = await readStoredAssignmentLetterPdf(workOrderId)

    const canPrepare = Boolean(
      scope.isSuperAdmin ||
      (letter && Number(letter.work_order_created_by) === Number(authorization.user.id))
    )
    if (!canPrepare) {
      return errorResponse(
        "Konfirmasi cetak Surat Tugas hanya dapat dilakukan oleh Admin CRO pembuat Work Order.",
        403
      )
    }

    if (!letter || !stored || stored.document_hash !== String(letter.document_hash || "").toLowerCase()) {
      return errorResponse("Cetak Surat Tugas terbaru terlebih dahulu sebelum dikonfirmasi.", 409)
    }
    if (!canAccessStoredAssignmentLetterPdf(stored, scope)) {
      return errorResponse("File PDF Surat Tugas tidak ditemukan.", 404)
    }
    if (!isPrintableLetter(letter)) {
      return errorResponse(
        "Konfirmasi cetak hanya tersedia setelah Work Order disetujui Manager Operasional / Asisten Manager CRO.",
        409
      )
    }

    await insertAuditLog(db, {
      request,
      userId: authorization.user.id,
      action: "PRINT_CONFIRMED",
      module: "transactions.replenish.surat-tugas",
      entityType: "replenish_assignment_letter",
      entityId: letter.id,
      metadata: {
        work_order_id: workOrderId,
        letter_no: letter.letter_no,
        document_hash: letter.document_hash,
        pdf_hash: stored.pdf_hash,
        file_name: stored.file_name,
      },
    })

    const printConfirmation = await getPrintConfirmation(db, letter)
    return NextResponse.json({
      success: true,
      message: "Surat Tugas telah dikonfirmasi tercetak.",
      data: responseMetadata(request, stored, printConfirmation, { canPrepare, letter }),
    })
  } catch (error) {
    console.error("PATCH assignment letter print confirmation error:", error)
    const detail = process.env.NODE_ENV === "production" ? "" : ` Detail: ${error.message}`
    return errorResponse(`Gagal mengonfirmasi cetak Surat Tugas.${detail}`, 500)
  }
}
