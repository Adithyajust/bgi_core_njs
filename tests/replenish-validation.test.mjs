import assert from "node:assert/strict"
import test from "node:test"

import { validateReplenishPayload } from "../modules/replenish/validation.js"

const validPayload = {
  uker_id: 1,
  activity_type: "NORMAL",
  schedule_date: "2026-08-05",
  departure_time: "08:00",
  estimated_finish_time: "17:00",
  priority: "TINGGI",
  vehicle_id: 10,
  custody_id: 11,
  driver_id: 12,
  escort_name: "Bripka Budi Santoso",
  route_notes: "Rute prioritas pusat kota",
  notes: "Pastikan akses lokasi tersedia",
  points: [
    { machine_id: 100, requested_amount: "500000000", notes: "Point pertama" },
    { machine_id: 101, requested_amount: "250.000.000", notes: "Point kedua" },
  ],
}

test("normalizes a valid replenish work order", () => {
  const result = validateReplenishPayload(validPayload)

  assert.equal(result.error, null)
  assert.equal(result.data.activityType, "NORMAL")
  assert.equal(result.data.points.length, 2)
  assert.equal(result.data.points[1].requestedAmount, 250000000)
  assert.equal(result.data.custodyId, 11)
  assert.equal(result.data.driverId, 12)
  assert.equal(result.data.escortName, "Bripka Budi Santoso")
})

test("requires different custody and driver employees", () => {
  const result = validateReplenishPayload({
    ...validPayload,
    driver_id: validPayload.custody_id,
  })

  assert.match(result.error, /harus orang yang berbeda/i)
})

test("requires a free-text escort name", () => {
  assert.match(
    validateReplenishPayload({ ...validPayload, escort_name: "" }).error,
    /Petugas Pengawalan wajib diisi/i
  )

  assert.match(
    validateReplenishPayload({ ...validPayload, escort_name: "x".repeat(201) }).error,
    /maksimal 200 karakter/i
  )
})

test("rejects duplicate ATM or CRM points", () => {
  const result = validateReplenishPayload({
    ...validPayload,
    points: [
      { machine_id: 100, requested_amount: 1 },
      { machine_id: 100, requested_amount: 2 },
    ],
  })

  assert.match(result.error, /tidak boleh dipilih lebih dari sekali/i)
})

test("rejects work orders without a point", () => {
  const result = validateReplenishPayload({ ...validPayload, points: [] })
  assert.match(result.error, /Minimal satu ATM\/CRM/i)
})

test("rejects more than fifty points", () => {
  const points = Array.from({ length: 51 }, (_, index) => ({
    machine_id: index + 1,
    requested_amount: 1000,
  }))
  const result = validateReplenishPayload({ ...validPayload, points })
  assert.match(result.error, /Maksimal 50/i)
})

test("rejects invalid activity, date, time, and amount", () => {
  assert.match(
    validateReplenishPayload({ ...validPayload, activity_type: "INVALID" }).error,
    /Jenis aktivitas/i
  )
  assert.match(
    validateReplenishPayload({ ...validPayload, schedule_date: "2026-02-30" }).error,
    /Tanggal kegiatan/i
  )
  assert.match(
    validateReplenishPayload({ ...validPayload, departure_time: "27:00" }).error,
    /Jam keberangkatan/i
  )
  assert.match(
    validateReplenishPayload({
      ...validPayload,
      points: [{ machine_id: 1, requested_amount: "abc" }],
    }).error,
    /Nominal kebutuhan/i
  )
})
