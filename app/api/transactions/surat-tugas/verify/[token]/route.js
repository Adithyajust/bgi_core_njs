import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { connectDB } from "@/lib/mssql"
import { getAssignmentLetterByToken } from "@/modules/replenish/assignment-letter"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request, { params }) {
  const authorization = await authorizeApiRequest(request, "/transactions", "view")
  if (!authorization.authorized) return authorization.response

  try {
    const { token } = await params
    const scope = getUserDataScope(authorization.user)
    const db = await connectDB()
    const letter = await getAssignmentLetterByToken(
      db,
      token,
      scope.isSuperAdmin ? null : scope.codeUker
    )
    const valid = Boolean(
      letter &&
      letter.status === "DISETUJUI" &&
      letter.payload_valid &&
      letter.approval_valid
    )

    return NextResponse.json({
      success: true,
      valid,
      data: letter,
    })
  } catch (error) {
    console.error("Assignment letter verification failed:", error)
    return NextResponse.json(
      {
        success: false,
        valid: false,
        message: "Verifikasi Surat Tugas gagal diproses.",
      },
      { status: 500 }
    )
  }
}
