import "server-only"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { NextResponse } from "next/server"

import { connectDB, sql } from "@/lib/mssql"
import {
  getUserFromSessionToken,
  serializeAuthenticatedUser,
  SESSION_COOKIE_NAME,
} from "@/lib/auth"

/*
|--------------------------------------------------------------------------
| Mengambil user aktif dari cookie server
|--------------------------------------------------------------------------
*/

export async function getCurrentUser() {
  const cookieStore = await cookies()

  const sessionToken =
    cookieStore.get(
      SESSION_COOKIE_NAME
    )?.value

  if (!sessionToken) {
    return null
  }

  return getUserFromSessionToken(
    sessionToken
  )
}

/*
|--------------------------------------------------------------------------
| Memeriksa hak akses menu berdasarkan role
|--------------------------------------------------------------------------
*/

export async function hasMenuAccess(
  roleId,
  menuHref
) {
  if (!roleId || !menuHref) {
    return false
  }

  const db = await connectDB()

  const result = await db
    .request()
    .input(
      "roleId",
      sql.Int,
      roleId
    )
    .input(
      "menuHref",
      sql.VarChar(200),
      menuHref
    )
    .query(`
      SELECT TOP 1
        rsr.role_id,
        rsr.sidebar_route_id
      FROM dbo.role_sidebar_routes rsr
      INNER JOIN dbo.sidebar_routes sr
        ON sr.id =
          rsr.sidebar_route_id
      INNER JOIN dbo.roles r
        ON r.id =
          rsr.role_id
      WHERE
        rsr.role_id = @roleId
        AND sr.href = @menuHref
        AND rsr.can_view = 1
        AND sr.is_active = 1
        AND r.is_active = 1;
    `)

  return result.recordset.length > 0
}

/*
|--------------------------------------------------------------------------
| Proteksi halaman Server Component
|--------------------------------------------------------------------------
*/

export async function requireMenuAccess(
  menuHref
) {
  const user = await getCurrentUser()

  if (!user) {
    const loginPath =
      `/login?next=${encodeURIComponent(
        menuHref
      )}`

    redirect(loginPath)
  }

  const allowed = await hasMenuAccess(
    user.role_id,
    menuHref
  )

  if (!allowed) {
    redirect("/forbidden")
  }

  return serializeAuthenticatedUser(user)
}

/*
|--------------------------------------------------------------------------
| Scope data berdasarkan unit kerja
|--------------------------------------------------------------------------
*/

export function isSuperAdmin(user) {
  return user?.role_code === "SUPER_ADMIN"
}

export function getUserDataScope(user) {
  const superAdmin = isSuperAdmin(user)
  const codeUker =
    typeof user?.codeuker === "string"
      ? user.codeuker.trim().toUpperCase()
      : ""

  return {
    isSuperAdmin: superAdmin,
    codeUker: superAdmin ? null : codeUker || null,
  }
}

/*
|--------------------------------------------------------------------------
| Proteksi Route Handler atau API
|--------------------------------------------------------------------------
*/

export async function authorizeApiRequest(
  request,
  menuHref
) {
  const sessionToken =
    request.cookies.get(
      SESSION_COOKIE_NAME
    )?.value

  if (!sessionToken) {
    return {
      authorized: false,

      response: NextResponse.json(
        {
          success: false,
          message:
            "Session tidak ditemukan.",
        },
        {
          status: 401,
        }
      ),
    }
  }

  const user =
    await getUserFromSessionToken(
      sessionToken
    )

  if (!user) {
    return {
      authorized: false,

      response: NextResponse.json(
        {
          success: false,
          message:
            "Session tidak valid atau telah berakhir.",
        },
        {
          status: 401,
        }
      ),
    }
  }

  const allowed = await hasMenuAccess(
    user.role_id,
    menuHref
  )

  if (!allowed) {
    return {
      authorized: false,

      response: NextResponse.json(
        {
          success: false,
          message:
            "Anda tidak memiliki hak akses.",
        },
        {
          status: 403,
        }
      ),
    }
  }

  return {
    authorized: true,
    user,
    response: null,
  }
}