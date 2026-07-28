import { NextResponse } from "next/server"
import { connectDB, sql } from "@/lib/mssql"
import {
  getUserFromSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request) {
  try {
    const sessionToken =
      request.cookies.get(
        SESSION_COOKIE_NAME
      )?.value

    const user =
      await getUserFromSessionToken(
        sessionToken
      )

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Session tidak ditemukan atau telah berakhir.",
        },
        {
          status: 401,
        }
      )
    }

    const db = await connectDB()

    const result = await db
      .request()
      .input(
        "roleId",
        sql.Int,
        user.role_id
      )
      .query(`
        SELECT
          sr.id,
          sr.label,
          sr.href,
          sr.icon,
          sr.badge,
          sr.sort_order
        FROM dbo.role_sidebar_routes rsr
        INNER JOIN dbo.sidebar_routes sr
          ON sr.id = rsr.sidebar_route_id
        WHERE
          rsr.role_id = @roleId
          AND rsr.can_view = 1
          AND sr.is_active = 1
        ORDER BY
          sr.sort_order ASC,
          sr.id ASC;
      `)

    return NextResponse.json({
      success: true,
      data: result.recordset,
      user: {
        id: user.id,
        roleId: user.role_id,
        roleCode: user.role_code,
        roleName: user.role_name,
      },
    })
  } catch (error) {
    console.error(
      "Navigation error:",
      error
    )

    return NextResponse.json(
      {
        success: false,
        message:
          "Gagal mengambil data navigasi.",
      },
      {
        status: 500,
      }
    )
  }
}