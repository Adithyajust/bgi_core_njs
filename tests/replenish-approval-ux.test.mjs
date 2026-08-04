import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

test("admin can save and submit a replenish work order in one flow", async () => {
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(page, /saveIntent/)
  assert.match(page, /value="SUBMIT"/)
  assert.match(page, /Simpan &amp; Ajukan/)
  assert.match(page, /action: "SUBMIT"/)
  assert.match(page, /berhasil diajukan ke Manager Operasional/i)
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

test("admin cro with create-only legacy permission can still submit own draft", async () => {
  const page = await read("app/transactions/replenish/page.jsx")
  const detailRoute = await read("app/api/transactions/replenish/[id]/route.js")

  assert.match(page, /const canManageOwnDraft = canCreate \|\| canUpdate/)
  assert.match(page, /const canSubmit = canManageOwnDraft/)
  assert.match(page, /const canSubmitDetail = Boolean/)
  assert.match(page, /handleAction\(detail, "SUBMIT"\)/)
  assert.match(page, /\(editingId \? canUpdate : canCreate\)/)
  assert.match(page, /Hanya pembuat draft yang dapat mengajukan/)

  assert.match(detailRoute, /authorizeTransactionAny/)
  assert.match(detailRoute, /REPLENISH_ACTIONS\.SUBMIT/)
  assert.match(detailRoute, /\["update", "create"\]/)
  assert.match(detailRoute, /Hanya pembuat work order yang dapat mengajukan persetujuan/i)
})
