import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

const routePath = new URL(
  "../app/api/masters/kendaraan/route.js",
  import.meta.url
)
const pagePath = new URL(
  "../app/masters/kendaraan/page.jsx",
  import.meta.url
)
const migrationPath = new URL(
  "../scripts/migrations/013-master-kendaraan.sql",
  import.meta.url
)
const masterMenuPath = new URL("../app/masters/page.jsx", import.meta.url)

test("Master Kendaraan enforces CRUD permissions and Uker scope", async () => {
  const source = await fs.readFile(routePath, "utf8")

  assert.match(source, /authorizeMaster\(request, "view"\)/)
  assert.match(source, /authorizeMaster\(request, "create"\)/)
  assert.match(source, /authorizeMaster\(request, "update"\)/)
  assert.match(source, /authorizeMaster\(request, "delete"\)/)
  assert.match(source, /mu\.codeuker = @scopeCodeUker/)
  assert.match(source, /resolveWriteUker/)
  assert.match(source, /scope\.isSuperAdmin/)
})

test("Master Kendaraan migration creates unique vehicle number and constraints", async () => {
  const source = await fs.readFile(migrationPath, "utf8")

  assert.match(source, /CREATE TABLE dbo\.master_kendaraan/)
  assert.match(source, /UX_master_kendaraan_nomor/)
  assert.match(source, /CHECK \(jenis_kendaraan IN \('MOBIL', 'MOTOR'\)\)/)
  assert.match(source, /CHECK \(status IN \('AKTIF', 'NONAKTIF'\)\)/)
  assert.match(source, /FOREIGN KEY \(uker_id\) REFERENCES dbo\.master_uker\(id\)/)
})

test("Master Kendaraan page and menu are registered", async () => {
  const [pageSource, menuSource] = await Promise.all([
    fs.readFile(pagePath, "utf8"),
    fs.readFile(masterMenuPath, "utf8"),
  ])

  assert.match(pageSource, /Master Kendaraan/)
  assert.match(pageSource, /\/api\/masters\/kendaraan/)
  assert.match(menuSource, /href: "\/masters\/kendaraan"/)
})


test("Master Kendaraan writes CREATE, UPDATE, and DELETE audit logs", async () => {
  const source = await fs.readFile(routePath, "utf8")

  assert.match(source, /import \{ writeAuditLog \}/)
  assert.match(source, /action: "CREATE"[\s\S]*module: "masters\.kendaraan"/)
  assert.match(source, /action: "UPDATE"[\s\S]*module: "masters\.kendaraan"/)
  assert.match(source, /action: "DELETE"[\s\S]*module: "masters\.kendaraan"/)
  assert.match(source, /entityType: "master_kendaraan"/)
})
