export const MACHINE_KEY_MATRIX_LIMITS = Object.freeze({
  wallCount: Object.freeze({ minimum: 1, maximum: 9 }),
  columnCount: Object.freeze({ minimum: 1, maximum: 26 }),
  rowCount: Object.freeze({ minimum: 1, maximum: 99 }),
})

export const MACHINE_KEY_MATRIX_DEFAULTS = Object.freeze({
  wallCount: 5,
  columnCount: 26,
  rowCount: 15,
})

function normalizeCount(value, fallback, limits) {
  const count = Number(value)

  if (!Number.isSafeInteger(count)) return fallback
  return Math.min(Math.max(count, limits.minimum), limits.maximum)
}

export function createMachineKeyMatrixConfig(input = {}) {
  const wallCount = normalizeCount(
    input.wallCount ?? input.wall_count,
    MACHINE_KEY_MATRIX_DEFAULTS.wallCount,
    MACHINE_KEY_MATRIX_LIMITS.wallCount
  )
  const columnCount = normalizeCount(
    input.columnCount ?? input.column_count,
    MACHINE_KEY_MATRIX_DEFAULTS.columnCount,
    MACHINE_KEY_MATRIX_LIMITS.columnCount
  )
  const rowCount = normalizeCount(
    input.rowCount ?? input.row_count,
    MACHINE_KEY_MATRIX_DEFAULTS.rowCount,
    MACHINE_KEY_MATRIX_LIMITS.rowCount
  )

  const walls = Object.freeze(
    Array.from({ length: wallCount }, (_, index) => `A${index + 1}`)
  )
  const columns = Object.freeze(
    Array.from({ length: columnCount }, (_, index) =>
      String.fromCharCode("A".charCodeAt(0) + index)
    )
  )
  const rows = Object.freeze(
    Array.from({ length: rowCount }, (_, index) =>
      String(index + 1).padStart(2, "0")
    )
  )

  return Object.freeze({
    wallCount,
    columnCount,
    rowCount,
    walls,
    columns,
    rows,
    totalSlots: wallCount * columnCount * rowCount,
  })
}

export const DEFAULT_MACHINE_KEY_MATRIX_CONFIG = createMachineKeyMatrixConfig()

export function serializeMachineKeyMatrixConfig(config = DEFAULT_MACHINE_KEY_MATRIX_CONFIG) {
  const normalized = createMachineKeyMatrixConfig(config)

  return {
    wall_count: normalized.wallCount,
    column_count: normalized.columnCount,
    row_count: normalized.rowCount,
    walls: [...normalized.walls],
    columns: [...normalized.columns],
    rows: [...normalized.rows],
    total_slots: normalized.totalSlots,
  }
}
