import {
  LOCATION_CATEGORY_VALUES,
  normalizeLocationCategory,
  normalizeOperationTime,
  suggestLocationCategory,
  OPERATION_DAY_VALUES,
  OPERATION_HOUR_VALUES,
  OPERATION_TIME_VALUES,
  SITE_VALUES,
  WARRANTY_VALUES,
} from "./constants.js"

export const MAX_MACHINE_IMPORT_ROWS = 500
export const MAX_MACHINE_IMPORT_FILE_BYTES = 5 * 1024 * 1024
export const MAX_MACHINE_IMPORT_REQUEST_BYTES = 2 * 1024 * 1024

export const MACHINE_IMPORT_HEADERS = [
  "tid",
  "sn",
  "db",
  "denom",
  "kode_cabang",
  "kode_project",
  "kode_merk",
  "jenis_mesin",
  "nama_model",
  "lokasi",
  "site",
  "kategori_lokasi",
  "garansi",
  "hari_ops",
  "jam_ops",
  "waktu_ops",
  "longitude",
  "latitude",
  "status",
]

export const MACHINE_IMPORT_HEADER_LABELS = {
  tid: "TID",
  sn: "SN",
  db: "DB",
  denom: "Denom",
  kode_cabang: "Kode Cabang",
  kode_project: "Kode Project",
  kode_merk: "Kode Merk",
  jenis_mesin: "Jenis Mesin",
  nama_model: "Nama Model",
  lokasi: "Lokasi",
  site: "Site",
  kategori_lokasi: "Kategori Lokasi",
  garansi: "Garansi",
  hari_ops: "Hari Operasional",
  jam_ops: "Jam Operasional",
  waktu_ops: "Waktu Operasional",
  longitude: "Longitude",
  latitude: "Latitude",
  status: "Status",
}

const MACHINE_STATUSES = new Set(["AKTIF", "NONAKTIF"])

function normalizeText(value) {
  if (value === null || value === undefined) return ""

  return String(value)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeUpperText(value) {
  return normalizeText(value).toUpperCase()
}

export function normalizeMachineImportHeader(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
}

function normalizeStatus(value) {
  const normalized = normalizeUpperText(value || "AKTIF")

  if (["1", "TRUE", "ACTIVE"].includes(normalized)) return "AKTIF"
  if (["0", "FALSE", "INACTIVE", "NON AKTIF"].includes(normalized)) {
    return "NONAKTIF"
  }

  return normalized
}

function parseCoordinate(value, minimum, maximum) {
  const normalized = normalizeText(value)
  if (!normalized) return { value: null, error: null }

  const parsed = Number(normalized.replace(",", "."))
  if (!Number.isFinite(parsed)) {
    return { value: null, error: "harus berupa angka." }
  }

  if (parsed < minimum || parsed > maximum) {
    return {
      value: null,
      error: `harus berada pada rentang ${minimum} sampai ${maximum}.`,
    }
  }

  return { value: Number(parsed.toFixed(6)), error: null }
}

function addError(errors, row, field, message) {
  errors.push({ row, field, message })
}

function getRowNumber(row, index) {
  const candidate = Number(row?._row_number)
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : index + 2
}

function addDuplicateErrors(errors, occurrences, field, label) {
  occurrences.forEach((rowNumbers, value) => {
    if (rowNumbers.length < 2) return

    rowNumbers.forEach((rowNumber) => {
      addError(
        errors,
        rowNumber,
        field,
        `${label} ${value} duplikat di dalam file.`
      )
    })
  })
}

export function validateMachineImportRows(rows) {
  const sourceRows = Array.isArray(rows) ? rows : []
  const errors = []
  const normalizedRows = []
  const tidOccurrences = new Map()
  const snOccurrences = new Map()

  if (sourceRows.length === 0) {
    return {
      rows: [],
      errors: [
        {
          row: null,
          field: null,
          message: "File tidak berisi data mesin.",
        },
      ],
    }
  }

  if (sourceRows.length > MAX_MACHINE_IMPORT_ROWS) {
    return {
      rows: [],
      errors: [
        {
          row: null,
          field: null,
          message: `Maksimal ${MAX_MACHINE_IMPORT_ROWS} baris dalam satu kali upload.`,
        },
      ],
    }
  }

  sourceRows.forEach((row, index) => {
    const rowNumber = getRowNumber(row, index)
    const longitude = parseCoordinate(row?.longitude, -180, 180)
    const latitude = parseCoordinate(row?.latitude, -90, 90)
    const normalized = {
      _row_number: rowNumber,
      tid: normalizeUpperText(row?.tid),
      sn: normalizeUpperText(row?.sn),
      db: normalizeText(row?.db),
      denom: normalizeUpperText(row?.denom),
      kode_cabang: normalizeUpperText(row?.kode_cabang),
      kode_project: normalizeUpperText(row?.kode_project),
      kode_merk: normalizeUpperText(row?.kode_merk),
      jenis_mesin: normalizeUpperText(row?.jenis_mesin),
      nama_model: normalizeText(row?.nama_model),
      lokasi: normalizeText(row?.lokasi),
      site: normalizeUpperText(row?.site || "OFFSITE"),
      kategori_lokasi: normalizeLocationCategory(row?.kategori_lokasi),
      garansi: normalizeUpperText(row?.garansi || "IN WARRANTY"),
      hari_ops: normalizeUpperText(row?.hari_ops || "ALL DAYS"),
      jam_ops: normalizeUpperText(row?.jam_ops || "24 JAM"),
      waktu_ops: normalizeOperationTime(row?.waktu_ops || "00:00 - 23:59"),
      longitude: longitude.value,
      latitude: latitude.value,
      status: normalizeStatus(row?.status),
    }

    normalizedRows.push(normalized)

    if (!normalized.tid) {
      addError(errors, rowNumber, "tid", "TID wajib diisi.")
    } else {
      if (normalized.tid.length > 50) {
        addError(errors, rowNumber, "tid", "TID maksimal 50 karakter.")
      }

      const occurrences = tidOccurrences.get(normalized.tid) || []
      occurrences.push(rowNumber)
      tidOccurrences.set(normalized.tid, occurrences)
    }

    if (!normalized.sn) {
      addError(errors, rowNumber, "sn", "SN wajib diisi.")
    } else {
      if (normalized.sn.length > 100) {
        addError(errors, rowNumber, "sn", "SN maksimal 100 karakter.")
      }

      const occurrences = snOccurrences.get(normalized.sn) || []
      occurrences.push(rowNumber)
      snOccurrences.set(normalized.sn, occurrences)
    }

    if (
      normalized.tid &&
      normalized.sn &&
      normalized.tid === normalized.sn
    ) {
      addError(
        errors,
        rowNumber,
        "sn",
        "TID dan SN pada mesin yang sama tidak boleh memiliki nilai yang sama."
      )
    }

    if (normalized.db.length > 100) {
      addError(errors, rowNumber, "db", "DB maksimal 100 karakter.")
    }

    if (!normalized.denom) {
      addError(errors, rowNumber, "denom", "Denom wajib diisi.")
    } else if (normalized.denom.length > 50) {
      addError(errors, rowNumber, "denom", "Denom maksimal 50 karakter.")
    }

    if (!normalized.kode_cabang) {
      addError(errors, rowNumber, "kode_cabang", "Kode Cabang wajib diisi.")
    } else if (normalized.kode_cabang.length > 30) {
      addError(errors, rowNumber, "kode_cabang", "Kode Cabang maksimal 30 karakter.")
    }

    if (!normalized.kode_project) {
      addError(errors, rowNumber, "kode_project", "Kode Project wajib diisi.")
    } else if (normalized.kode_project.length > 30) {
      addError(errors, rowNumber, "kode_project", "Kode Project maksimal 30 karakter.")
    }

    if (!normalized.kode_merk) {
      addError(errors, rowNumber, "kode_merk", "Kode Merk wajib diisi.")
    } else if (normalized.kode_merk.length > 30) {
      addError(errors, rowNumber, "kode_merk", "Kode Merk maksimal 30 karakter.")
    }

    if (!normalized.jenis_mesin) {
      addError(errors, rowNumber, "jenis_mesin", "Jenis Mesin wajib diisi.")
    } else if (normalized.jenis_mesin.length > 100) {
      addError(errors, rowNumber, "jenis_mesin", "Jenis Mesin maksimal 100 karakter.")
    }

    if (!normalized.nama_model) {
      addError(errors, rowNumber, "nama_model", "Nama Model wajib diisi.")
    } else if (normalized.nama_model.length > 150) {
      addError(errors, rowNumber, "nama_model", "Nama Model maksimal 150 karakter.")
    }

    if (!normalized.lokasi) {
      addError(errors, rowNumber, "lokasi", "Lokasi wajib diisi.")
    } else if (normalized.lokasi.length > 500) {
      addError(errors, rowNumber, "lokasi", "Lokasi maksimal 500 karakter.")
    }

    if (!SITE_VALUES.has(normalized.site)) {
      addError(errors, rowNumber, "site", "Site harus ONSITE atau OFFSITE.")
    }

    if (!normalized.kategori_lokasi) {
      addError(
        errors,
        rowNumber,
        "kategori_lokasi",
        "Kategori Lokasi wajib diisi."
      )
    } else if (!LOCATION_CATEGORY_VALUES.has(normalized.kategori_lokasi)) {
      const suggestion = suggestLocationCategory(normalized.kategori_lokasi)
      const suggestionMessage = suggestion
        ? ` Gunakan "${suggestion}".`
        : " Pilih nilai Kategori Lokasi yang tersedia pada template."

      addError(
        errors,
        rowNumber,
        "kategori_lokasi",
        `Kategori Lokasi "${normalized.kategori_lokasi}" tidak valid.${suggestionMessage}`
      )
    }

    if (!WARRANTY_VALUES.has(normalized.garansi)) {
      addError(
        errors,
        rowNumber,
        "garansi",
        "Garansi harus IN WARRANTY atau OUT WARRANTY."
      )
    }

    if (!OPERATION_DAY_VALUES.has(normalized.hari_ops)) {
      addError(
        errors,
        rowNumber,
        "hari_ops",
        "Hari Operasional harus WEEKDAYS atau ALL DAYS."
      )
    }

    if (!OPERATION_HOUR_VALUES.has(normalized.jam_ops)) {
      addError(
        errors,
        rowNumber,
        "jam_ops",
        "Jam Operasional harus 24 JAM atau NON 24 JAM."
      )
    }

    if (!OPERATION_TIME_VALUES.has(normalized.waktu_ops)) {
      addError(
        errors,
        rowNumber,
        "waktu_ops",
        "Waktu Operasional tidak valid."
      )
    }

    if (
      normalized.jam_ops === "24 JAM" &&
      normalized.waktu_ops !== "00:00 - 23:59"
    ) {
      addError(
        errors,
        rowNumber,
        "waktu_ops",
        "Jam Operasional 24 JAM harus memakai waktu 00:00 - 23:59."
      )
    }

    if (
      normalized.jam_ops === "NON 24 JAM" &&
      normalized.waktu_ops === "00:00 - 23:59"
    ) {
      addError(
        errors,
        rowNumber,
        "waktu_ops",
        "Jam Operasional NON 24 JAM harus memakai rentang waktu non-24 jam."
      )
    }

    if (longitude.error) {
      addError(errors, rowNumber, "longitude", `Longitude ${longitude.error}`)
    }

    if (latitude.error) {
      addError(errors, rowNumber, "latitude", `Latitude ${latitude.error}`)
    }

    if (!MACHINE_STATUSES.has(normalized.status)) {
      addError(errors, rowNumber, "status", "Status harus AKTIF atau NONAKTIF.")
    }
  })

  addDuplicateErrors(errors, tidOccurrences, "tid", "TID")
  addDuplicateErrors(errors, snOccurrences, "sn", "SN")

  return { rows: normalizedRows, errors }
}
