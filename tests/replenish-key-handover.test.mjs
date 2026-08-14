import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

test("replenish key handover migration is relational and avoids double cascade paths", async () => {
  const migration = await read("scripts/migrations/038-replenish-key-handover.sql")

  assert.match(migration, /CREATE TABLE dbo\.replenish_key_handovers/i)
  assert.match(migration, /CREATE TABLE dbo\.replenish_key_handover_items/i)
  assert.match(migration, /UX_replenish_key_handover_work_order/i)
  assert.match(migration, /UX_replenish_key_handover_item_point/i)
  assert.match(migration, /machine_key_mapping_id BIGINT NOT NULL/i)
  assert.match(migration, /FK_replenish_key_handover_item_point[\s\S]*REFERENCES dbo\.replenish_work_order_points\(id\),/i)
  assert.doesNotMatch(migration, /FK_replenish_key_handover_item_point[\s\S]{0,180}ON DELETE CASCADE/i)
})

test("key scan route validates barcode against work-order points in one SQL lookup", async () => {
  const route = await read("app/api/transactions/replenish/[id]/key-handover/route.js")

  assert.match(route, /mapping\.barcode = @barcode/i)
  assert.match(route, /point\.work_order_id = @workOrderId/i)
  assert.match(route, /mapping\.key_type = 'REPLENISH'/i)
  assert.match(route, /machine_key_mapping_id/i)
  assert.match(route, /ISOLATION_LEVEL\.SERIALIZABLE/i)
  assert.match(route, /KEY_SCAN/)
  assert.match(route, /KEY_HANDOVER_PRINT/)
  assert.doesNotMatch(route, /for\s*\([^)]*items[^)]*\)[\s\S]{0,300}\.query\(/i)
})

test("successful key scan checks the mapping out so the master matrix renders it red", async () => {
  const route = await read("app/api/transactions/replenish/[id]/key-handover/route.js")
  const matrix = await read("modules/machine-key/matrix.js")
  const styles = await read("app/globals.css")

  assert.match(route, /UPDATE dbo\.machine_key_mappings[\s\S]*status = 'OUT'/i)
  assert.match(route, /current_work_order_id = @workOrderId/i)
  assert.match(route, /checked_out_at = CASE/i)
  assert.match(route, /checked_in_at = NULL/i)
  assert.match(matrix, /persistedStatus === MATRIX_MAPPING_STATUSES\.OUT\.value/i)
  assert.match(styles, /\.machine-key-matrix-slot\.out\s*\{[\s\S]*background:\s*#f87171/i)
})

test("resetting a scan checks the work-order keys back in", async () => {
  const route = await read("app/api/transactions/replenish/[id]/key-handover/route.js")
  const database = await read("modules/replenish/database.js")

  assert.match(route, /UPDATE mapping[\s\S]*status = 'IN'[\s\S]*current_work_order_id = NULL/i)
  assert.match(database, /resetReplenishKeyHandover\(executor, workOrderId, userId\)/i)
  assert.match(database, /checked_in_at = SYSDATETIME\(\)/i)
})

test("submit is blocked until every current mapping is scanned, without requiring pre-approval printing", async () => {
  const database = await read("modules/replenish/database.js")
  const detailRoute = await read("app/api/transactions/replenish/[id]/route.js")

  assert.match(database, /validateReplenishKeyHandoverForSubmit/)
  assert.match(database, /item\.barcode_snapshot = mapping\.barcode/i)
  assert.doesNotMatch(database, /Serah terima kunci wajib dicetak sebelum Work Order diajukan/i)
  assert.match(detailRoute, /validateReplenishKeyHandoverForSubmit\([\s\S]*transaction[\s\S]*workOrderId/)
  assert.match(detailRoute, /resetReplenishKeyHandover\(transaction, workOrderId, authorization\.user\.id\)/)
  assert.match(detailRoute, /validateAssignmentLetterReadyForSubmit/)
})

test("replenish UI exposes scan progress, print handover, and gated approval", async () => {
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(page, /Pengecekan &amp; Serah Terima Kunci/)
  assert.match(page, /Scan Barcode Kunci|Barcode Kunci/)
  assert.match(page, /Sudah Discan/)
  assert.match(page, /Cetak Serah Terima/)
  assert.match(page, /Bentuk PDF & Cetak Serah Terima Kunci/)
  assert.match(page, /Konfirmasi Sudah Dicetak/)
  assert.match(page, /keyHandover\.summary\?\.all_scanned/)
  assert.match(page, /assignmentPrintStatus\?\.letter_ready/)
  assert.match(page, /canPrintApprovedDocuments/)
  assert.match(page, />\s*Ajukan\s*</)
})

test("key handover reuses a valid stored PDF before preparing a new file", async () => {
  const page = await read("app/transactions/replenish/page.jsx")
  const route = await read("app/api/transactions/replenish/[id]/key-handover/route.js")

  assert.match(page, /Pola status-first mengikuti Surat Tugas/)
  assert.match(page, /const statusResult = await requestJson\(/)
  assert.match(page, /const reusedStoredPdf = Boolean\(/)
  assert.match(page, /pdf\?\.template_current === true/)
  assert.match(page, /if \(!reusedStoredPdf\) \{[\s\S]{0,600}action: "PREPARE_PRINT"/)
  assert.match(page, /File PDF Serah Terima Kunci tersimpan berhasil dibaca dan ditampilkan di form Detail Work Order/)
  assert.match(route, /key_handover_pdf: storedPdfStatus/)
  assert.match(route, /existingPdf\.document_hash === currentDocumentHash/)
  assert.match(route, /existingPdf\.template_version >= KEY_HANDOVER_PDF_TEMPLATE_VERSION/)
  assert.match(route, /keyHandoverPdfMetadata\(request, existingPdf, snapshot\)/)
})

test("key handover PDF stays inside the active Work Order detail form", async () => {
  const page = await read("app/transactions/replenish/page.jsx")
  const styles = await read("app/globals.css")

  assert.doesNotMatch(page, /window\.open\("about:blank", "_blank", "width=980,height=760"\)/)
  assert.match(page, /const currentDetailIsTarget = detailOpen && Number\(detail\?\.id\) === Number\(workOrderId\)/)
  assert.match(page, /const openedDetail = await openDetail\(workOrderId\)/)
  assert.match(page, /setKeyHandoverPdfVisible\(true\)/)
  assert.match(page, /className="replenish-key-pdf-viewer"/)
  assert.match(page, /Tutup Pratinjau/)
  assert.match(styles, /\.replenish-key-pdf-viewer\s*\{/)
})

test("key scanner verifies automatically without Enter and keeps scan panel visible on mismatch", async () => {
  const page = await read("app/transactions/replenish/page.jsx")
  const route = await read("app/api/transactions/replenish/[id]/key-handover/route.js")

  assert.match(page, /KEY_SCAN_IDLE_MS\s*=\s*160/)
  assert.match(page, /function scheduleKeyScan\(rawValue\)/)
  assert.match(page, /window\.setTimeout\(\(\) => \{[\s\S]*handleKeyScan\(barcode\)[\s\S]*KEY_SCAN_IDLE_MS/)
  assert.match(page, /Tidak perlu menekan Enter\./)
  assert.doesNotMatch(page, /placeholder="Scan barcode lalu tekan Enter"/)
  assert.match(page, /setKeyScanBarcode\(""\)[\s\S]*setKeyHandoverError\(error\.message\)/)
  assert.match(page, /detailBodyRef\.current\.scrollTop = preservedScrollTop/)
  assert.match(page, /focus\(\{ preventScroll: true \}\)/)
  assert.match(page, /keyHandover \? \([\s\S]*replenish-key-scan-message[\s\S]*\) : keyHandoverError \? \(/)
  assert.match(route, /Data scan tidak sesuai Work Order/)
  assert.match(route, /Data scan tidak sesuai\. Barcode/)
})



test("key handover API exposes print capability and allows explicit printer roles", async () => {
  const route = await read("app/api/transactions/replenish/[id]/key-handover/route.js")
  const pdfRoute = await read("app/api/transactions/replenish/[id]/key-handover/pdf/route.js")
  assert.match(route, /snapshot\.capabilities = \{[\s\S]{0,300}can_print_key_handover/)
  assert.match(route, /isReplenishKeyHandoverPrinter\(authorization\.user\)/)
  assert.match(pdfRoute, /isReplenishKeyHandoverPrinter\(authorization\.user\)/)
})

test("approved key handover printing uses persisted verification snapshot instead of mutable live mapping", async () => {
  const route = await read("app/api/transactions/replenish/[id]/key-handover/route.js")
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(route, /verifiedSnapshotComplete = Boolean\(header\.verified_at\)/)
  assert.match(route, /can_print: verifiedSnapshotComplete && hasReplenishReachedApproval\(header\.status\)/)
  assert.match(route, /use snapshot verifikasi|gunakan snapshot verifikasi/i)
  assert.match(route, /if \(!verifiedSnapshot\?\.verified_at \|\| scanned !== expected\)/)
  assert.doesNotMatch(route, /else \{\s*const verification = await updateVerificationState\([\s\S]{0,500}if \(action === "PREPARE_PRINT"\)/)
  assert.match(page, /const keyHandoverDetailPrintReady = Boolean\(\s*detail && isApprovedWorkOrderStatus\(detail\.status\)\s*\)/)
})

test("approved footer print button is not blocked by key-handover background loading", async () => {
  const page = await read("app/transactions/replenish/page.jsx")
  assert.match(page, /disabled=\{keyPrintBusy \|\| !keyHandoverDetailPrintReady\}/)
  assert.doesNotMatch(page, /disabled=\{keyPrintBusy \|\| keyHandoverLoading \|\| !keyHandoverDetailPrintReady\}/)
})


test("key handover stays printable after approval when workflow advances into CPC and later replenish stages", async () => {
  const { hasReplenishReachedApproval } = await import("../modules/replenish/constants.js")

  for (const status of [
    "DISETUJUI",
    "MENUNGGU_VALIDASI_KASET",
    "KASET_DALAM_PERSIAPAN",
    "MENUNGGU_APPROVAL_CPC",
    "KASET_SIAP",
    "SIAP_BERANGKAT",
    "BERANGKAT",
    "DALAM_PROSES_REPLENISH",
    "SELESAI",
    "DITUTUP",
  ]) {
    assert.equal(hasReplenishReachedApproval(status), true, status)
  }

  for (const status of ["DRAFT", "MENUNGGU_PERSETUJUAN_TIM", "DITOLAK", "DIBATALKAN"]) {
    assert.equal(hasReplenishReachedApproval(status), false, status)
  }
})
