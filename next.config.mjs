// @ts-check

const configuredDevOrigins = String(
  process.env.NEXT_ALLOWED_DEV_ORIGINS || ""
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)

const allowedDevOrigins = [
  ...new Set(["192.168.20.99", ...configuredDevOrigins]),
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins,
}

export default nextConfig
