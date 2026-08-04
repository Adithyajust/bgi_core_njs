import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

import {
  REPLENISH_MAKER_CANCELLABLE_STATUSES,
} from "../modules/replenish/constants.js"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

test("admin cro may cancel only draft or rejected work orders", () => {
  assert.deepEqual(REPLENISH_MAKER_CANCELLABLE_STATUSES, ["DRAFT", "DITOLAK"])
  assert.equal(REPLENISH_MAKER_CANCELLABLE_STATUSES.includes("MENUNGGU_PERSETUJUAN_TIM"), false)
})

test("backend blocks cancellation while work order waits for manager approval", async () => {
  const route = await read("app/api/transactions/replenish/[id]/route.js")

  assert.match(route, /current\.status === "MENUNGGU_PERSETUJUAN_TIM"/)
  assert.match(route, /sudah diajukan tidak dapat dibatalkan oleh Admin CRO/i)
  assert.match(route, /REPLENISH_MAKER_CANCELLABLE_STATUSES\.includes\(current\.status\)/)
})

test("frontend hides cancel and explains the approval lock", async () => {
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(page, /REPLENISH_MAKER_CANCELLABLE_STATUSES\.includes\(item\.status\)/)
  assert.match(page, /REPLENISH_MAKER_CANCELLABLE_STATUSES\.includes\(detail\.status\)/)
  assert.match(page, /Menunggu keputusan Manager Operasional \/ Asisten Manager CRO/)
  assert.match(page, /Tombol Batalkan akan tersedia kembali apabila work order ditolak/)
})
