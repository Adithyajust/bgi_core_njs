import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

test("Master Pegawai menyediakan jabatan CPC", async () => {
  const page = await fs.readFile("app/masters/pegawai/page.jsx", "utf8")

  assert.match(
    page,
    /const JABATAN_OPTIONS = \[[\s\S]*"Asisten Manager CPC",[\s\S]*"CPC",/
  )
})
