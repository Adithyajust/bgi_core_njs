import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

test("replenish detail exposes explicit print actions without changing list-query structure", async () => {
  const page = await read("app/transactions/replenish/page.jsx")
  const listRoute = await read("app/api/transactions/replenish/route.js")

  assert.match(page, /Cetak Surat Tugas/)
  assert.match(page, /Cetak Serah Terima Kunci/)
  assert.match(page, /printKeyHandoverDocument/)
  assert.match(page, /Kelengkapan Pengajuan/)
  assert.match(page, /assignmentPrintStatus/)
  assert.match(page, /keyHandover/)
  assert.doesNotMatch(listRoute, /LEFT JOIN dbo\.replenish_key_handovers handover ON handover\.work_order_id = wo\.id/i)
})

test("key handover print embeds immutable server PDF in the same detail form and confirms separately without N+1", async () => {
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(page, /action: "PREPARE_PRINT"/)
  assert.match(page, /action: "MARK_PRINTED"/)
  assert.match(page, /keyHandover\.summary\?\.printed/)
  assert.match(page, /prepareResult\.data\?\.key_handover_pdf/)
  assert.match(page, /src={`\$\{keyHandoverPdf\.pdf_url\}#toolbar=1&navpanes=0&view=FitH`}/)
  assert.match(page, /className="replenish-key-pdf-viewer"/)
  assert.doesNotMatch(page, /printWindow\.location\.replace\(pdf\.pdf_url\)/)
  assert.match(page, /confirmKeyHandoverPrinted/)
  assert.doesNotMatch(page, /buildKeyHandoverPrintHtml/)
  assert.doesNotMatch(page, /document\.write\(/)
  assert.doesNotMatch(page, /for\s*\([^)]*items[^)]*\)[\s\S]{0,200}requestJson\(/i)
})

test("assignment letter page uses an explicit print label and confirmation", async () => {
  const page = await read("app/transactions/replenish/[id]/surat-tugas/page.jsx")

  assert.match(page, /Cetak Surat Tugas/)
  assert.match(page, /Konfirmasi Sudah Dicetak/)
})
