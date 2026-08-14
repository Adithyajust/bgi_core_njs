import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const routeSource = await readFile(
  new URL("../app/api/masters/kunci-mesin/route.js", import.meta.url),
  "utf8"
)
const migrationSource = await readFile(
  new URL("../scripts/migrations/036-machine-key-mapping.sql", import.meta.url),
  "utf8"
)
const expansionMigrationSource = await readFile(
  new URL("../scripts/migrations/037-expand-machine-key-matrix.sql", import.meta.url),
  "utf8"
)
const serverConfigSource = await readFile(
  new URL("../lib/machine-key/matrix-config.js", import.meta.url),
  "utf8"
)

test("machine-key API exposes scoped CRUD handlers", () => {
  assert.match(routeSource, /export async function GET/)
  assert.match(routeSource, /export async function POST/)
  assert.match(routeSource, /export async function PUT/)
  assert.match(routeSource, /export async function DELETE/)
  assert.match(routeSource, /getUserDataScope/)
  assert.match(routeSource, /mu\.codeuker = @scopeCodeUker/)
  assert.match(routeSource, /mk\.uker_id = @matrixUkerId/)
  assert.match(routeSource, /requires_machine_selection/)
})

test("machine-key API uses optimistic concurrency and audit logging", () => {
  assert.match(routeSource, /normalizeRowVersionToken/)
  assert.match(routeSource, /row_version = @rowVersion/)
  assert.match(routeSource, /insertAuditLog/)
  assert.match(routeSource, /masters\.kunci-mesin/)
})

test("initial migration enforces one key type per machine and one mapping per slot", () => {
  assert.match(migrationSource, /CREATE TABLE dbo\.machine_key_mappings/)
  assert.match(migrationSource, /UX_machine_key_machine_type/)
  assert.match(migrationSource, /UX_machine_key_matrix_slot/)
  assert.match(migrationSource, /ON dbo\.machine_key_mappings\(uker_id, matrix_wall, matrix_column, matrix_row\)/)
  assert.match(migrationSource, /FK_machine_key_uker/)
  assert.match(migrationSource, /UX_machine_key_barcode/)
  assert.match(migrationSource, /barcode AS/)
  assert.match(migrationSource, /ROWVERSION NOT NULL/)
})

test("migration preserves IN and OUT semantics for future Work Order scans", () => {
  assert.match(migrationSource, /status IN \('IN', 'OUT'\)/)
  assert.match(migrationSource, /current_work_order_id BIGINT NULL/)
  assert.match(migrationSource, /status = 'OUT' AND current_work_order_id IS NOT NULL/)
  assert.match(migrationSource, /FK_machine_key_current_work_order/)
})

test("available-machine search excludes machines that already have a mapping", () => {
  assert.match(routeSource, /mode === "available-machines"/)
  assert.match(routeSource, /NOT EXISTS \([\s\S]*existing_mapping\.machine_id = ms\.id/)
  assert.match(routeSource, /MACHINE_ALREADY_MAPPED/)
  assert.match(routeSource, /WITH \(UPDLOCK, HOLDLOCK\)/)
})

test("matrix expansion migration supports dynamic dimensions and one mapping per machine", () => {
  assert.match(expansionMigrationSource, /UX_machine_key_machine/)
  assert.match(expansionMigrationSource, /CREATE UNIQUE INDEX UX_machine_key_machine/)
  assert.match(expansionMigrationSource, /LIKE '\[1-9\]'/)
  assert.match(expansionMigrationSource, /LIKE '\[A-Z\]'/)
  assert.match(expansionMigrationSource, /BETWEEN 1 AND 99/)
  assert.match(expansionMigrationSource, /Default aplikasi: A1-A5, A-Z, dan 01-15/)
})

test("matrix dimensions are configurable through environment variables", () => {
  assert.match(serverConfigSource, /MACHINE_KEY_MATRIX_WALL_COUNT/)
  assert.match(serverConfigSource, /MACHINE_KEY_MATRIX_COLUMN_COUNT/)
  assert.match(serverConfigSource, /MACHINE_KEY_MATRIX_ROW_COUNT/)
  assert.match(routeSource, /matrix_config: serializedMatrixConfig/)
})

test("machine-key summary avoids SQL Server reserved-word aliases", () => {
  assert.match(routeSource, /AS backup_count/)
  assert.match(routeSource, /summaryRow\.backup_count/)
  assert.doesNotMatch(routeSource, /AS backup(?:\s|\n|,)/i)
})
