import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const pageSource = await readFile(
  new URL("../app/masters/kunci-mesin/page.jsx", import.meta.url),
  "utf8"
)
const masterMenuSource = await readFile(
  new URL("../app/masters/page.jsx", import.meta.url),
  "utf8"
)
const globalCssSource = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8"
)

test("machine-key Stage 2 form is registered in Master Data", () => {
  assert.match(masterMenuSource, /href:\s*"\/masters\/kunci-mesin"/)
  assert.match(pageSource, /Mapping Set Kunci dan Matrix/)
  assert.match(pageSource, /Tahap 2 · Fitur Kunci Mesin/)
})

test("machine-key form covers machine, key composition, matrix, barcode, and persistence", () => {
  assert.match(pageSource, /Data Mesin/)
  assert.match(pageSource, /Komposisi Set Kunci/)
  assert.match(pageSource, /Posisi Matrix Kunci/)
  assert.match(pageSource, /Barcode Slink Kunci/)
  assert.match(pageSource, /Simpan Mapping/)
  assert.match(pageSource, /Perbarui Mapping/)
  assert.match(pageSource, /Hapus Mapping/)
})

test("machine-key form documents FLM code and matrix color rules", () => {
  assert.match(pageSource, /R = Replenish dan F = First Level Maintenance/)
  assert.match(pageSource, /Kuning: belum dimapping dengan TID/)
  assert.match(pageSource, /Hijau: kunci tersedia atau sudah kembali/)
  assert.match(pageSource, /Merah: kunci sudah discan keluar/)
  assert.match(pageSource, /Kode Backup belum ditetapkan dalam BRS/)
})

test("machine-key form loads persisted matrix data and server configuration", () => {
  assert.match(pageSource, /requestJson\(`\/api\/masters\/kunci-mesin\$\{query\}`\)/)
  assert.match(pageSource, /mappingBySlot/)
  assert.match(pageSource, /persistedStatus:\s*persistedMapping\?\.status/)
  assert.match(pageSource, /Mapping Tersimpan/)
  assert.match(pageSource, /loadMappings/)
  assert.match(pageSource, /machine_id=\$\{encodeURIComponent\(machineId\)\}/)
  assert.match(pageSource, /result\.data\?\.matrix_config/)
  assert.match(pageSource, /createMachineKeyMatrixConfig/)
})

test("machine-key form excludes machines already mapped", () => {
  assert.match(pageSource, /mode:\s*"available-machines"/)
  assert.match(pageSource, /current_mapping_id/)
  assert.match(pageSource, /result\.data\?\.machines/)
  assert.match(pageSource, /belum memiliki mapping kunci/)
})

test("machine-key form provides a dynamic interactive visual matrix selector", () => {
  assert.match(pageSource, /Matrix Visual/)
  assert.match(pageSource, /role="grid"/)
  assert.match(pageSource, /matrixConfig\.rows\.map/)
  assert.match(pageSource, /matrixConfig\.columns\.map/)
  assert.match(pageSource, /matrixConfig\.walls\.map/)
  assert.match(pageSource, /gridTemplateColumns/)
  assert.match(pageSource, /selectMatrixSlot/)
  assert.match(pageSource, /Klik slot hijau atau merah/)
})

test("machine-key form is aligned with the shared Master Data layout", () => {
  assert.match(pageSource, /user-role-page/)
  assert.match(pageSource, /user-role-summary-grid/)
  assert.match(pageSource, /user-role-panel/)
  assert.match(pageSource, /user-role-modal machine-key-modal/)
  assert.match(pageSource, /Tambah Mapping/)
  assert.match(pageSource, /Data Tersimpan/)
})

test("machine-key page and mapping modal use the wide Master layout", () => {
  assert.match(pageSource, /machine-key-modal-backdrop/)
  assert.match(globalCssSource, /\.machine-key-page\s*\{[^}]*max-width:\s*100%/s)
  assert.match(globalCssSource, /\.machine-key-modal\s*\{[^}]*width:\s*min\(1680px,\s*100%\)/s)
})
