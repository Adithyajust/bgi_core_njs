import {
  MATRIX_MAPPING_STATUSES,
  resolveMatrixMappingStatus,
} from "./constants.js"
import { DEFAULT_MACHINE_KEY_MATRIX_CONFIG } from "./matrix-config.js"

function normalizeText(value) {
  return String(value || "").trim().toUpperCase()
}

export function buildMatrixSlotId(
  wall,
  column,
  row,
  matrixConfig = DEFAULT_MACHINE_KEY_MATRIX_CONFIG
) {
  const normalizedWall = normalizeText(wall)
  const normalizedColumn = normalizeText(column)
  const normalizedRow = String(row || "").trim().padStart(2, "0")

  if (
    !matrixConfig.walls.includes(normalizedWall) ||
    !matrixConfig.columns.includes(normalizedColumn) ||
    !matrixConfig.rows.includes(normalizedRow)
  ) {
    return ""
  }

  return `${normalizedWall}-${normalizedColumn}-${normalizedRow}`
}

export function resolveMatrixSlotStatus({
  wall,
  column,
  row,
  selectedWall,
  selectedColumn,
  selectedRow,
  machineId,
  persistedStatus,
  matrixConfig = DEFAULT_MACHINE_KEY_MATRIX_CONFIG,
} = {}) {
  const slotId = buildMatrixSlotId(wall, column, row, matrixConfig)
  const selectedSlotId = buildMatrixSlotId(
    selectedWall,
    selectedColumn,
    selectedRow,
    matrixConfig
  )

  if (persistedStatus === MATRIX_MAPPING_STATUSES.OUT.value) {
    return MATRIX_MAPPING_STATUSES.OUT
  }

  if (persistedStatus === MATRIX_MAPPING_STATUSES.AVAILABLE.value) {
    return MATRIX_MAPPING_STATUSES.AVAILABLE
  }

  if (slotId && slotId === selectedSlotId) {
    return resolveMatrixMappingStatus(machineId)
  }

  return MATRIX_MAPPING_STATUSES.UNMAPPED
}
