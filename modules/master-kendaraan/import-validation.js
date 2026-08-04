export const MAX_VEHICLE_IMPORT_ROWS = 500
export const MAX_VEHICLE_IMPORT_FILE_BYTES = 5 * 1024 * 1024
export const MAX_VEHICLE_IMPORT_REQUEST_BYTES = 1024 * 1024

export const VEHICLE_IMPORT_HEADERS = [
  "kode_unit_kerja",
  "jenis_kendaraan",
  "merk_kendaraan",
  "nomor_kendaraan",
  "status",
]

export const VEHICLE_IMPORT_HEADER_LABELS = {
  kode_unit_kerja: "Kode Unit Kerja",
  jenis_kendaraan: "Jenis Kendaraan",
  merk_kendaraan: "Merk Kendaraan",
  nomor_kendaraan: "Nomor Kendaraan",
  status: "Status",
}

const VEHICLE_TYPES = new Set(["MOBIL", "MOTOR"])
const VEHICLE_STATUSES = new Set(["AKTIF", "NONAKTIF"])

function normalizeText(value) {
  if (value === null || value === undefined) return ""
  return String(value).trim()
}

export function normalizeVehicleImportHeader(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
}

export function normalizeVehicleUnitCode(value) {
  const normalized = normalizeText(value).toUpperCase()

  if (/^\d{1,4}$/.test(normalized)) {
    return normalized.padStart(4, "0")
  }

  return normalized
}

export function normalizeImportedVehicleNumber(value) {
  return normalizeText(value).toUpperCase().replace(/\s+/g, " ")
}

function addError(errors, row, field, message) {
  errors.push({ row, field, message })
}

function getRowNumber(row, index) {
  const candidate = Number(row?._row_number)
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : index + 2
}

export function validateVehicleImportRows(rows, { isSuperAdmin = false } = {}) {
  const sourceRows = Array.isArray(rows) ? rows : []
  const errors = []
  const normalizedRows = []
  const numberOccurrences = new Map()

  if (sourceRows.length === 0) {
    return {
      rows: [],
      errors: [
        {
          row: null,
          field: null,
          message: "File tidak berisi data kendaraan.",
        },
      ],
    }
  }

  if (sourceRows.length > MAX_VEHICLE_IMPORT_ROWS) {
    return {
      rows: [],
      errors: [
        {
          row: null,
          field: null,
          message: `Maksimal ${MAX_VEHICLE_IMPORT_ROWS} baris dalam satu kali upload.`,
        },
      ],
    }
  }

  sourceRows.forEach((row, index) => {
    const rowNumber = getRowNumber(row, index)
    const normalized = {
      _row_number: rowNumber,
      kode_unit_kerja: normalizeVehicleUnitCode(row?.kode_unit_kerja),
      jenis_kendaraan: normalizeText(row?.jenis_kendaraan).toUpperCase(),
      merk_kendaraan: normalizeText(row?.merk_kendaraan),
      nomor_kendaraan: normalizeImportedVehicleNumber(row?.nomor_kendaraan),
      status: normalizeText(row?.status || "AKTIF").toUpperCase(),
    }

    normalizedRows.push(normalized)

    if (isSuperAdmin && !normalized.kode_unit_kerja) {
      addError(
        errors,
        rowNumber,
        "kode_unit_kerja",
        "Kode unit kerja wajib diisi untuk Super Admin."
      )
    }

    if (normalized.kode_unit_kerja.length > 4) {
      addError(
        errors,
        rowNumber,
        "kode_unit_kerja",
        "Kode unit kerja maksimal 4 karakter."
      )
    }

    if (!VEHICLE_TYPES.has(normalized.jenis_kendaraan)) {
      addError(
        errors,
        rowNumber,
        "jenis_kendaraan",
        "Jenis kendaraan harus MOBIL atau MOTOR."
      )
    }

    if (!normalized.merk_kendaraan) {
      addError(
        errors,
        rowNumber,
        "merk_kendaraan",
        "Merk kendaraan wajib diisi."
      )
    } else if (normalized.merk_kendaraan.length > 100) {
      addError(
        errors,
        rowNumber,
        "merk_kendaraan",
        "Merk kendaraan maksimal 100 karakter."
      )
    }

    if (!normalized.nomor_kendaraan) {
      addError(
        errors,
        rowNumber,
        "nomor_kendaraan",
        "Nomor kendaraan wajib diisi."
      )
    } else {
      if (normalized.nomor_kendaraan.length > 20) {
        addError(
          errors,
          rowNumber,
          "nomor_kendaraan",
          "Nomor kendaraan maksimal 20 karakter."
        )
      }

      if (!/^[A-Z0-9 .-]+$/.test(normalized.nomor_kendaraan)) {
        addError(
          errors,
          rowNumber,
          "nomor_kendaraan",
          "Nomor kendaraan hanya boleh berisi huruf, angka, spasi, titik, dan tanda hubung."
        )
      }

      const occurrences = numberOccurrences.get(normalized.nomor_kendaraan) || []
      occurrences.push(rowNumber)
      numberOccurrences.set(normalized.nomor_kendaraan, occurrences)
    }

    if (!VEHICLE_STATUSES.has(normalized.status)) {
      addError(
        errors,
        rowNumber,
        "status",
        "Status harus AKTIF atau NONAKTIF."
      )
    }
  })

  numberOccurrences.forEach((rowNumbers, vehicleNumber) => {
    if (rowNumbers.length < 2) return

    rowNumbers.forEach((rowNumber) => {
      addError(
        errors,
        rowNumber,
        "nomor_kendaraan",
        `Nomor kendaraan ${vehicleNumber} duplikat di dalam file.`
      )
    })
  })

  return { rows: normalizedRows, errors }
}
