import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { getAuthenticatedHomePath } from "../lib/default-route.js"
import { createQR } from "../modules/surat-tugas/generateQR.js"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

test("akun Custody diarahkan ke Replenish Lapangan", () => {
  assert.equal(getAuthenticatedHomePath({ roleCode: "CUSTODY" }), "/field_replenish")
  assert.equal(
    getAuthenticatedHomePath({ pegawai: { jabatan: "Petugas Custody" } }),
    "/field_replenish"
  )
  assert.equal(getAuthenticatedHomePath({ roleCode: "SUPER_ADMIN" }), "/dashboard")
})

test("generator QR lama tetap berfungsi tanpa dependensi yang tidak dideklarasikan", async () => {
  const dataUrl = await createQR("https://example.test/verify/123")
  assert.match(dataUrl, /^data:image\/svg\+xml;base64,/)
})

test("seluruh pintu masuk login memakai tujuan berdasarkan identitas user", async () => {
  const [homePage, loginPage, changePasswordPage] = await Promise.all([
    fs.readFile(path.join(projectRoot, "app/page.jsx"), "utf8"),
    fs.readFile(path.join(projectRoot, "app/login/page.jsx"), "utf8"),
    fs.readFile(path.join(projectRoot, "app/change-password/page.jsx"), "utf8"),
  ])

  assert.match(homePage, /redirect\(getAuthenticatedHomePath\(user\)\)/)
  assert.match(loginPage, /getRedirectPath\(result\.data\)/)
  assert.match(changePasswordPage, /router\.replace\(getAuthenticatedHomePath\(user\)\)/)
})

test("migration Custody membentuk role dan permission lapangan minimum", async () => {
  const migration = await fs.readFile(
    path.join(projectRoot, "scripts/migrations/048-create-custody-role.sql"),
    "utf8"
  )

  assert.match(migration, /'CUSTODY'/)
  assert.match(migration, /href = '\/field_replenish'/)
  assert.match(migration, /target\.can_view = 1/)
  assert.match(migration, /target\.can_create = 0/)
  assert.match(migration, /target\.can_update = 1/)
  assert.match(migration, /target\.can_delete = 0/)
})

test("pengaturan user memvalidasi kesesuaian role Custody dan jabatan pegawai", async () => {
  const route = await fs.readFile(
    path.join(projectRoot, "app/api/settings/user-role/route.js"),
    "utf8"
  )

  assert.match(route, /const ROLE_CODE_CUSTODY = "CUSTODY"/)
  assert.match(route, /validateRolePegawaiAlignment\(role, pegawai\)/)
  assert.match(route, /validateRolePegawaiAlignment\(targetRole, pegawai\)/)
})
