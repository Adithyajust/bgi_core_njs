import { createMachineKeyMatrixConfig } from "@/modules/machine-key/matrix-config"

export function getMachineKeyMatrixConfig() {
  return createMachineKeyMatrixConfig({
    wallCount: process.env.MACHINE_KEY_MATRIX_WALL_COUNT,
    columnCount: process.env.MACHINE_KEY_MATRIX_COLUMN_COUNT,
    rowCount: process.env.MACHINE_KEY_MATRIX_ROW_COUNT,
  })
}
