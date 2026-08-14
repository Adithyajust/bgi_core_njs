import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

test("CPC KPI separates operator packing, assistant-manager review, and total elapsed time", async () => {
  const database = await read("modules/cpc/database.js")

  assert.match(database, /export async function listCpcPackingKpis/)
  assert.match(database, /LEAD\(history\.action\)[\s\S]*PARTITION BY history\.work_order_id/)
  assert.match(database, /CPC_RECEIVE_REQUEST[\s\S]*CPC_START_PREPARATION[\s\S]*CPC_SUBMIT_APPROVAL/)
  assert.match(database, /event\.action IN \('CPC_RECEIVE_REQUEST', 'CPC_START_PREPARATION', 'CPC_REJECT_PACKING'\)/)
  assert.match(database, /event\.next_action = 'CPC_SUBMIT_APPROVAL'/)
  assert.match(database, /event\.action = 'CPC_SUBMIT_APPROVAL'[\s\S]*event\.next_action IN \('CPC_APPROVE_PACKING', 'CPC_REJECT_PACKING'\)/)
  assert.match(database, /DATEDIFF_BIG\([\s\S]*eligible\.approved_at[\s\S]*AS total_duration_seconds/)
  assert.match(database, /SUM\(CASE WHEN event\.action = 'CPC_REJECT_PACKING' THEN 1 ELSE 0 END\) AS rejection_count/)
})

test("CPC KPI API is read-only, unit-scoped, date-bounded, and restricted to Asisten Manager CPC", async () => {
  const route = await read("app/api/transactions/cpc/kpi/route.js")

  assert.match(route, /authorizeApiRequest\(request, CPC_KPI_MENU_HREF, "view"\)/)
  assert.match(route, /isCpcPackingApprover\(authorization\.user\)/)
  assert.match(route, /KPI packing CPC hanya dapat dilihat oleh Asisten Manager CPC/)
  assert.match(route, /getUserDataScope\(authorization\.user\)/)
  assert.match(route, /resolveCpcScope/)
  assert.match(route, /MAX_DATE_RANGE_DAYS = 366/)
  assert.match(route, /after_approved_at/)
  assert.doesNotMatch(route, /export async function (?:POST|PATCH|PUT|DELETE)/)
})

test("Asisten Manager CPC receives a dedicated KPI sidebar menu and guarded page", async () => {
  const migration = await read("scripts/migrations/045-cpc-packing-kpi-menu.sql")
  const layout = await read("app/kpi_cpc/layout.jsx")
  const page = await read("app/kpi_cpc/page.jsx")
  const constants = await read("modules/cpc/constants.js")
  const routes = await read("lib/routes.js")

  assert.match(constants, /CPC_KPI_MENU_HREF = "\/kpi_cpc"/)
  assert.match(layout, /AccessGuard menuHref=\{CPC_KPI_MENU_HREF\}/)
  assert.match(migration, /'KPI Packing CPC'[\s\S]*'\/kpi_cpc'[\s\S]*'IconReport'/)
  assert.match(migration, /'ASISTEN_MANAGER_CPC'/)
  assert.match(migration, /'ASISTEN MANAGER CPC'/)
  assert.match(migration, /target\.can_view = 1/)
  assert.match(migration, /target\.can_create = 0[\s\S]*target\.can_update = 0[\s\S]*target\.can_delete = 0/)
  assert.match(page, /useAppBootstrap\(\)/)
  assert.match(page, /permissions\?\.\[CPC_KPI_MENU_HREF\]/)
  assert.match(page, /KPI Penyelesaian Packing CPC/)
  assert.match(page, /Rata-rata packing/)
  assert.match(page, /Rata-rata approval/)
  assert.match(page, /Rata-rata total/)
  assert.match(page, /\/api\/transactions\/cpc\/kpi/)
  assert.match(routes, /path: "\/kpi_cpc"/)
})

test("CPC KPI query uses approval-date filtering and keyset pagination", async () => {
  const database = await read("modules/cpc/database.js")

  assert.match(database, /batch\.approved_at >= CONVERT\(DATE, @dateFrom, 23\)/)
  assert.match(database, /batch\.approved_at < DATEADD\(DAY, 1, CONVERT\(DATE, @dateTo, 23\)\)/)
  assert.match(database, /approved_at < CONVERT\(DATETIME2\(0\), @afterApprovedAt, 126\)/)
  assert.match(database, /work_order_id < @afterId/)
  assert.doesNotMatch(database, /\bOFFSET\b/i)
})
