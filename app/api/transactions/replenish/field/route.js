import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { connectDB } from "@/lib/mssql"
import {
  isReplenishFieldCustody,
  isReplenishFieldDriver,
  isReplenishFieldSupervisor,
} from "@/modules/replenish/authorization"
import { REPLENISH_FIELD_MENU_HREF } from "@/modules/replenish/constants"
import { listReplenishFieldJobs } from "@/modules/replenish/field-database"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request) {
  const authorization = await authorizeApiRequest(request, REPLENISH_FIELD_MENU_HREF, "view")
  if (!authorization.authorized) return authorization.response

  const custody = isReplenishFieldCustody(authorization.user)
  const driver = isReplenishFieldDriver(authorization.user)
  const supervisor = isReplenishFieldSupervisor(authorization.user)
  if (!custody && !driver && !supervisor) {
    return NextResponse.json(
      { success: false, message: "Akun belum terhubung dengan fungsi Custody, Driver, atau supervisor Replenish." },
      { status: 403 }
    )
  }

  try {
    const db = await connectDB()
    const scope = getUserDataScope(authorization.user)
    const jobs = await listReplenishFieldJobs(
      db,
      authorization.user,
      scope.isSuperAdmin ? null : scope.codeUker,
      { supervisor }
    )

    return NextResponse.json({
      success: true,
      data: {
        jobs,
        capabilities: {
          custody,
          driver,
          supervisor,
          can_operate: custody,
          can_confirm_departure: driver,
          can_review_exception: supervisor,
        },
      },
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Gagal memuat job Replenish Lapangan.", error)
    return NextResponse.json(
      { success: false, message: "Gagal memuat Job Saya Hari Ini." },
      { status: 500 }
    )
  }
}
