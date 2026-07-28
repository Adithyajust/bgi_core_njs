import { NextResponse } from "next/server"

const SESSION_COOKIE_NAME = "bgi_session"

const PUBLIC_ROUTES = [
  "/login",
  "/api/auth/login",
]

function isPublicRoute(pathname) {
  return PUBLIC_ROUTES.some((route) => {
    return (
      pathname === route ||
      pathname.startsWith(`${route}/`)
    )
  })
}

export function proxy(request) {
  const pathname =
    request.nextUrl.pathname

  const sessionToken =
    request.cookies.get(
      SESSION_COOKIE_NAME
    )?.value

  /*
   * Login harus tetap dapat diakses.
   * Halaman login akan memeriksa validitas
   * session melalui /api/auth/me.
   */
  if (isPublicRoute(pathname)) {
    return NextResponse.next()
  }

  /*
   * Request API tanpa cookie session.
   */
  if (
    pathname.startsWith("/api/") &&
    !sessionToken
  ) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Session tidak ditemukan.",
      },
      {
        status: 401,
      }
    )
  }

  /*
   * Halaman aplikasi tanpa cookie session.
   */
  if (!sessionToken) {
    const loginUrl = new URL(
      "/login",
      request.url
    )

    const destination =
      `${pathname}${request.nextUrl.search}`

    loginUrl.searchParams.set(
      "next",
      destination
    )

    return NextResponse.redirect(
      loginUrl
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}