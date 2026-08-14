import test from "node:test"
import assert from "node:assert/strict"

import { validateMachinePayload } from "../modules/master-mesin/validation.js"

const validPayload = {
  tid: "tid-001",
  sn: "sn-001",
  denom: "50.000 / 100.000",
  cabang_id: 1,
  project_id: 1,
  lokasi: "Jakarta",
  site: "ONSITE",
  tipe_mesin_id: 1,
  kategori_mesin: "ATM",
  kategori_lokasi: "KC",
  garansi: "IN WARRANTY",
  hari_ops: "ALL DAYS",
  jam_ops: "24 JAM",
  waktu_ops: "00:00 - 23:59",
  longitude: 106.8,
  latitude: -6.2,
  is_active: true,
}

test("normalizes valid machine payload", () => {
  const result = validateMachinePayload(validPayload)
  assert.equal(result.error, null)
  assert.equal(result.data.tid, "TID-001")
  assert.equal(result.data.sn, "SN-001")
  assert.equal(result.data.denom, "50.000 / 100.000")
})

test("requires denom in the machine form", () => {
  const result = validateMachinePayload({ ...validPayload, denom: "" })

  assert.equal(result.data, null)
  assert.match(result.error, /Denom wajib diisi/)
})

test("normalizes denom and rejects values longer than 50 characters", () => {
  const normalized = validateMachinePayload({
    ...validPayload,
    denom: "  50.000 / 100.000  ",
  })
  assert.equal(normalized.error, null)
  assert.equal(normalized.data.denom, "50.000 / 100.000")

  const tooLong = validateMachinePayload({
    ...validPayload,
    denom: "1".repeat(51),
  })
  assert.match(tooLong.error, /Denom maksimal 50 karakter/)
})

test("rejects incompatible operation hours", () => {
  const result = validateMachinePayload({
    ...validPayload,
    jam_ops: "NON 24 JAM",
    waktu_ops: "00:00 - 23:59",
  })
  assert.match(result.error, /NON 24 JAM/)
})

test("rejects invalid coordinates", () => {
  const result = validateMachinePayload({ ...validPayload, latitude: 100 })
  assert.match(result.error, /Latitude/)
})

test("rejects identical TID and SN", () => {
  const result = validateMachinePayload({
    ...validPayload,
    tid: "SAME-IDENTIFIER",
    sn: "same-identifier",
  })

  assert.equal(result.data, null)
  assert.match(result.error, /TID dan SN tidak boleh/)
})

test("normalizes a common location category alias", () => {
  const result = validateMachinePayload({
    ...validPayload,
    kategori_lokasi: "mini-market",
  })

  assert.equal(result.error, null)
  assert.equal(result.data.kategoriLokasi, "MINI MARKET")
})

test("accepts new location categories in the machine form", () => {
  for (const kategori_lokasi of ["APOTEK", "TERAS BRI", "KANTOR PUSAT"]) {
    const result = validateMachinePayload({
      ...validPayload,
      kategori_lokasi,
    })

    assert.equal(result.error, null)
    assert.equal(result.data.kategoriLokasi, kategori_lokasi)
  }
})

test("accepts 09:00 - 15:00 for NON 24 JAM in the machine form", () => {
  const result = validateMachinePayload({
    ...validPayload,
    jam_ops: "NON 24 JAM",
    waktu_ops: "09.00-15.00",
  })

  assert.equal(result.error, null)
  assert.equal(result.data.waktuOps, "09:00 - 15:00")
})

test("accepts all additional official location categories in machine form", () => {
  const categories = [
    "BIKE THRU", "BRI AGRO", "DRIVE THRU", "GTI", "KANINS", "KANWIL",
    "KLINIK", "PABRIK", "PANGKALAN MILITER", "PELABUHAN", "PERKEBUNAN",
    "PERTAMBANGAN", "RUMAH MAKAN", "TEMPAT IBADAH", "TERMINAL",
  ]

  categories.forEach((kategori_lokasi) => {
    const result = validateMachinePayload({
      ...validPayload,
      kategori_lokasi,
    })

    assert.equal(result.error, null)
    assert.equal(result.data.kategoriLokasi, kategori_lokasi)
  })
})
