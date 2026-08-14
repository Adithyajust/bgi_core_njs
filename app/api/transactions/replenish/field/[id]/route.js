import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { connectDB } from "@/lib/mssql"
import {
  isReplenishFieldCustody,
  isReplenishFieldDriver,
  isReplenishFieldSupervisor,
} from "@/modules/replenish/authorization"
import { REPLENISH_FIELD_MENU_HREF } from "@/modules/replenish/constants"
import { getFieldAssignment, getReplenishFieldSnapshot } from "@/modules/replenish/field-database"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function normalizeId(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export async function GET(request, context) {
  const authorization = await authorizeApiRequest(request, REPLENISH_FIELD_MENU_HREF, "view")
  if (!authorization.authorized) return authorization.response
  const { id } = await context.params
  const workOrderId = normalizeId(id)
  if (!workOrderId) {
    return NextResponse.json({ success: false, message: "ID work order tidak valid." }, { status: 400 })
  }

  try {
    const db = await connectDB()
    const scope = getUserDataScope(authorization.user)
    const supervisor = isReplenishFieldSupervisor(authorization.user)
    const assignment = supervisor
      ? null
      : await getFieldAssignment(db, workOrderId, authorization.user.pegawai_id)
    if (!supervisor && !assignment) {
      return NextResponse.json(
        { success: false, message: "Work Order ini tidak ditugaskan kepada Anda." },
        { status: 403 }
      )
    }

    const snapshot = await getReplenishFieldSnapshot(
      db,
      workOrderId,
      scope.isSuperAdmin ? null : scope.codeUker
    )
    if (!snapshot) {
      return NextResponse.json({ success: false, message: "Work Order tidak ditemukan." }, { status: 404 })
    }

    const assignedRole = assignment?.member_role || null
    return NextResponse.json({
      success: true,
      data: {
        ...snapshot,
        capabilities: {
          assigned_role: assignedRole,
          can_operate: assignedRole === "CUSTODY" && isReplenishFieldCustody(authorization.user),
          can_confirm_departure: assignedRole === "PENGEMUDI" && isReplenishFieldDriver(authorization.user),
          can_review_exception: supervisor,
        },
      },
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Gagal memuat detail Replenish Lapangan.", error)
    return NextResponse.json(
      { success: false, message: "Gagal memuat detail Replenish Lapangan." },
      { status: 500 }
    )
  }
}
