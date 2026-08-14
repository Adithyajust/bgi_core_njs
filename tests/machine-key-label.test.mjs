import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  createCode128Bars,
  createCode128Svg,
  encodeCode128B,
} from "../modules/machine-key/code128.js"
import { createQrSvg } from "../modules/replenish/qr-code.js"

const pageSource = await readFile(
  new URL("../app/masters/kunci-mesin/page.jsx", import.meta.url),
  "utf8"
)
const globalCssSource = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8"
)

test("Code 128-B label encoder produces start, checksum, stop, and SVG bars", () => {
  const value = "A1A2BiLR01"
  const codes = encodeCode128B(value)
  const expectedDataCodes = Array.from(value, (character) => character.codePointAt(0) - 32)
  const expectedChecksum = (
    104 + expectedDataCodes.reduce((sum, code, index) => sum + code * (index + 1), 0)
  ) % 103

  assert.deepEqual(codes, [104, ...expectedDataCodes, expectedChecksum, 106])

  const encoded = createCode128Bars(value)
  assert.ok(encoded.bars.length > value.length)
  assert.ok(encoded.moduleCount > 100)

  const svg = createCode128Svg(value, { showText: false })
  assert.match(svg, /^<svg /)
  assert.match(svg, /shape-rendering="crispEdges"/)
  assert.match(svg, /<rect x=/)
  assert.doesNotMatch(svg, /api\.qrserver|quickchart|googleapis/i)
})

test("machine-key QR encodes the same final barcode locally", () => {
  const value = "A1A2BiLR01"
  const svg = createQrSvg(value, {
    ariaLabel: `QR Code kunci mesin ${value}`,
  })

  assert.match(svg, /^<svg /)
  assert.match(svg, new RegExp(`aria-label="QR Code kunci mesin ${value}"`))
  assert.doesNotMatch(svg, /api\.qrserver|quickchart|googleapis/i)
})

test("machine-key form exposes preview, direct print, save-and-print, and table reprint", () => {
  assert.match(pageSource, /Pratinjau Label Sling/)
  assert.doesNotMatch(pageSource, /<span>Barcode Code 128<\/span>/)
  assert.doesNotMatch(pageSource, /<span>QR Code<\/span>/)
  assert.equal(
    (pageSource.match(/className="machine-key-label-value"/g) || []).length,
    2
  )
  assert.match(pageSource, /<div class="qr-code">\$\{safeBarcode\}<\/div>/)
  assert.match(pageSource, /Cetak Pratinjau/)
  assert.match(pageSource, /Simpan & Cetak Label/)
  assert.match(pageSource, /value="save-and-print"/)
  assert.match(pageSource, /printMachineKeyLabel\(mapping\)/)
  assert.match(pageSource, /MACHINE_KEY_LABEL_WIDTH_MM = 25/)
  assert.match(pageSource, /MACHINE_KEY_LABEL_HEIGHT_MM = 15/)
  assert.match(pageSource, /@page \{ size: \$\{MACHINE_KEY_LABEL_WIDTH_MM\}mm \$\{MACHINE_KEY_LABEL_HEIGHT_MM\}mm; margin: 0; \}/)
  assert.match(pageSource, /Ukuran cetak: \{MACHINE_KEY_LABEL_WIDTH_MM\} × \{MACHINE_KEY_LABEL_HEIGHT_MM\} mm/)
  assert.match(globalCssSource, /\.machine-key-label-visuals/)
})
