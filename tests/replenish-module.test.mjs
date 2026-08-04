import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

test("replenish migration creates auditable work-order core tables", async () => {
  const migration = await read("scripts/migrations/026-replenish-work-order-core.sql")

  assert.match(migration, /CREATE SEQUENCE dbo\.replenish_work_order_sequence/i)
  assert.match(migration, /CREATE TABLE dbo\.replenish_work_orders/i)
  assert.match(migration, /CREATE TABLE dbo\.replenish_work_order_points/i)
  assert.match(migration, /CREATE TABLE dbo\.replenish_team_members/i)
  assert.match(migration, /CREATE TABLE dbo\.replenish_status_history/i)
  assert.match(migration, /row_version ROWVERSION NOT NULL/i)
  assert.match(migration, /UX_replenish_point_machine/i)
  assert.match(migration, /UX_replenish_team_role/i)
  assert.match(migration, /MENUNGGU_PERSETUJUAN_TIM/i)
  assert.doesNotMatch(migration, /combination_code/i)
})

test("replenish list API uses cursor pagination and scope filtering", async () => {
  const route = await read("app/api/transactions/replenish/route.js")

  assert.match(route, /after_id/)
  assert.match(route, /wo\.id < @afterId/)
  assert.match(route, /getUserDataScope/)
  assert.match(route, /authorizeApiRequest\(request, "\/transactions"/)
  assert.doesNotMatch(route, /\bOFFSET\b/i)
})

test("replenish mutations use transactions, row version, and audit trail", async () => {
  const createRoute = await read("app/api/transactions/replenish/route.js")
  const detailRoute = await read("app/api/transactions/replenish/[id]/route.js")

  assert.match(createRoute, /ISOLATION_LEVEL\.SERIALIZABLE/)
  assert.match(createRoute, /module: "transactions\.replenish"/)
  assert.match(createRoute, /entityType: "replenish_work_order"/)
  assert.match(detailRoute, /input\("rowVersion", sql\.Binary\(8\), lockedRowVersion\)/)
  assert.match(detailRoute, /AND row_version = @rowVersion;/)
  assert.match(detailRoute, /Pembuat work order tidak boleh menyetujui/i)
  assert.match(detailRoute, /isReplenishTeamApprover/)
  assert.match(detailRoute, /INSERT INTO dbo\.replenish_status_history/i)
  assert.match(detailRoute, /module: "transactions\.replenish"/)
})

test("replenish UI is connected to the transaction hub", async () => {
  const hub = await read("app/transactions/page.jsx")
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(hub, /href="\/transactions\/replenish"/)
  assert.match(page, /Buat Work Order/)
  assert.match(page, /ReplenishAutocomplete/)
  assert.match(page, /handleAction\(item, "SUBMIT"\)/)
  assert.match(page, /handleAction\(item, "APPROVE"\)/)
  assert.match(page, /Riwayat Status/)
})

test("replenish compatibility migration follows the actual pegawai id type", async () => {
  const migration = await read(
    "scripts/migrations/025z-replenish-pegawai-id-compatibility.sql"
  )
  const databaseModule = await read("modules/replenish/database.js")

  assert.match(migration, /TYPE_NAME\(c\.system_type_id\)/i)
  assert.match(migration, /employee_id ' \+ @pegawaiIdType/i)
  assert.match(migration, /FK_replenish_team_employee/i)
  assert.match(migration, /ALTER COLUMN employee_id/i)
  assert.match(databaseModule, /input\("custodyId", sql\.BigInt/i)
  assert.match(databaseModule, /input\("employeeId", sql\.BigInt/i)
})

test("replenish stores escort as free text and only exposes active cars", async () => {
  const migration = await read(
    "scripts/migrations/027-replenish-escort-free-text-car-only.sql"
  )
  const validation = await read("modules/replenish/validation.js")
  const database = await read("modules/replenish/database.js")
  const optionsRoute = await read("app/api/transactions/replenish/options/route.js")
  const createRoute = await read("app/api/transactions/replenish/route.js")
  const updateRoute = await read("app/api/transactions/replenish/[id]/route.js")
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(migration, /ADD escort_name NVARCHAR\(200\)/i)
  assert.match(migration, /EXEC sys\.sp_executesql/i)
  assert.match(migration, /Invalid column name 'escort_name'/i)
  assert.match(migration, /tm\.member_role = ''PENGAWALAN''/i)
  assert.match(migration, /DELETE FROM dbo\.replenish_team_members[\s\S]*member_role = 'PENGAWALAN'/i)
  assert.match(migration, /member_role IN \('CUSTODY', 'PENGEMUDI'\)/i)

  assert.match(validation, /escort_name/)
  assert.match(validation, /escortName/)
  assert.doesNotMatch(validation, /escortId/)

  assert.match(database, /jenis_kendaraan[\s\S]*= 'MOBIL'/i)
  assert.match(database, /data\.custodyId[\s\S]*data\.driverId/)
  assert.doesNotMatch(database, /data\.escortId/)
  assert.doesNotMatch(database, /role: "PENGAWALAN"/)

  assert.match(optionsRoute, /jenis_kendaraan\)\)\) = 'MOBIL'/i)
  assert.match(createRoute, /escort_name/)
  assert.match(updateRoute, /escort_name = @escortName/)

  assert.match(page, /value=\{form\.escort_name\}/)
  assert.match(page, /escort_name: form\.escort_name/)
  assert.match(page, /placeholder="Cari mobil operasional"/)
  assert.doesNotMatch(page, /selected=\{form\.escort\}/)
})

test("replenish permission repair updates legacy view-only transaction grants", async () => {
  const migration = await read(
    "scripts/migrations/028-replenish-permission-alignment.sql"
  )

  assert.match(migration, /MERGE dbo\.role_sidebar_routes/i)
  assert.match(migration, /target\.can_create[\s\S]*source\.can_create/i)
  assert.match(migration, /role_code = 'OPERATOR'/i)
  assert.match(migration, /ADMIN_CRO/i)
  assert.match(migration, /MANAGER_CRO/i)
  assert.match(migration, /href = '\/transactions'/i)
})

test("replenish UI follows bootstrap CRUD permissions", async () => {
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(page, /const \{ user, permissions \} = useAppBootstrap\(\)/)
  assert.match(page, /permissions\?\.\["\/transactions"\]/)
  assert.match(page, /const canCreate =/)
  assert.match(page, /const canUpdate =/)
  assert.match(page, /\{canCreate \? \(/)
  assert.match(page, /Role Anda belum memiliki izin Tambah/)
  assert.match(page, /const canEdit = canUpdate/)
})


test("replenish employee options and backend enforce operational job titles", async () => {
  const optionsRoute = await read("app/api/transactions/replenish/options/route.js")
  const autocomplete = await read("components/replenish-autocomplete.jsx")
  const database = await read("modules/replenish/database.js")
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(optionsRoute, /team_role/)
  assert.match(optionsRoute, /requiredJobTitle/)
  assert.match(optionsRoute, /ISNULL\(jabatan, ''\)[\s\S]*@requiredJobTitle/i)
  assert.match(autocomplete, /teamRole/)
  assert.match(page, /teamRole="CUSTODY"/)
  assert.match(page, /teamRole="DRIVER"/)
  assert.match(database, /ISNULL\(jabatan, ''\)[\s\S]*= 'CUSTODY'/i)
  assert.match(database, /ISNULL\(jabatan, ''\)[\s\S]*= 'DRIVER'/i)
  assert.match(database, /menjabat Custody/i)
  assert.match(database, /menjabat Driver/i)
})

test("manager operasional receives a visible maker-checker approval queue", async () => {
  const migration = await read(
    "scripts/migrations/029-replenish-team-role-and-operational-approval.sql"
  )
  const authorization = await read("modules/replenish/authorization.js")
  const detailRoute = await read("app/api/transactions/replenish/[id]/route.js")
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(migration, /MANAGER OPERASIONAL/i)
  assert.match(migration, /ASISTEN MANAGER CRO/i)
  assert.match(migration, /p\.jabatan/i)
  assert.match(migration, /target\.can_update = 1/i)
  assert.match(authorization, /MANAGER_OPERASIONAL/)
  assert.match(authorization, /ASISTEN_MANAGER_CRO/)
  assert.doesNotMatch(authorization, /ASISTEN_MANAGER_CPC/)
  const createRoute = await read("app/api/transactions/replenish/route.js")

  assert.match(detailRoute, /isReplenishTeamApprover\(authorization\.user\)/)
  assert.match(detailRoute, /Pembuat work order tidak boleh menyetujui/i)
  assert.match(createRoute, /bertindak sebagai checker dan tidak dapat membuat work order/i)
  assert.match(page, /const approvalRole = isReplenishTeamApprover\(user\)/)
  assert.match(page, /Antrian Approval Manager Operasional/)
  assert.match(page, /setStatusFilter\("MENUNGGU_PERSETUJUAN_TIM"\)/)
})
