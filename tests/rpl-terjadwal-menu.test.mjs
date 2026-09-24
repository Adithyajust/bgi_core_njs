import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

test("RPL Terjadwal tersedia sebagai halaman dengan desain aplikasi", async () => {
  const page = await read("app/rpl_terjadwal/upload-client.jsx")
  const routes = await read("lib/routes.js")

  assert.match(page, /RPL Terjadwal/)
  assert.match(page, /page-heading-card/)
  assert.match(page, /settings-card/)
  assert.match(routes, /path: "\/rpl_terjadwal"/)
})

test("RPL Terjadwal dikunci khusus untuk Super Admin", async () => {
  const layout = await read("app/rpl_terjadwal/layout.jsx")
  const migration = await read("scripts/migrations/054-superadmin-rpl-terjadwal-menu.sql")

  assert.match(layout, /requireMenuAccess\(MENU_HREF\)/)
  assert.match(layout, /isSuperAdmin\(user\)/)
  assert.match(layout, /redirect\("\/forbidden"\)/)
  assert.match(migration, /'RPL Terjadwal'[\s\S]*'\/rpl_terjadwal'/)
  assert.match(migration, /DELETE permission[\s\S]*<> 'SUPER_ADMIN'/)
  assert.match(migration, /= 'SUPER_ADMIN'/)
  assert.match(migration, /target\.can_view = 1/)
})
