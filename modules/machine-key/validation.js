import { buildMachineKeyBarcode } from "./barcode.js"
import { findMachineKeyType } from "./constants.js"
import { DEFAULT_MACHINE_KEY_MATRIX_CONFIG } from "./matrix-config.js"

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeId(value) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function normalizeBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true"
}

export function validateMachineKeyPayload(
  body = {},
  matrixConfig = DEFAULT_MACHINE_KEY_MATRIX_CONFIG
) {
  const machineId = normalizeId(body.machine_id)
  const keyType = normalizeText(body.key_type).toUpperCase()
  const keyDefinition = findMachineKeyType(keyType)
  const functionCode = normalizeText(body.function_code).toUpperCase()
  const hasTombak = normalizeBoolean(body.has_tombak)
  const hasFascia = normalizeBoolean(body.has_fascia)
  const notes = normalizeText(body.notes)

  if (!machineId) {
    return { error: "Mesin wajib dipilih.", data: null }
  }

  if (!keyDefinition) {
    return { error: "Jenis set kunci tidak valid.", data: null }
  }

  if (!hasTombak || !hasFascia) {
    return {
      error: "Satu set kunci wajib terdiri dari kunci tombak dan kunci fascia.",
      data: null,
    }
  }

  if (
    keyDefinition.barcodeCodeConfirmed &&
    functionCode !== keyDefinition.barcodeCode
  ) {
    return {
      error: `Kode fungsi ${keyDefinition.label} wajib ${keyDefinition.barcodeCode}.`,
      data: null,
    }
  }

  const barcodeResult = buildMachineKeyBarcode(
    {
      wall: body.matrix_wall,
      column: body.matrix_column,
      row: body.matrix_row,
      randomSegment: body.random_segment,
      functionCode,
    },
    matrixConfig
  )

  if (!barcodeResult.valid) {
    return { error: barcodeResult.errors[0], data: null }
  }

  if (notes.length > 500) {
    return { error: "Catatan maksimal 500 karakter.", data: null }
  }

  return {
    error: null,
    data: {
      machineId,
      keyType,
      functionCode: barcodeResult.data.functionCode,
      matrixWall: barcodeResult.data.wall,
      matrixColumn: barcodeResult.data.column,
      matrixRow: barcodeResult.data.row,
      randomSegment: barcodeResult.data.randomSegment,
      barcode: barcodeResult.barcode,
      hasTombak,
      hasFascia,
      notes: notes || null,
    },
  }
}
