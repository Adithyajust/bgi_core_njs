import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

import {
  getRowVersionToken,
  normalizeRowVersionToken,
} from "../modules/master-mesin/row-version.js"

test("row version mesin dinormalisasi dari format SQL dan Buffer JSON", () => {
  assert.equal(
    normalizeRowVersionToken("0x00000000000000af"),
    "0x00000000000000AF"
  )
  assert.equal(
    normalizeRowVersionToken("00000000000000AF"),
    "0x00000000000000AF"
  )
  assert.equal(
    normalizeRowVersionToken({
      type: "Buffer",
      data: [0, 0, 0, 0, 0, 0, 0, 175],
    }),
    "0x00000000000000AF"
  )
  assert.equal(
    normalizeRowVersionToken({ value: "0x00000000000000af" }),
    "0x00000000000000AF"
  )
  assert.equal(normalizeRowVersionToken("invalid"), "")
  assert.equal(normalizeRowVersionToken({ data: [1, 2] }), "")
})

test("token row version dapat dibaca dari beberapa nama properti", () => {
  assert.equal(
    getRowVersionToken({ row_version_hex: "0x00000000000000AF" }),
    "0x00000000000000AF"
  )
  assert.equal(
    getRowVersionToken({
      version: { row_version: "00000000000000AF" },
    }),
    "0x00000000000000AF"
  )
  assert.equal(getRowVersionToken({}), "")
})

test("update mesin membandingkan row version sebagai VARBINARY(8)", () => {
  const route = fs.readFileSync("app/api/masters/mesin/route.js", "utf8")

  assert.match(route, /requestedRowVersion/)
  assert.match(route, /requestedUpdatedAt/)
  assert.match(route, /existingRowVersion/)
  assert.match(route, /sql\.VarBinary\(8\)/)
  assert.match(route, /Buffer\.from\(rowVersion\.slice\(2\), "hex"\)/)
  assert.match(route, /AND row_version = @rowVersion/)
  assert.doesNotMatch(route, /CONVERT\(BINARY\(8\), @rowVersion, 1\)/)
})

test("form edit mesin memakai detail, daftar, dan updated_at sebagai fallback", () => {
  const page = fs.readFileSync("app/masters/mesin/page.jsx", "utf8")

  assert.match(page, /async function openEditModal\(item\)/)
  assert.match(page, /mode=detail/)
  assert.match(page, /getRowVersionToken\(currentItem\)/)
  assert.match(page, /getRowVersionToken\(item\)/)
  assert.match(page, /updated_at: form\.updated_at/)
  assert.doesNotMatch(
    page,
    /Versi data Mesin tidak tersedia\. Muat ulang halaman dan coba kembali\./
  )
})
