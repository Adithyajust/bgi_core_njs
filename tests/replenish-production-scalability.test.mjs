import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

test("replenish detail writes are batched instead of N plus one inserts", async () => {
  const database = await read("modules/replenish/database.js")
  assert.match(database, /OPENJSON\(@pointsJson\)/i)
  assert.match(database, /INSERT INTO dbo\.replenish_work_order_points[\s\S]*SELECT/i)
  assert.doesNotMatch(database, /for \(const point of data\.points\)/)
})

test("replenish scheduling uses deterministic transaction-owned application locks", async () => {
  const database = await read("modules/replenish/database.js")
  assert.match(database, /sys\.sp_getapplock/i)
  assert.match(database, /@LockOwner = 'Transaction'/i)
  assert.match(database, /SELECT resource_name FROM @resources ORDER BY resource_name/i)
  assert.match(database, /replenish:[^\n]*employee:/i)
})

test("replenish detail and list summaries avoid connection fan-out", async () => {
  const database = await read("modules/replenish/database.js")
  const route = await read("app/api/transactions/replenish/route.js")
  const detailSection = database.slice(database.indexOf("export async function getReplenishWorkOrderDetail"))
  assert.match(detailSection, /result\.recordsets/)
  assert.doesNotMatch(detailSection, /Promise\.all/)
  assert.match(route, /listAndSummaryResult\.recordsets/)
})

test("replenish creation is idempotent and deadlock retry is bounded", async () => {
  const route = await read("app/api/transactions/replenish/route.js")
  const transaction = await read("lib/database/transaction.js")
  const migration = await read("scripts/migrations/031-replenish-production-scalability.sql")
  assert.match(route, /Idempotency-Key/)
  assert.match(route, /client_request_id/)
  assert.match(transaction, /maxRetries = 2/)
  assert.match(transaction, /1205/)
  assert.match(migration, /UNIQUE[\s\S]*created_by, client_request_id/i)
})

test("replenish list summary is pre-aggregated and indexed", async () => {
  const route = await read("app/api/transactions/replenish/route.js")
  const migration = await read("scripts/migrations/031-replenish-production-scalability.sql")
  assert.match(route, /dbo\.replenish_work_order_summary/)
  assert.match(migration, /CREATE TABLE dbo\.replenish_work_order_summary/i)
  assert.match(migration, /CREATE OR ALTER TRIGGER dbo\.TR_replenish_work_orders_summary/i)
  assert.match(migration, /IX_replenish_wo_scope_cursor/i)
})

test("security perimeter enforces trusted origin, bounded bodies, CSP, and safe SQL TLS", async () => {
  const security = await read("lib/security/request-security.js")
  const proxy = await read("proxy.js")
  const mssql = await read("lib/mssql.js")
  const login = await read("app/api/auth/login/route.js")
  const auth = await read("lib/auth.js")
  const readiness = await read("app/api/health/ready/route.js")
  assert.match(security, /APP_ORIGIN/)
  assert.match(security, /SECURITY_TRUST_PROXY_HEADERS/)
  assert.match(proxy, /Content-Security-Policy/)
  assert.match(proxy, /Strict-Transport-Security/)
  assert.match(proxy, /SECURITY_MAX_API_BODY_BYTES/)
  assert.match(mssql, /MSSQL_TRUST_SERVER_CERTIFICATE/)
  assert.match(mssql, /production[\s\S]*trustServerCertificate/i)
  assert.match(login, /DUMMY_PASSWORD_HASH/)
  assert.match(auth, /SESSION_MAX_ACTIVE_PER_USER/)
  assert.match(auth, /sys\.sp_getapplock/i)
  assert.doesNotMatch(readiness, /getPoolHealth|pool:/)
})

test("business audit is inserted with the same SQL transaction", async () => {
  const createRoute = await read("app/api/transactions/replenish/route.js")
  const detailRoute = await read("app/api/transactions/replenish/[id]/route.js")
  const audit = await read("lib/security/audit-log.js")
  assert.match(audit, /export async function insertAuditLog\(executor/)
  assert.match(createRoute, /insertAuditLog\(transaction/)
  assert.match(detailRoute, /insertAuditLog\(transaction/)
})
