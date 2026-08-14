import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { connectDB } from "@/lib/mssql"
import { isCpcPackingApprover } from "@/modules/cpc/authorization"
import { CPC_MENU_HREF, CPC_QUEUE_STATUSES } from "@/modules/cpc/constants"
import { getActiveCpcPackingWorkOrderForUser, listCpcCassetteRequests, resolveCpcScope } from "@/modules/cpc/database"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 50
const STATUS_SET = new Set(CPC_QUEUE_STATUSES)

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizePositiveInteger(value, fallback, maximum = null) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback
  return maximum === null ? parsed : Math.min(parsed, maximum)
}

function normalizeCursor(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeDate(value) {
  const normalized = normalizeText(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null
}

function escapeLike(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")
}

function errorResponse(message, status = 400) {
  return NextResponse.json({ success: false, message }, { status })
}

export async function GET(request) {
  const authorization = await authorizeApiRequest(request, CPC_MENU_HREF, "view")
  if (!authorization.authorized) return authorization.response

  try {
    const url = new URL(request.url)
    const pageSize = normalizePositiveInteger(url.searchParams.get("page_size"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
    const afterId = normalizeCursor(url.searchParams.get("after_id"))
    const search = normalizeText(url.searchParams.get("search")).slice(0, 100)
    const rawStatus = normalizeText(url.searchParams.get("status")).toUpperCase()
    const status = STATUS_SET.has(rawStatus) ? rawStatus : null
    const dateFrom = normalizeDate(url.searchParams.get("date_from"))
    const dateTo = normalizeDate(url.searchParams.get("date_to"))

    const db = await connectDB()
    const scope = getUserDataScope(authorization.user)
    const resolvedScope = await resolveCpcScope(db, scope)
    if (resolvedScope.error) return errorResponse(resolvedScope.error, 403)

    const result = await listCpcCassetteRequests(db, {
      scopeUkerId: resolvedScope.ukerId,
      afterId,
      pageSize,
      status,
      searchPattern: search ? `${escapeLike(search)}%` : "%",
      dateFrom,
      dateTo,
    })
    const activePackingJob = isCpcPackingApprover(authorization.user)
      ? null
      : await getActiveCpcPackingWorkOrderForUser(db, authorization.user.id)

    return NextResponse.json({
      success: true,
      data: {
        requests: result.items,
        pagination: result.pagination,
        summary: result.summary,
        scope: {
          is_super_admin: scope.isSuperAdmin,
          uker_id: resolvedScope.ukerId,
          codeuker: resolvedScope.codeUker,
          nama_uker: resolvedScope.namaUker,
        },
        active_packing_job: activePackingJob ? {
          work_order_id: activePackingJob.workOrderId,
          work_order_no: activePackingJob.workOrderNo,
          packing_claimed_at: activePackingJob.packingClaimedAt,
        } : null,
      },
    })
  } catch (error) {
    console.error("CPC request list error:", error)
    return errorResponse("Gagal mengambil permintaan kaset dan lembar uang.", 500)
  }
}
