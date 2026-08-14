import { NextResponse } from "next/server"

const SESSION_COOKIE_NAME = "bgi_session"
const PUBLIC_ROUTES = [
  "/login",
  "/api/auth/login",
  "/api/health/live",
  "/api/health/ready",
  "/manifest.webmanifest",
  "/sw.js",
  "/field-offline.html",
]

function isPublicRoute(pathname) {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  )
}

function isReplenishPdfRoute(pathname, searchParams) {
  if (/^\/api\/transactions\/replenish\/\d+\/(?:surat-tugas|key-handover)\/pdf\/?$/.test(pathname)) {
    return true
  }

  return (
    /^\/api\/transactions\/replenish\/\d+\/?$/.test(pathname) &&
    ["surat-tugas-pdf", "key-handover-pdf"].includes(searchParams?.get("resource"))
  )
}

function createContentSecurityPolicy(nonce, { allowSameOriginFrame = false } = {}) {
  const developmentScriptPolicy = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${developmentScriptPolicy}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self'",
    allowSameOriginFrame ? "object-src 'self'" : "object-src 'none'",
    "frame-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    allowSameOriginFrame ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ]
  if (process.env.NODE_ENV === "production") directives.push("upgrade-insecure-requests")
  return directives.join("; ")
}

function applySecurityHeaders(response, security) {
  const {
    contentSecurityPolicy,
    requestId,
    allowSameOriginFrame = false,
    allowFieldDeviceCapabilities = false,
  } = security
  response.headers.set("Content-Security-Policy", contentSecurityPolicy)
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("X-Frame-Options", allowSameOriginFrame ? "SAMEORIGIN" : "DENY")
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  response.headers.set(
    "Permissions-Policy",
    allowFieldDeviceCapabilities
      ? "camera=(self), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()"
      : "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
  )
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin")
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin")
  response.headers.set("X-Permitted-Cross-Domain-Policies", "none")
  response.headers.set("X-Request-Id", requestId)
  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    )
  }
  return response
}

function securedJson(body, init, security) {
  return applySecurityHeaders(NextResponse.json(body, init), security)
}
function securedRedirect(url, security) {
  return applySecurityHeaders(NextResponse.redirect(url), security)
}

export function proxy(request) {
  const pathname = request.nextUrl.pathname
  const method = String(request.method || "GET").toUpperCase()
  const nonce = crypto.randomUUID().replaceAll("-", "")
  const upstreamRequestId = process.env.SECURITY_TRUST_PROXY_HEADERS === "true"
    ? request.headers.get("x-request-id")
    : null
  const requestId = String(upstreamRequestId || crypto.randomUUID()).slice(0, 64)
  const allowSameOriginFrame = isReplenishPdfRoute(pathname, request.nextUrl.searchParams)
  const allowFieldDeviceCapabilities = pathname === "/field_replenish"
    || pathname.startsWith("/field_replenish/")
    || pathname.startsWith("/api/transactions/replenish/field/")
  const contentSecurityPolicy = createContentSecurityPolicy(nonce, { allowSameOriginFrame })
  const security = {
    contentSecurityPolicy,
    requestId,
    allowSameOriginFrame,
    allowFieldDeviceCapabilities,
  }

  if (method === "TRACE") {
    return securedJson(
      { success: false, message: "Metode HTTP tidak diizinkan." },
      { status: 405, headers: { Allow: "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS" } },
      security
    )
  }

  if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    const maximumBytes = Math.max(1024, Number(process.env.SECURITY_MAX_API_BODY_BYTES || 10 * 1024 * 1024))
    const contentLength = Number(request.headers.get("content-length"))
    if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
      return securedJson(
        { success: false, message: "Ukuran permintaan melebihi batas server." },
        { status: 413 },
        security
      )
    }
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!isPublicRoute(pathname) && pathname.startsWith("/api/") && !sessionToken) {
    return securedJson(
      { success: false, message: "Session tidak ditemukan." },
      { status: 401 },
      security
    )
  }

  if (!isPublicRoute(pathname) && !sessionToken) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`)
    return securedRedirect(loginUrl, security)
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("x-request-id", requestId)
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  return applySecurityHeaders(response, security)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
