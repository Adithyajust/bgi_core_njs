import { NextResponse } from "next/server"
import {
  getUserFromSessionToken,
  revokeUserSession,
  SESSION_COOKIE_NAME,
} from "@/lib/auth"
import { writeAuditLog } from "@/lib/security/audit-log"
import { validateSameOrigin } from "@/lib/security/request-security"

export const runtime = "nodejs"

export async function POST(request) {
  try {
    const originResponse = validateSameOrigin(request)

    if (originResponse) {
      return originResponse
    }

    const sessionToken =
      request.cookies.get(
        SESSION_COOKIE_NAME
      )?.value

    const user = sessionToken
      ? await getUserFromSessionToken(sessionToken)
      : null

    await revokeUserSession(
      sessionToken
    )

    if (sessionToken) {
      await writeAuditLog({
        request,
        userId: user?.id || null,
        action: "LOGOUT",
        module: "auth.logout",
        entityType: "user",
        entityId: user?.id || null,
        metadata: {
          username: user?.username || null,
          role_code: user?.role_code || null,
          codeuker: user?.codeuker || null,
          session_valid: Boolean(user),
          user_agent: request.headers.get("user-agent")?.slice(0, 500) || null,
        },
      })
    }

    const response =
      NextResponse.json({
        success: true,
        message: "Logout berhasil.",
      })

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: "",
      httpOnly: true,
      secure:
        process.env.NODE_ENV ===
        "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    })

    return response
  } catch (error) {
    console.error(
      "Logout error:",
      error
    )

    return NextResponse.json(
      {
        success: false,
        message:
          "Terjadi kesalahan saat logout.",
      },
      {
        status: 500,
      }
    )
  }
}