import { DEFAULT_MACHINE_KEY_MATRIX_CONFIG } from "./matrix-config.js"

const RANDOM_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

function normalizeText(value) {
  return String(value || "").trim()
}

export function normalizeBarcodeFunctionCode(value) {
  return normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 1)
}

export function normalizeRandomSegment(value) {
  return normalizeText(value).replace(/[^A-Za-z0-9]/g, "").slice(0, 4)
}

export function generateRandomSegment(randomSource = Math.random) {
  let output = ""

  for (let index = 0; index < 4; index += 1) {
    const randomValue = Number(randomSource())
    const safeRandom = Number.isFinite(randomValue)
      ? Math.min(Math.max(randomValue, 0), 0.999999999999)
      : 0
    const alphabetIndex = Math.floor(safeRandom * RANDOM_ALPHABET.length)
    output += RANDOM_ALPHABET[alphabetIndex]
  }

  return output
}

export function validateMachineKeyBarcodeParts(
  parts = {},
  matrixConfig = DEFAULT_MACHINE_KEY_MATRIX_CONFIG
) {
  const wall = normalizeText(parts.wall).toUpperCase()
  const column = normalizeText(parts.column).toUpperCase()
  const row = normalizeText(parts.row).padStart(2, "0")
  const randomSegment = normalizeRandomSegment(parts.randomSegment)
  const functionCode = normalizeBarcodeFunctionCode(parts.functionCode)
  const errors = []

  if (!matrixConfig.walls.includes(wall)) {
    errors.push("Dinding matrix wajib dipilih.")
  }

  if (!matrixConfig.columns.includes(column)) {
    errors.push("Kolom matrix wajib dipilih.")
  }

  if (!matrixConfig.rows.includes(row)) {
    errors.push("Baris matrix wajib dipilih.")
  }

  if (randomSegment.length !== 4) {
    errors.push("Segmen random harus terdiri dari 4 karakter alfanumerik.")
  }

  if (functionCode.length !== 1) {
    errors.push("Kode fungsi barcode harus terdiri dari 1 karakter.")
  }

  return {
    valid: errors.length === 0,
    errors,
    data: {
      wall,
      column,
      row,
      randomSegment,
      functionCode,
    },
  }
}

export function buildMachineKeyBarcode(
  parts = {},
  matrixConfig = DEFAULT_MACHINE_KEY_MATRIX_CONFIG
) {
  const validation = validateMachineKeyBarcodeParts(parts, matrixConfig)

  if (!validation.valid) {
    return {
      ...validation,
      barcode: "",
    }
  }

  const { wall, column, randomSegment, functionCode, row } = validation.data

  return {
    ...validation,
    barcode: `${wall}${column}${randomSegment}${functionCode}${row}`,
  }
}
