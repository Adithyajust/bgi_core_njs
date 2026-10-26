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
import {
  getPermissionColumn,
  normalizePermissionAction,
  PERMISSION_ACTIONS,
} from "@/lib/permissions"
import { validateSameOrigin } from "@/lib/security/request-security"

export async function getCurrentUser() {
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value
  return sessionToken ? getUserFromSessionToken(sessionToken) : null
}

export async function hasMenuAccess(
  roleId,
  menuHref,
  action = PERMISSION_ACTIONS.VIEW
) {
  if (!roleId || !menuHref) return false

  const permissionAction = normalizePermissionAction(action)
  const permissionColumn = getPermissionColumn(permissionAction)
  const db = await connectDB()
  const result = await db
    .request()
    .input("roleId", sql.Int, roleId)
    .input("menuHref", sql.VarChar(200), menuHref)
    .query(`
      SELECT TOP 1
        rsr.role_id,
        rsr.sidebar_route_id
      FROM dbo.role_sidebar_routes rsr
      INNER JOIN dbo.sidebar_routes sr
        ON sr.id = rsr.sidebar_route_id
      INNER JOIN dbo.roles r
        ON r.id = rsr.role_id
      WHERE rsr.role_id = @roleId
        AND sr.href = @menuHref
        AND rsr.${permissionColumn} = 1
        AND sr.is_active = 1
        AND r.is_active = 1;
    `)

  return result.recordset.length > 0
}

export async function requireMenuAccess(menuHref) {
  const user = await getCurrentUser()
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(menuHref)}`)
  }

  if (user.must_change_password) {
    redirect("/change-password")
  }

  if (!(await hasMenuAccess(user.role_id, menuHref, PERMISSION_ACTIONS.VIEW))) {
    redirect("/forbidden")
  }

  return serializeAuthenticatedUser(user)
}

export function isSuperAdmin(user) {
  const roleCode = typeof user?.role_code === "string" ? user.role_code.trim() : ""
  return roleCode === "SUPER_ADMIN" || roleCode === "PROJECT MANAGER"
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

export async function authorizeApiRequest(
  request,
  menuHref,
  action = PERMISSION_ACTIONS.VIEW
) {
  const permissionAction = normalizePermissionAction(action)
  const originResponse =
    permissionAction === PERMISSION_ACTIONS.VIEW
      ? null
      : validateSameOrigin(request)

  if (originResponse) {
    return { authorized: false, response: originResponse }
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!sessionToken) {
    return {
      authorized: false,
      response: NextResponse.json(
        { success: false, message: "Session tidak ditemukan." },
        { status: 401 }
      ),
    }
  }

  const user = await getUserFromSessionToken(sessionToken)
  if (!user) {
    return {
      authorized: false,
      response: NextResponse.json(
        { success: false, message: "Session tidak valid atau telah berakhir." },
        { status: 401 }
      ),
    }
  }

  if (user.must_change_password) {
    return {
      authorized: false,
      user,
      response: NextResponse.json(
        {
          success: false,
          code: "PASSWORD_CHANGE_REQUIRED",
          message: "Password wajib diganti sebelum mengakses modul aplikasi.",
        },
        { status: 428 }
      ),
    }
  }

  const allowed = await hasMenuAccess(user.role_id, menuHref, permissionAction)
  if (!allowed) {
    return {
      authorized: false,
      user,
      response: NextResponse.json(
        {
          success: false,
          message: `Anda tidak memiliki permission ${permissionAction} untuk modul ini.`,
        },
        { status: 403 }
      ),
    }
  }

  return { authorized: true, user, action: permissionAction, response: null }
}
