import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

test("Admin Replenish KPI separates preparation, approver review, and total elapsed time", async () => {
  const database = await read("modules/replenish/database.js")

  assert.match(database, /export async function listReplenishAdminKpis/)
  assert.match(database, /history\.action IN \('SUBMIT', 'APPROVE', 'REJECT'\)/)
  assert.match(database, /LEAD\(history\.action\)[\s\S]*PARTITION BY history\.work_order_id/)
  assert.match(database, /MIN\(CASE WHEN event\.action = 'SUBMIT' THEN event\.created_at END\) AS first_submitted_at/)
  assert.match(database, /event\.action = 'REJECT'[\s\S]*event\.next_action = 'SUBMIT'/)
  assert.match(database, /event\.action = 'SUBMIT'[\s\S]*event\.next_action IN \('APPROVE', 'REJECT'\)/)
  assert.match(database, /eligible\.created_at[\s\S]*metrics\.first_submitted_at[\s\S]*rework_duration_seconds/)
  assert.match(database, /DATEDIFF_BIG\(SECOND, eligible\.created_at, eligible\.approved_at\) AS total_duration_seconds/)
})

test("Admin Replenish KPI API is read-only, scoped, and limited to team approvers", async () => {
  const route = await read("app/api/transactions/replenish/kpi/route.js")

  assert.match(route, /authorizeApiRequest\(request, REPLENISH_KPI_MENU_HREF, "view"\)/)
  assert.match(route, /isReplenishTeamApprover\(authorization\.user\)/)
  assert.match(route, /Manager Operasional atau Asisten Manager CRO/)
  assert.match(route, /getUserDataScope\(authorization\.user\)/)
  assert.match(route, /resolveReplenishUker/)
  assert.match(route, /MAX_DATE_RANGE_DAYS = 366/)
  assert.match(route, /after_approved_at/)
  assert.doesNotMatch(route, /export async function (?:POST|PATCH|PUT|DELETE)/)
})

test("Manager Operasional receives a dedicated read-only KPI Admin Replenish menu", async () => {
  const migration = await read("scripts/migrations/046-replenish-admin-kpi-menu.sql")
  const layout = await read("app/kpi_admin_replenish/layout.jsx")
  const page = await read("app/kpi_admin_replenish/page.jsx")
  const constants = await read("modules/replenish/constants.js")
  const routes = await read("lib/routes.js")

  assert.match(constants, /REPLENISH_KPI_MENU_HREF = "\/kpi_admin_replenish"/)
  assert.match(layout, /AccessGuard menuHref=\{REPLENISH_KPI_MENU_HREF\}/)
  assert.match(migration, /'KPI Admin Replenish'[\s\S]*'\/kpi_admin_replenish'[\s\S]*'IconReport'/)
  assert.match(migration, /'MANAGER_OPERASIONAL'/)
  assert.match(migration, /'ASISTEN_MANAGER_CRO'/)
  assert.match(migration, /target\.can_view = 1/)
  assert.match(migration, /target\.can_create = 0[\s\S]*target\.can_update = 0[\s\S]*target\.can_delete = 0/)
  assert.match(page, /useAppBootstrap\(\)/)
  assert.match(page, /permissions\?\.\[REPLENISH_KPI_MENU_HREF\]/)
  assert.match(page, /KPI Admin Pembentukan Tim Replenish/)
  assert.match(page, /Rata-rata Admin/)
  assert.match(page, /Rata-rata approval/)
  assert.match(page, /Rata-rata total/)
  assert.match(page, /\/api\/transactions\/replenish\/kpi/)
  assert.match(routes, /path: "\/kpi_admin_replenish"/)
})

test("Admin Replenish KPI uses final approval dates and keyset pagination", async () => {
  const database = await read("modules/replenish/database.js")

  assert.match(database, /wo\.approved_at >= CONVERT\(DATE, @dateFrom, 23\)/)
  assert.match(database, /wo\.approved_at < DATEADD\(DAY, 1, CONVERT\(DATE, @dateTo, 23\)\)/)
  assert.match(database, /approved_at < CONVERT\(DATETIME2\(0\), @afterApprovedAt, 126\)/)
  assert.match(database, /work_order_id < @afterId/)
  assert.doesNotMatch(database, /\bOFFSET\b/i)
})
