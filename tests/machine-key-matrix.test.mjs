import assert from "node:assert/strict"
import test from "node:test"

import {
  buildMatrixSlotId,
  resolveMatrixSlotStatus,
} from "../modules/machine-key/matrix.js"
import { createMachineKeyMatrixConfig } from "../modules/machine-key/matrix-config.js"

test("matrix slot ID follows wall, column, and row composition", () => {
  assert.equal(buildMatrixSlotId("A3", "H", "8"), "A3-H-08")
  assert.equal(buildMatrixSlotId("A5", "Z", "15"), "A5-Z-15")
  assert.equal(buildMatrixSlotId("A6", "H", "08"), "")
})

test("matrix dimensions are generated dynamically from counts", () => {
  const config = createMachineKeyMatrixConfig({
    wallCount: 4,
    columnCount: 10,
    rowCount: 12,
  })

  assert.deepEqual(config.walls, ["A1", "A2", "A3", "A4"])
  assert.equal(config.columns.at(-1), "J")
  assert.equal(config.rows.at(-1), "12")
  assert.equal(config.totalSlots, 480)
  assert.equal(buildMatrixSlotId("A4", "J", "12", config), "A4-J-12")
  assert.equal(buildMatrixSlotId("A5", "J", "12", config), "")
})

test("unmapped matrix slots are yellow", () => {
  assert.deepEqual(
    resolveMatrixSlotStatus({
      wall: "A1",
      column: "B",
      row: "01",
      selectedWall: "A1",
      selectedColumn: "D",
      selectedRow: "04",
      machineId: "100",
    }),
    {
      value: "UNMAPPED",
      label: "Kuning · Belum dimapping TID",
      tone: "unmapped",
    }
  )
})

test("selected slot becomes green after it is mapped to a TID", () => {
  assert.deepEqual(
    resolveMatrixSlotStatus({
      wall: "A3",
      column: "H",
      row: "08",
      selectedWall: "A3",
      selectedColumn: "H",
      selectedRow: "08",
      machineId: "520627",
    }),
    {
      value: "IN",
      label: "Hijau · Tersedia",
      tone: "available",
    }
  )
})

test("persisted OUT status remains red", () => {
  assert.deepEqual(
    resolveMatrixSlotStatus({
      wall: "A2",
      column: "G",
      row: "06",
      selectedWall: "A2",
      selectedColumn: "G",
      selectedRow: "06",
      machineId: "520627",
      persistedStatus: "OUT",
    }),
    {
      value: "OUT",
      label: "Merah · Kunci keluar",
      tone: "out",
    }
  )
})
