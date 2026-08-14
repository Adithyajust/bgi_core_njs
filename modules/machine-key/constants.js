import { DEFAULT_MACHINE_KEY_MATRIX_CONFIG } from "./matrix-config.js"

export const MACHINE_KEY_TYPES = Object.freeze([
  {
    value: "REPLENISH",
    label: "Kunci Replenish",
    barcodeCode: "R",
    barcodeCodeConfirmed: true,
  },
  {
    value: "FLM",
    label: "Kunci First Level Maintenance",
    barcodeCode: "F",
    barcodeCodeConfirmed: true,
  },
  {
    value: "BACKUP",
    label: "Kunci Backup",
    barcodeCode: "",
    barcodeCodeConfirmed: false,
  },
])

// Alias kompatibilitas untuk modul lain yang masih memakai konfigurasi bawaan.
export const MATRIX_WALLS = DEFAULT_MACHINE_KEY_MATRIX_CONFIG.walls
export const MATRIX_COLUMNS = DEFAULT_MACHINE_KEY_MATRIX_CONFIG.columns
export const MATRIX_ROWS = DEFAULT_MACHINE_KEY_MATRIX_CONFIG.rows

export const MACHINE_KEY_DEFAULT_STATUS = "IN"

export const MATRIX_MAPPING_STATUSES = Object.freeze({
  UNMAPPED: Object.freeze({
    value: "UNMAPPED",
    label: "Kuning · Belum dimapping TID",
    tone: "unmapped",
  }),
  AVAILABLE: Object.freeze({
    value: "IN",
    label: "Hijau · Tersedia",
    tone: "available",
  }),
  OUT: Object.freeze({
    value: "OUT",
    label: "Merah · Kunci keluar",
    tone: "out",
  }),
})

export function findMachineKeyType(value) {
  return MACHINE_KEY_TYPES.find((item) => item.value === value) || null
}

export function resolveMatrixMappingStatus(machineId) {
  return String(machineId || "").trim()
    ? MATRIX_MAPPING_STATUSES.AVAILABLE
    : MATRIX_MAPPING_STATUSES.UNMAPPED
}
