import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import test from "node:test"

async function read(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

test("migration 030 adds the denom column, constraint, and supporting index", async () => {
  const migration = await read("scripts/migrations/030-add-master-mesin-denom.sql")

  assert.match(migration, /ADD denom NVARCHAR\(50\) NULL/i)
  assert.match(migration, /CK_master_mesin_denom_not_blank/)
  assert.match(migration, /IX_master_mesin_denom_active/)
  assert.match(migration, /sys\.sp_executesql/)
  assert.match(migration, /COL_LENGTH\(N'dbo\.master_mesin', N'denom'\)/)
})

test("master mesin API reads, searches, filters, creates, and updates denom", async () => {
  const route = await read("app/api/masters/mesin/route.js")

  assert.match(route, /denom_enabled/)
  assert.match(route, /ms\.denom LIKE @searchContains/)
  assert.match(route, /ms\.denom = @denom/)
  assert.match(route, /\.input\("denom", sql\.NVarChar\(50\), data\.denom\)/)
  assert.match(route, /INSERT INTO dbo\.master_mesin \([\s\S]*?denom/)
  assert.match(route, /SET[\s\S]*?denom = @denom/)
  assert.match(route, /migration 030-add-master-mesin-denom\.sql/i)
})

test("machine upload schema, parser, preview, and SQL import include denom", async () => {
  const validation = await read("modules/master-mesin/import-validation.js")
  const importRoute = await read("app/api/masters/mesin/import/route.js")
  const page = await read("app/masters/mesin/page.jsx")

  assert.match(validation, /"denom"/)
  assert.match(validation, /Denom wajib diisi/)
  assert.match(importRoute, /denom NVARCHAR\(50\) NOT NULL/)
  assert.match(importRoute, /source\.denom/)
  assert.match(page, /<label htmlFor="denom">Denom \*<\/label>/)
  assert.match(page, /<th>Denom<\/th>/)
  assert.match(page, /row\.denom \|\| "-"/)
})

test("replenish machine options and work order detail expose denom", async () => {
  const optionsRoute = await read("app/api/transactions/replenish/options/route.js")
  const listRoute = await read("app/api/transactions/replenish/route.js")
  const database = await read("modules/replenish/database.js")
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(optionsRoute, /m\.denom/)
  assert.match(optionsRoute, /Denom \$\{row\.denom\}/)
  assert.match(listRoute, /search_machine\.denom LIKE @search/)
  assert.match(database, /mm\.denom/)
  assert.match(database, /m\.denom/)
  assert.match(page, /point\.denom \? ` · Denom \$\{point\.denom\}`/)
})

test("updated XLSX upload template is packaged", async () => {
  const template = new URL(
    "../public/templates/template-upload-mesin.xlsx",
    import.meta.url
  )
  const templateStat = await stat(template)

  assert.ok(templateStat.size > 1000)
})
