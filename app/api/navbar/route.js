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
          nr.id,
          nr.label,
          nr.href,
          nr.description,
          nr.sort_order
        FROM dbo.navbar_routes nr
        WHERE
          nr.is_active = 1
          AND EXISTS
          (
            SELECT 1
            FROM dbo.sidebar_routes sr
            INNER JOIN dbo.role_sidebar_routes rsr
              ON rsr.sidebar_route_id = sr.id
            WHERE
              sr.href = nr.href
              AND sr.is_active = 1
              AND rsr.role_id = @roleId
              AND rsr.can_view = 1
          )
        ORDER BY
          nr.sort_order ASC,
          nr.id ASC;
      `)

    return NextResponse.json({
      success: true,
      data: result.recordset,
    })
  } catch (error) {
    console.error(
      "Navbar error:",
      error
    )

    return NextResponse.json(
      {
        success: false,
        message:
          "Gagal mengambil data navbar.",
      },
      {
        status: 500,
      }
    )
  }
}