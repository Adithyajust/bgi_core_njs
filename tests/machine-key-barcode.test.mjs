import assert from "node:assert/strict"
import test from "node:test"

import {
  buildMachineKeyBarcode,
  generateRandomSegment,
  normalizeBarcodeFunctionCode,
  normalizeRandomSegment,
} from "../modules/machine-key/barcode.js"
import {
  findMachineKeyType,
  resolveMatrixMappingStatus,
} from "../modules/machine-key/constants.js"
import { createMachineKeyMatrixConfig } from "../modules/machine-key/matrix-config.js"

test("buildMachineKeyBarcode follows BRS composition", () => {
  const result = buildMachineKeyBarcode({
    wall: "A1",
    column: "D",
    randomSegment: "Xrtw",
    functionCode: "R",
    row: "04",
  })

  assert.equal(result.valid, true)
  assert.equal(result.barcode, "A1DXrtwR04")
})

test("FLM barcode uses the confirmed F function code", () => {
  const flmDefinition = findMachineKeyType("FLM")
  const result = buildMachineKeyBarcode({
    wall: "A3",
    column: "H",
    randomSegment: "tyye",
    functionCode: flmDefinition?.barcodeCode,
    row: "08",
  })

  assert.equal(flmDefinition?.barcodeCodeConfirmed, true)
  assert.equal(flmDefinition?.barcodeCode, "F")
  assert.equal(result.valid, true)
  assert.equal(result.barcode, "A3HtyyeF08")
})

test("matrix mapping is yellow before a TID is assigned and green after mapping", () => {
  assert.deepEqual(resolveMatrixMappingStatus(""), {
    value: "UNMAPPED",
    label: "Kuning · Belum dimapping TID",
    tone: "unmapped",
  })
  assert.deepEqual(resolveMatrixMappingStatus("123"), {
    value: "IN",
    label: "Hijau · Tersedia",
    tone: "available",
  })
})

test("barcode parts are normalized and invalid values are rejected", () => {
  assert.equal(normalizeRandomSegment(" A!b-2c9 "), "Ab2c")
  assert.equal(normalizeBarcodeFunctionCode(" r "), "R")

  const result = buildMachineKeyBarcode({
    wall: "A9",
    column: "AA",
    randomSegment: "12",
    functionCode: "",
    row: "99",
  })

  assert.equal(result.valid, false)
  assert.equal(result.barcode, "")
  assert.ok(result.errors.length >= 5)
})

test("default matrix accepts wall A5, column Z, and row 15", () => {
  const result = buildMachineKeyBarcode({
    wall: "A5",
    column: "Z",
    randomSegment: "Ab29",
    functionCode: "R",
    row: "15",
  })

  assert.equal(result.valid, true)
  assert.equal(result.barcode, "A5ZAb29R15")
})

test("barcode validation follows a custom matrix configuration", () => {
  const config = createMachineKeyMatrixConfig({
    wallCount: 2,
    columnCount: 3,
    rowCount: 4,
  })
  const valid = buildMachineKeyBarcode(
    {
      wall: "A2",
      column: "C",
      randomSegment: "A123",
      functionCode: "R",
      row: "04",
    },
    config
  )
  const invalid = buildMachineKeyBarcode(
    {
      wall: "A3",
      column: "D",
      randomSegment: "A123",
      functionCode: "R",
      row: "05",
    },
    config
  )

  assert.equal(valid.valid, true)
  assert.equal(invalid.valid, false)
  assert.equal(invalid.errors.length, 3)
})

test("generateRandomSegment always creates four supported characters", () => {
  const values = [0, 0.25, 0.5, 0.75]
  let index = 0
  const segment = generateRandomSegment(() => values[index++])

  assert.equal(segment.length, 4)
  assert.match(segment, /^[A-Za-z0-9]{4}$/)
})
