import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { connectDB } from "@/lib/mssql"
import { isReplenishTeamApprover } from "@/modules/replenish/authorization"
import { REPLENISH_KPI_MENU_HREF } from "@/modules/replenish/constants"
import { listReplenishAdminKpis, resolveReplenishUker } from "@/modules/replenish/database"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50
const MAX_DATE_RANGE_DAYS = 366

function errorResponse(message, status = 400) {
  return NextResponse.json({ success: false, message }, { status })
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizePositiveInteger(value, fallback, maximum = null) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback
  return maximum === null ? parsed : Math.min(parsed, maximum)
}

function normalizeOptionalPositiveInteger(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeDate(value) {
  const normalized = normalizeText(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null
  const parsed = new Date(`${normalized}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized
    ? null
    : normalized
}

function normalizeApprovedCursor(value) {
  const normalized = normalizeText(value)
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized) ? normalized : null
}

function dateInJakarta(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function defaultDateRange() {
  const today = dateInJakarta()
  return { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today }
}

function escapeLike(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")
}

export async function GET(request) {
  const authorization = await authorizeApiRequest(request, REPLENISH_KPI_MENU_HREF, "view")
  if (!authorization.authorized) return authorization.response

  if (!isReplenishTeamApprover(authorization.user)) {
    return errorResponse(
      "KPI Admin Replenish hanya dapat dilihat oleh Manager Operasional atau Asisten Manager CRO.",
      403
    )
  }

  try {
    const url = new URL(request.url)
    const defaults = defaultDateRange()
    const dateFrom = normalizeDate(url.searchParams.get("date_from") || defaults.dateFrom)
    const dateTo = normalizeDate(url.searchParams.get("date_to") || defaults.dateTo)
    if (!dateFrom || !dateTo) return errorResponse("Rentang tanggal KPI tidak valid.")

    const fromTime = Date.parse(`${dateFrom}T00:00:00.000Z`)
    const toTime = Date.parse(`${dateTo}T00:00:00.000Z`)
    const rangeDays = Math.floor((toTime - fromTime) / 86_400_000) + 1
    if (rangeDays <= 0) return errorResponse("Tanggal awal KPI tidak boleh melewati tanggal akhir.")
    if (rangeDays > MAX_DATE_RANGE_DAYS) {
      return errorResponse(`Rentang KPI maksimal ${MAX_DATE_RANGE_DAYS} hari.`)
    }

    const pageSize = normalizePositiveInteger(
      url.searchParams.get("page_size"),
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE
    )
    const search = normalizeText(url.searchParams.get("search")).slice(0, 100)
    const adminUserId = normalizeOptionalPositiveInteger(url.searchParams.get("admin_user_id"))
    const afterApprovedAt = normalizeApprovedCursor(url.searchParams.get("after_approved_at"))
    const afterId = normalizeOptionalPositiveInteger(url.searchParams.get("after_id"))
    if (url.searchParams.has("after_approved_at") && (!afterApprovedAt || !afterId)) {
      return errorResponse("Cursor KPI tidak valid.")
    }

    const db = await connectDB()
    const scope = getUserDataScope(authorization.user)
    let resolvedUker = null
    if (!scope.isSuperAdmin) {
      const resolved = await resolveReplenishUker(db, scope, null)
      if (resolved.error) return errorResponse(resolved.error, 403)
      resolvedUker = resolved.uker
    }

    const result = await listReplenishAdminKpis(db, {
      scopeUkerId: resolvedUker?.id || null,
      dateFrom,
      dateTo,
      searchPattern: search ? `%${escapeLike(search)}%` : "%",
      adminUserId,
      afterApprovedAt,
      afterId,
      pageSize,
    })

    return NextResponse.json({
      success: true,
      data: {
        ...result,
        filters: { date_from: dateFrom, date_to: dateTo },
        scope: {
          is_super_admin: scope.isSuperAdmin,
          uker_id: resolvedUker?.id || null,
          codeuker: resolvedUker?.codeuker || null,
          nama_uker: resolvedUker?.nama_uker || null,
        },
        calculation: {
          admin: "Draft tim pertama tersimpan sampai diajukan, ditambah waktu perbaikan setelah penolakan sampai pengajuan ulang.",
          approval: "Setiap waktu tunggu sejak pengajuan sampai disetujui atau ditolak oleh approver Replenish.",
          total: "Draft tim pertama tersimpan sampai approval final Manager Operasional atau Asisten Manager CRO.",
        },
      },
    })
  } catch (error) {
    console.error("Replenish Admin KPI error:", error)
    return errorResponse("Gagal mengambil KPI Admin Replenish.", 500)
  }
}
