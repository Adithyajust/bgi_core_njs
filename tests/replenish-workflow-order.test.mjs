import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

test("workflow enforces prepare letter -> scan -> submit -> approve -> print", async () => {
  const keyRoute = await read("app/api/transactions/replenish/[id]/key-handover/route.js")
  const detailRoute = await read("app/api/transactions/replenish/[id]/route.js")
  const letterRoute = await read("app/api/transactions/replenish/[id]/surat-tugas/route.js")
  const pdfRoute = await read("app/api/transactions/replenish/[id]/surat-tugas/pdf/route.js")
  const page = await read("app/transactions/replenish/page.jsx")

  // Scan cannot start until the pending/preparatory assignment letter exists and is valid.
  assert.match(keyRoute, /getAssignmentLetterByWorkOrder/)
  assert.match(keyRoute, /assignmentLetter\.status !== "MENUNGGU_PERSETUJUAN"/)
  assert.match(keyRoute, /Selesaikan Surat Tugas terlebih dahulu sebelum melakukan scan kunci/)

  // Submit requires prepared letter + all scanned keys, not printed documents.
  assert.match(detailRoute, /validateAssignmentLetterReadyForSubmit/)
  assert.match(detailRoute, /validateReplenishKeyHandoverForSubmit/)
  assert.match(detailRoute, /targetStatus = "MENUNGGU_PERSETUJUAN_TIM"/)
  assert.doesNotMatch(detailRoute, /PRINT_CONFIRMED/)

  // Approval converts the assignment letter to the approved document with QR metadata.
  assert.match(detailRoute, /action === REPLENISH_ACTIONS\.APPROVE/)
  assert.match(detailRoute, /createApprovedAssignmentLetter/)
  assert.match(letterRoute, /letter\?\.status === "DISETUJUI"/)

  // Both print paths are blocked until approval.
  assert.match(keyRoute, /hasReplenishReachedApproval\(current\.status\)/)
  assert.match(pdfRoute, /letter\?\.status === "DISETUJUI"/)
  assert.match(pdfRoute, /Surat Tugas baru dapat dicetak setelah Work Order disetujui/)

  // UI mirrors the same gate.
  assert.match(page, /Selesaikan Surat Tugas/)
  assert.match(page, /assignmentPrintStatus\?\.letter_ready/)
  assert.match(page, /keyHandover\?\.summary\?\.all_scanned/)
  assert.match(page, /canPrintApprovedDocuments/)
  assert.match(page, /isApprovedWorkOrderStatus\(detail\.status\)/)
})
