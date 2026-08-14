import assert from "node:assert/strict"
import test from "node:test"

import { validateMachineKeyPayload } from "../modules/machine-key/validation.js"

function validPayload(overrides = {}) {
  return {
    machine_id: 10,
    key_type: "REPLENISH",
    function_code: "R",
    matrix_wall: "A1",
    matrix_column: "D",
    matrix_row: "04",
    random_segment: "Xrtw",
    has_tombak: true,
    has_fascia: true,
    notes: "Slink baja terpasang.",
    ...overrides,
  }
}

test("machine-key payload validation builds the server-side barcode", () => {
  const result = validateMachineKeyPayload(validPayload())

  assert.equal(result.error, null)
  assert.equal(result.data.barcode, "A1DXrtwR04")
  assert.equal(result.data.keyType, "REPLENISH")
})

test("FLM mapping must use the confirmed F code", () => {
  const invalid = validateMachineKeyPayload(
    validPayload({ key_type: "FLM", function_code: "R" })
  )
  const valid = validateMachineKeyPayload(
    validPayload({
      key_type: "FLM",
      function_code: "F",
      matrix_wall: "A3",
      matrix_column: "H",
      matrix_row: "08",
      random_segment: "tyye",
    })
  )

  assert.match(invalid.error, /wajib F/)
  assert.equal(valid.error, null)
  assert.equal(valid.data.barcode, "A3HtyyeF08")
})

test("Backup remains supported without inventing a default BRS code", () => {
  const missingCode = validateMachineKeyPayload(
    validPayload({ key_type: "BACKUP", function_code: "" })
  )
  const manualCode = validateMachineKeyPayload(
    validPayload({ key_type: "BACKUP", function_code: "B" })
  )

  assert.match(missingCode.error, /Kode fungsi barcode/)
  assert.equal(manualCode.error, null)
  assert.equal(manualCode.data.functionCode, "B")
})

test("a complete set requires tombak and fascia keys", () => {
  const result = validateMachineKeyPayload(
    validPayload({ has_fascia: false })
  )

  assert.match(result.error, /kunci tombak dan kunci fascia/)
})


test("default matrix boundary is accepted by server validation", () => {
  const result = validateMachineKeyPayload(
    validPayload({
      matrix_wall: "A5",
      matrix_column: "Z",
      matrix_row: "15",
      random_segment: "Ab29",
    })
  )

  assert.equal(result.error, null)
  assert.equal(result.data.barcode, "A5ZAb29R15")
})
