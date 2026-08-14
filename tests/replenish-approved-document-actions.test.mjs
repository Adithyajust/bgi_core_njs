import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

test("approved work order exposes both assignment-letter and key-handover print actions", async () => {
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(page, /canPrintApprovedDocuments/)
  assert.match(page, /isApprovedWorkOrderStatus\(detail\.status\)/)
  assert.match(page, /detailIsOwner \|\| assignmentPrintStatus\?\.can_prepare \|\| isSuperAdmin/)
  assert.doesNotMatch(
    page,
    /const canPrintApprovedDocuments = Boolean\([\s\S]{0,160}canManageOwnDraft/
  )
  assert.match(page, /Cetak Surat Tugas/)
  assert.match(page, /Cetak Serah Terima Kunci/)
  assert.match(page, /onClick=\{\(\) => void printKeyHandoverDocument\(detail\.id\)\}/)
  assert.match(page, /disabled=\{keyPrintBusy \|\| !keyHandoverDetailPrintReady\}/)
})

test("approval refreshes document and key-handover state in an open detail", async () => {
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(page, /\["SUBMIT", "APPROVE"\]\.includes\(action\)/)
  assert.match(page, /loadKeyHandover\(item\.id, \{ silent: true \}\)/)
  assert.match(page, /loadAssignmentPrintStatus\(item\.id, \{ silent: true \}\)/)
})
