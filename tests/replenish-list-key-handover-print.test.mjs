import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

test("key handover print button uses backend capability and stays visible until approval", async () => {
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(page, /transactionCapabilities\?\.can_print_key_handover/)
  assert.match(page, /const canPrintKeyHandoverFromList = Boolean\([\s\S]{0,260}item\.can_print_key_handover/)
  assert.match(page, /const keyHandoverPrintReady = isApprovedWorkOrderStatus\(item\.status\)/)
  assert.match(page, /onClick=\{\(\) => void printKeyHandoverDocument\(item\.id\)\}/)
  assert.match(page, /disabled=\{busy \|\| keyPrintBusy \|\| !keyHandoverPrintReady\}/)
  assert.match(page, />\s*Cetak Serah Terima Kunci\s*<\/button>/)
  assert.match(page, /Status DISETUJUI menentukan enabled\/disabled, bukan visibility tombol/)
  assert.match(page, /keyHandover\?\.capabilities\?\.can_print_key_handover/)
})

test("key-handover print supports explicit printer roles while scan stays mutation-permission and owner-only", async () => {
  const route = await read("app/api/transactions/replenish/[id]/key-handover/route.js")

  assert.match(route, /authorizeTransactionAny\(request, \["update", "create"\]\)/)
  assert.match(route, /if \(isScanActionRequest && !hasMutationPermission\)/)
  assert.match(route, /if \(isScanAction && !scope\.isSuperAdmin && !isOwner\)/)
  assert.match(route, /isReplenishKeyHandoverPrinter\(authorization\.user\)/)
  assert.match(route, /Anda tidak memiliki akses cetak Serah Terima Kunci/)
})

test("stored key-handover PDF accepts owner, explicit printer role, or transaction mutation permission", async () => {
  const route = await read("app/api/transactions/replenish/[id]/key-handover/pdf/route.js")

  assert.match(route, /hasMenuAccess\(authorization\.user\.role_id, "\/transactions", "create"\)/)
  assert.match(route, /hasMenuAccess\(authorization\.user\.role_id, "\/transactions", "update"\)/)
  assert.match(route, /isReplenishKeyHandoverPrinter\(authorization\.user\)/)
  assert.match(route, /canCreateTransaction \|\|[\s\S]{0,120}canUpdateTransaction/)
})

test("replenish list returns server-side key handover print capability", async () => {
  const route = await read("app/api/transactions/replenish/route.js")
  assert.match(route, /can_print_key_handover: canPrintKeyHandoverByAccess/)
  assert.match(route, /can_print_key_handover: Boolean\([\s\S]{0,180}Number\(item\.created_by\) === Number\(authorization\.user\.id\)/)
  assert.match(route, /isReplenishKeyHandoverPrinter\(authorization\.user\)/)
})
