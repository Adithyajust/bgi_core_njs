import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const synchronizationRouteSource = await readFile(
  new URL(
    "../app/api/masters/kunci-mesin/synchronize/route.js",
    import.meta.url
  ),
  "utf8"
)
const mappingRouteSource = await readFile(
  new URL("../app/api/masters/kunci-mesin/route.js", import.meta.url),
  "utf8"
)
const pageSource = await readFile(
  new URL("../app/masters/kunci-mesin/page.jsx", import.meta.url),
  "utf8"
)

test("machine-key synchronization is authorized and scoped by unit kerja", () => {
  assert.match(synchronizationRouteSource, /authorizeApiRequest\([\s\S]*"create"/)
  assert.match(synchronizationRouteSource, /getUserDataScope/)
  assert.match(synchronizationRouteSource, /scope_machine_id/)
  assert.match(synchronizationRouteSource, /p\.uker_id = @ukerId/)
  assert.match(synchronizationRouteSource, /machine-key-sync:/)
  assert.match(synchronizationRouteSource, /DECLARE @lockResource/)
  assert.match(synchronizationRouteSource, /@Resource = @lockResource/)
})

test("machine-key synchronization fills slots wall first without N+1 inserts", () => {
  assert.match(synchronizationRouteSource, /OPENJSON\(@wallsJson\)/)
  assert.match(synchronizationRouteSource, /OPENJSON\(@columnsJson\)/)
  assert.match(synchronizationRouteSource, /OPENJSON\(@rowsJson\)/)
  assert.match(
    synchronizationRouteSource,
    /ORDER BY[\s\S]*wall\.wall_order,[\s\S]*matrix_row\.row_order,[\s\S]*matrix_column\.column_order/
  )
  assert.match(
    synchronizationRouteSource,
    /INSERT INTO dbo\.machine_key_mappings[\s\S]*FROM @Prepared prepared;/
  )
  assert.doesNotMatch(synchronizationRouteSource, /for\s*\(/)
  assert.doesNotMatch(synchronizationRouteSource, /\.map\([\s\S]*INSERT INTO dbo\.machine_key_mappings/)
})

test("machine-key synchronization excludes mapped machines and occupied slots", () => {
  assert.match(
    synchronizationRouteSource,
    /NOT EXISTS \([\s\S]*existing_machine\.machine_id = ms\.id/
  )
  assert.match(
    synchronizationRouteSource,
    /NOT EXISTS \([\s\S]*existing_slot\.uker_id = @ukerId[\s\S]*existing_slot\.matrix_wall = slot\.matrix_wall/
  )
  assert.match(synchronizationRouteSource, /INDEX\(UX_machine_key_machine\)/)
  assert.match(synchronizationRouteSource, /INDEX\(UX_machine_key_matrix_slot\)/)
  assert.match(synchronizationRouteSource, /ISOLATION_LEVEL\.SERIALIZABLE/)
})

test("machine-key synchronization generates server-side unique barcodes", () => {
  assert.match(synchronizationRouteSource, /HASHBYTES\(/)
  assert.match(synchronizationRouteSource, /CandidateAttempts/)
  assert.match(synchronizationRouteSource, /INDEX\(UX_machine_key_barcode\)/)
  assert.match(synchronizationRouteSource, /MACHINE_KEY_SYNC_BARCODE_EXHAUSTED/)
  assert.match(synchronizationRouteSource, /'REPLENISH'/)
  assert.match(synchronizationRouteSource, /'R'/)
})

test("mapping page exposes synchronization status and confirmation flow", () => {
  assert.match(mappingRouteSource, /sync_status:/)
  assert.match(mappingRouteSource, /unmapped_machines/)
  assert.match(mappingRouteSource, /free_slots/)
  assert.match(pageSource, /Sinkronisasi Matrix Kunci/)
  assert.match(pageSource, /Mapping Otomatis/)
  assert.match(pageSource, /\/api\/masters\/kunci-mesin\/synchronize/)
  assert.match(pageSource, /Mesin yang sudah dimapping tidak akan diproses kembali/)
})


test("machine-key synchronization summary avoids aggregate-over-subquery SQL error", () => {
  assert.match(
    mappingRouteSource,
    /LEFT JOIN dbo\.machine_key_mappings existing_mapping[\s\S]*existing_mapping\.machine_id = ms\.id/
  )
  assert.match(
    mappingRouteSource,
    /WHEN existing_mapping\.machine_id IS NULL THEN 1/
  )
  assert.doesNotMatch(
    mappingRouteSource,
    /SUM\([\s\S]{0,240}WHEN NOT EXISTS \(/
  )
})
