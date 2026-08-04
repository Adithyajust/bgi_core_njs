import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationPath = new URL(
  "../scripts/migrations/024-add-pegawai-row-version.sql",
  import.meta.url
)
const routePath = new URL("../app/api/masters/pegawai/route.js", import.meta.url)

test("migration 024 adds pegawai row_version idempotently", async () => {
  const migration = await readFile(migrationPath, "utf8")

  assert.match(
    migration,
    /IF\s+COL_LENGTH\(N'dbo\.pegawai',\s*N'row_version'\)\s+IS\s+NULL/i
  )
  assert.match(
    migration,
    /ALTER\s+TABLE\s+dbo\.pegawai[\s\S]*ADD\s+row_version\s+ROWVERSION/i
  )
  assert.match(migration, /system_type_id\s*<>\s*189/i)
})

test("pegawai GET returns actionable schema error for missing row_version", async () => {
  const route = await readFile(routePath, "utf8")

  assert.match(route, /getSqlErrorNumber\(error\)\s*===\s*207/)
  assert.match(route, /024-add-pegawai-row-version\.sql/)
  assert.match(route, /npm run db:migrate/)
})
