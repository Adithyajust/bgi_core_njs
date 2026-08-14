import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

test("submission requires prepared Surat Tugas and complete key scan, while printing is post-approval", async () => {
  const route = await read("app/api/transactions/replenish/[id]/key-handover/route.js")
  const database = await read("modules/replenish/database.js")
  const detailRoute = await read("app/api/transactions/replenish/[id]/route.js")
  const pdfRoute = await read("app/api/transactions/replenish/[id]/surat-tugas/pdf/route.js")
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(route, /can_submit:\s*liveAllScanned/)
  assert.match(route, /hasReplenishReachedApproval\(current\.status\)/)
  assert.match(route, /Serah Terima Kunci hanya dapat dicetak setelah Work Order pernah disetujui/)

  assert.match(database, /scanned !== expected/)
  assert.match(database, /verified:\s*true/)
  assert.doesNotMatch(database, /Serah terima kunci wajib dicetak sebelum Work Order diajukan/)

  assert.match(detailRoute, /validateReplenishKeyHandoverForSubmit/)
  assert.match(detailRoute, /validateAssignmentLetterReadyForSubmit/)
  assert.doesNotMatch(detailRoute, /validateAssignmentLetterPrintedForSubmit/)
  assert.doesNotMatch(detailRoute, /PRINT_CONFIRMED/)

  assert.match(pdfRoute, /letter\?\.status === "DISETUJUI"/)
  assert.match(pdfRoute, /Surat Tugas baru dapat dicetak setelah Work Order disetujui/)

  assert.match(page, /assignmentPrintStatus\?\.letter_ready/)
  assert.match(page, /keyHandover\?\.summary\?\.all_scanned/)
  assert.match(page, /canPrintApprovedDocuments/)
  assert.match(page, /Cetak Surat Tugas/)
  assert.match(page, /Cetak Serah Terima Kunci/)
  assert.match(page, /!canSubmitDetail/)
})
