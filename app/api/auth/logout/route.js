import { NextResponse } from "next/server"
import {
  revokeUserSession,
  SESSION_COOKIE_NAME,
} from "@/lib/auth"

export const runtime = "nodejs"

export async function POST(request) {
  try {
    const sessionToken =
      request.cookies.get(
        SESSION_COOKIE_NAME
      )?.value

    await revokeUserSession(
      sessionToken
    )

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