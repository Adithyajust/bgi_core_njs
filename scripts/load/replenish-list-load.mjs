const baseUrl = String(process.env.LOAD_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "")
const sessionCookie = String(process.env.LOAD_SESSION_COOKIE || "").trim()
const endpoint = String(process.env.LOAD_ENDPOINT || "/api/transactions/replenish?page_size=50")
const concurrency = Math.min(200, Math.max(1, Number(process.env.LOAD_CONCURRENCY || 20)))
const durationSeconds = Math.min(600, Math.max(5, Number(process.env.LOAD_DURATION_SECONDS || 30)))
const requestTimeoutMs = Math.min(60000, Math.max(1000, Number(process.env.LOAD_REQUEST_TIMEOUT_MS || 10000)))
const maximumP95Ms = Math.max(1, Number(process.env.LOAD_MAX_P95_MS || 1000))
const maximumErrorRate = Math.min(1, Math.max(0, Number(process.env.LOAD_MAX_ERROR_RATE || 0.01)))

if (!sessionCookie) {
  console.error("LOAD_SESSION_COOKIE wajib diisi dengan nilai cookie bgi_session dari akun uji non-production.")
  process.exit(2)
}

const deadline = Date.now() + durationSeconds * 1000
const latencies = []
let requests = 0
let failures = 0
let bytes = 0
const statuses = new Map()

function percentile(values, percentileValue) {
  if (!values.length) return 0
  const index = Math.min(values.length - 1, Math.ceil((percentileValue / 100) * values.length) - 1)
  return values[index]
}

async function worker() {
  while (Date.now() < deadline) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
    const started = performance.now()
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        headers: {
          Cookie: `bgi_session=${sessionCookie}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
      })
      const body = await response.arrayBuffer()
      const elapsed = performance.now() - started
      latencies.push(elapsed)
      requests += 1
      bytes += body.byteLength
      statuses.set(response.status, (statuses.get(response.status) || 0) + 1)
      if (!response.ok) failures += 1
    } catch {
      latencies.push(performance.now() - started)
      requests += 1
      failures += 1
      statuses.set("network_error", (statuses.get("network_error") || 0) + 1)
    } finally {
      clearTimeout(timeout)
    }
  }
}

const startedAt = Date.now()
await Promise.all(Array.from({ length: concurrency }, () => worker()))
const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000)
latencies.sort((a, b) => a - b)
const errorRate = requests ? failures / requests : 1
const report = {
  endpoint: `${baseUrl}${endpoint}`,
  concurrency,
  duration_seconds: Number(elapsedSeconds.toFixed(2)),
  requests,
  requests_per_second: Number((requests / elapsedSeconds).toFixed(2)),
  error_rate: Number(errorRate.toFixed(4)),
  response_megabytes: Number((bytes / 1024 / 1024).toFixed(2)),
  latency_ms: {
    p50: Number(percentile(latencies, 50).toFixed(2)),
    p95: Number(percentile(latencies, 95).toFixed(2)),
    p99: Number(percentile(latencies, 99).toFixed(2)),
    max: Number((latencies.at(-1) || 0).toFixed(2)),
  },
  statuses: Object.fromEntries(statuses),
  thresholds: { maximum_p95_ms: maximumP95Ms, maximum_error_rate: maximumErrorRate },
}
console.log(JSON.stringify(report, null, 2))
if (report.latency_ms.p95 > maximumP95Ms || errorRate > maximumErrorRate) process.exit(1)
