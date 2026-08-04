import { NextResponse } from "next/server"
import { connectDB, sql } from "@/lib/mssql"
import {
  getUserFromSessionToken,
  serializeAuthenticatedUser,
  SESSION_COOKIE_NAME,
} from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request) {
  try {
    const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value
    const user = await getUserFromSessionToken(sessionToken)

    if (!user) {
      return NextResponse.json(
        { success: false, message: "Sesi tidak ditemukan atau sudah berakhir." },
        { status: 401 }
      )
    }

    const db = await connectDB()
    const [sidebarResult, navbarResult, permissionResult] = await Promise.all([
      db.request().input("roleId", sql.Int, user.role_id).query(`
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
        WHERE rsr.role_id = @roleId
          AND rsr.can_view = 1
          AND sr.is_active = 1
        ORDER BY sr.sort_order ASC, sr.id ASC;
      `),
      db.request().input("roleId", sql.Int, user.role_id).query(`
        SELECT
          nr.id,
          nr.label,
          nr.href,
          nr.description,
          nr.sort_order
        FROM dbo.navbar_routes nr
        WHERE nr.is_active = 1
          AND EXISTS (
            SELECT 1
            FROM dbo.sidebar_routes sr
            INNER JOIN dbo.role_sidebar_routes rsr
              ON rsr.sidebar_route_id = sr.id
            WHERE sr.href = nr.href
              AND sr.is_active = 1
              AND rsr.role_id = @roleId
              AND rsr.can_view = 1
          )
        ORDER BY nr.sort_order ASC, nr.id ASC;
      `),
      db.request().input("roleId", sql.Int, user.role_id).query(`
        SELECT
          sr.href,
          rsr.can_view,
          rsr.can_create,
          rsr.can_update,
          rsr.can_delete
        FROM dbo.role_sidebar_routes rsr
        INNER JOIN dbo.sidebar_routes sr
          ON sr.id = rsr.sidebar_route_id
        WHERE rsr.role_id = @roleId
          AND sr.is_active = 1;
      `),
    ])

    const permissions = Object.fromEntries(
      permissionResult.recordset.map((item) => [
        item.href,
        {
          canView: Boolean(item.can_view),
          canCreate: Boolean(item.can_create),
          canUpdate: Boolean(item.can_update),
          canDelete: Boolean(item.can_delete),
        },
      ])
    )

    return NextResponse.json({
      success: true,
      data: {
        user: serializeAuthenticatedUser(user),
        sidebar: sidebarResult.recordset,
        navbar: navbarResult.recordset,
        permissions,
      },
    })
  } catch (error) {
    console.error("Bootstrap error:", error)
    return NextResponse.json(
      { success: false, message: "Gagal memuat data awal aplikasi." },
      { status: 500 }
    )
  }
}
