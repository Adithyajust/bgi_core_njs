import assert from "node:assert/strict"
import test from "node:test"

import { validateReplenishPayload } from "../modules/replenish/validation.js"

const validPayload = {
  uker_id: 1,
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
    { machine_id: 100, activity_type: "NORMAL", pagu: 4000, notes: "Point pertama" },
    { machine_id: 101, activity_type: "PENGOSONGAN", pagu: null, notes: "Point kedua" },
  ],
}

test("normalizes point-level activity and pagu for a replenish work order", () => {
  const result = validateReplenishPayload(validPayload)

  assert.equal(result.error, null)
  assert.equal(result.data.activityType, "CAMPURAN")
  assert.equal(result.data.points.length, 2)
  assert.equal(result.data.points[0].activityType, "NORMAL")
  assert.equal(result.data.points[0].pagu, 4000)
  assert.equal(result.data.points[1].activityType, "PENGOSONGAN")
  assert.equal(result.data.points[1].pagu, null)
  assert.equal(result.data.custodyId, 11)
  assert.equal(result.data.driverId, 12)
  assert.equal(result.data.escortName, "Bripka Budi Santoso")
})

test("derives a single work-order activity when all points use the same activity", () => {
  const result = validateReplenishPayload({
    ...validPayload,
    points: validPayload.points.map((point) => ({
      ...point,
      activity_type: "PERDANA",
      pagu: point.pagu || 2000,
    })),
  })

  assert.equal(result.error, null)
  assert.equal(result.data.activityType, "PERDANA")
})


test("requires pagu for NORMAL and PERDANA activities", () => {
  for (const activityType of ["NORMAL", "PERDANA"]) {
    const result = validateReplenishPayload({
      ...validPayload,
      points: [{ machine_id: 100, activity_type: activityType, pagu: null }],
    })

    assert.match(result.error, /Pagu.+wajib dipilih/i)
  }
})

test("forces pagu to null for PENGOSONGAN even when an old client sends a value", () => {
  const result = validateReplenishPayload({
    ...validPayload,
    points: [{ machine_id: 100, activity_type: "PENGOSONGAN", pagu: 8000, notes: "Kosongkan seluruh kas" }],
  })

  assert.equal(result.error, null)
  assert.equal(result.data.points[0].pagu, null)
  assert.equal(result.data.points[0].notes, "Kosongkan seluruh kas")
})

test("accepts the legacy work-order activity only as a point fallback", () => {
  const result = validateReplenishPayload({
    ...validPayload,
    activity_type: "NORMAL",
    points: validPayload.points.map((point) => {
      const legacyPoint = { ...point }
      delete legacyPoint.activity_type
      return {
        ...legacyPoint,
        pagu: legacyPoint.pagu || 2000,
      }
    }),
  })

  assert.equal(result.error, null)
  assert.equal(result.data.points[0].activityType, "NORMAL")
  assert.equal(result.data.activityType, "NORMAL")
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
      { machine_id: 100, activity_type: "NORMAL", pagu: 2000 },
      { machine_id: 100, activity_type: "NORMAL", pagu: 4000 },
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
    activity_type: "NORMAL",
    pagu: 2000,
  }))
  const result = validateReplenishPayload({ ...validPayload, points })
  assert.match(result.error, /Maksimal 50/i)
})

test("rejects invalid point activity, pagu, date, and time", () => {
  assert.match(
    validateReplenishPayload({
      ...validPayload,
      points: [{ machine_id: 1, activity_type: "INVALID", pagu: 2000 }],
    }).error,
    /Jenis aktivitas/i
  )
  assert.match(
    validateReplenishPayload({
      ...validPayload,
      points: [{ machine_id: 1, activity_type: "NORMAL", pagu: 3000 }],
    }).error,
    /Pagu/i
  )
  assert.match(
    validateReplenishPayload({ ...validPayload, schedule_date: "2026-02-30" }).error,
    /Tanggal kegiatan/i
  )
  assert.match(
    validateReplenishPayload({ ...validPayload, departure_time: "27:00" }).error,
    /Jam keberangkatan/i
  )
})
