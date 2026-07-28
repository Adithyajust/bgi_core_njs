import { NextResponse } from "next/server"
import {
  getUserFromSessionToken,
  serializeAuthenticatedUser,
  SESSION_COOKIE_NAME,
} from "@/lib/auth"

export const runtime = "nodejs"

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
            "Sesi tidak ditemukan atau sudah berakhir.",
        },
        {
          status: 401,
        }
      )
    }

    return NextResponse.json({
      success: true,
      data: serializeAuthenticatedUser(user),
    })
  } catch (error) {
    console.error(
      "Auth me error:",
      error
    )

    return NextResponse.json(
      {
        success: false,
        message:
          "Gagal membaca sesi pengguna.",
      },
      {
        status: 500,
      }
    )
  }
}