import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { connectDB } from "@/lib/mssql"
import { CPC_MENU_HREF } from "@/modules/cpc/constants"
import { generateCpcBlotterPdf } from "@/modules/cpc/blotter-pdf"
import { getCpcCassetteRequestDetail, resolveCpcScope } from "@/modules/cpc/database"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function normalizeId(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function errorResponse(message, status = 400) {
  return NextResponse.json({ success: false, message }, { status })
}

function safeFilename(value) {
  return String(value || "blotter")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
}

export async function GET(request, context) {
  const authorization = await authorizeApiRequest(request, CPC_MENU_HREF, "view")
  if (!authorization.authorized) return authorization.response

  const { id } = await context.params
  const workOrderId = normalizeId(id)
  if (!workOrderId) return errorResponse("ID work order tidak valid.")

  try {
    const db = await connectDB()
    const scope = getUserDataScope(authorization.user)
    const resolvedScope = await resolveCpcScope(db, scope)
    if (resolvedScope.error) return errorResponse(resolvedScope.error, 403)

    const detail = await getCpcCassetteRequestDetail(db, workOrderId, resolvedScope.codeUker)
    if (!detail) return errorResponse("Permintaan CPC tidak ditemukan.", 404)
    if ((detail.status !== "KASET_SIAP" && detail.status !== "SIAP_BERANGKAT") || detail.cpc_packing?.batch?.status !== "DISETUJUI") {
      return errorResponse("Blotter hanya dapat dicetak setelah packing disetujui Asisten Manager CPC.", 409)
    }

    const pdf = generateCpcBlotterPdf(detail)
    const filename = safeFilename(`Blotter-${detail.work_order_no}.pdf`)
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    console.error("CPC blotter PDF error:", error)
    return errorResponse("Gagal membentuk Blotter CPC.", 500)
  }
}
