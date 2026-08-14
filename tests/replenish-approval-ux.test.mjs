import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

test("admin saves a replenish work order as draft before the document-and-key prerequisite flow", async () => {
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(page, /Simpan Draft/)
  assert.doesNotMatch(page, /Simpan &amp; Ajukan/)
  assert.doesNotMatch(page, />Simpan & Ajukan</)
  assert.match(page, /Kelengkapan Pengajuan/)
  assert.match(page, /Cetak Surat Tugas/)
  assert.match(page, /Pengecekan &amp; Serah Terima Kunci/)
  assert.match(page, /handleAction\(detail, "SUBMIT"\)/)
})

test("manager approval controls clearly distinguish draft and submitted work orders", async () => {
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(page, /Tampilkan Antrian/)
  assert.match(page, /Tampilkan Semua/)
  assert.match(page, /Menunggu diajukan Admin CRO/)
  assert.match(page, /Tombol Setujui dan Tolak akan aktif setelah Admin CRO mengajukannya/)
  assert.match(page, /canReviewDetail/)
  assert.match(page, /handleAction\(detail, "APPROVE"\)/)
  assert.match(page, /handleAction\(detail, "REJECT"\)/)
})

test("admin cro with create-only legacy permission can still submit own draft after prerequisites", async () => {
  const page = await read("app/transactions/replenish/page.jsx")
  const detailRoute = await read("app/api/transactions/replenish/[id]/route.js")

  assert.match(page, /const canManageOwnDraft = canCreate \|\| canUpdate/)
  assert.match(page, /const canSubmit = canManageOwnDraft/)
  assert.match(page, /const canManageDetailKeys = Boolean/)
  assert.match(page, /const canSubmitDetail = Boolean/)
  assert.match(page, /assignmentPrintStatus\?\.letter_ready/)
  assert.match(page, /keyHandover\?\.summary\?\.all_scanned/)
  assert.match(page, /canPrintApprovedDocuments/)
  assert.match(page, /handleAction\(detail, "SUBMIT"\)/)
  assert.match(page, /Hanya pembuat draft yang dapat mengajukan/)

  assert.match(detailRoute, /authorizeTransactionAny/)
  assert.match(detailRoute, /REPLENISH_ACTIONS\.SUBMIT/)
  assert.match(detailRoute, /\["update", "create"\]/)
  assert.match(detailRoute, /Hanya pembuat work order yang dapat mengajukan persetujuan/i)
})

test("replenish draft save cannot fail silently behind native form validation", async () => {
  const page = await read("app/transactions/replenish/page.jsx")
  const css = await read("app/globals.css")

  assert.match(page, /function validateWorkOrderForm\(form\)/)
  assert.match(page, /<form[\s\S]*?noValidate/)
  assert.match(page, /onClick=\{\(\) => void handleSave\("DRAFT"\)\}/)
  assert.doesNotMatch(page, /onClick=\{\(\) => void handleSave\("SUBMIT"\)\}/)
  assert.match(page, /replenish-form-error" role="alert"/)
  assert.doesNotMatch(page, /event\.nativeEvent\?\.submitter/)
  assert.match(css, /\.replenish-form-error[\s\S]*position:\s*sticky/i)
})
