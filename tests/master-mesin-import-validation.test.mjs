import assert from "node:assert/strict"
import test from "node:test"

import {
  validateMachineImportRows,
} from "../modules/master-mesin/import-validation.js"

function createValidRow(overrides = {}) {
  return {
    _row_number: 2,
    tid: "TID0001",
    sn: "SN0001",
    db: "DB01",
    denom: "50.000 / 100.000",
    kode_cabang: "BR001",
    kode_project: "PRJ001",
    kode_merk: "NCR",
    jenis_mesin: "ATM",
    nama_model: "SelfServ 84",
    lokasi: "KC Jakarta",
    site: "OFFSITE",
    kategori_lokasi: "KC",
    garansi: "IN WARRANTY",
    hari_ops: "ALL DAYS",
    jam_ops: "24 JAM",
    waktu_ops: "00:00 - 23:59",
    longitude: "106.816666",
    latitude: "-6.200000",
    status: "AKTIF",
    ...overrides,
  }
}

test("normalizes a valid machine import row", () => {
  const result = validateMachineImportRows([
    createValidRow({ tid: " tid0001 ", sn: " sn0001 " }),
  ])

  assert.equal(result.errors.length, 0)
  assert.equal(result.rows[0].tid, "TID0001")
  assert.equal(result.rows[0].sn, "SN0001")
  assert.equal(result.rows[0].denom, "50.000 / 100.000")
  assert.equal(result.rows[0].longitude, 106.816666)
  assert.equal(result.rows[0].status, "AKTIF")
})

test("requires and normalizes denom in machine uploads", () => {
  const normalized = validateMachineImportRows([
    createValidRow({ denom: "  50.000 / 100.000  " }),
  ])
  assert.equal(normalized.errors.length, 0)
  assert.equal(normalized.rows[0].denom, "50.000 / 100.000")

  const missing = validateMachineImportRows([createValidRow({ denom: "" })])
  assert.ok(
    missing.errors.some(
      (error) => error.field === "denom" && /wajib diisi/.test(error.message)
    )
  )
})

test("rejects denom longer than 50 characters during upload", () => {
  const result = validateMachineImportRows([
    createValidRow({ denom: "1".repeat(51) }),
  ])

  assert.ok(
    result.errors.some(
      (error) => error.field === "denom" && /maksimal 50 karakter/.test(error.message)
    )
  )
})

test("rejects duplicate TID and duplicate SN inside one upload", () => {
  const result = validateMachineImportRows([
    createValidRow({ _row_number: 2 }),
    createValidRow({ _row_number: 3 }),
  ])

  assert.ok(result.errors.some((error) => error.field === "tid"))
  assert.ok(result.errors.some((error) => error.field === "sn"))
  assert.ok(result.errors.some((error) => error.row === 2))
  assert.ok(result.errors.some((error) => error.row === 3))
})

test("rejects equal TID and SN in the same machine", () => {
  const result = validateMachineImportRows([
    createValidRow({ tid: "IDENTIFIER-01", sn: "identifier-01" }),
  ])

  assert.ok(
    result.errors.some(
      (error) =>
        error.field === "sn" &&
        error.message.includes("tidak boleh memiliki nilai yang sama")
    )
  )
})

test("rejects invalid operation pairing", () => {
  const result = validateMachineImportRows([
    createValidRow({ jam_ops: "NON 24 JAM", waktu_ops: "00:00 - 23:59" }),
  ])

  assert.ok(result.errors.some((error) => error.field === "waktu_ops"))
})

test("normalizes hidden spaces and common location category variants", () => {
  const result = validateMachineImportRows([
    createValidRow({
      kategori_lokasi: "  instansi\u00a0pemerintah  ",
    }),
  ])

  assert.equal(result.errors.length, 0)
  assert.equal(result.rows[0].kategori_lokasi, "INSTANSI PEMERINTAHAN")
})

test("returns the invalid location category value and a correction suggestion", () => {
  const result = validateMachineImportRows([
    createValidRow({ kategori_lokasi: "RUMAH SAKITT" }),
  ])

  const categoryError = result.errors.find(
    (error) => error.field === "kategori_lokasi"
  )

  assert.ok(categoryError)
  assert.match(categoryError.message, /RUMAH SAKITT/)
  assert.match(categoryError.message, /RUMAH SAKIT/)
})

test("accepts PERTOKOAN as a location category", () => {
  const result = validateMachineImportRows([
    createValidRow({ kategori_lokasi: "PERTOKOAN" }),
  ])

  assert.equal(result.errors.length, 0)
  assert.equal(result.rows[0].kategori_lokasi, "PERTOKOAN")
})

test("normalizes TOKO to PERTOKOAN", () => {
  const result = validateMachineImportRows([
    createValidRow({ kategori_lokasi: "toko" }),
  ])

  assert.equal(result.errors.length, 0)
  assert.equal(result.rows[0].kategori_lokasi, "PERTOKOAN")
})

test("accepts the expanded official location category list", () => {
  const expandedCategories = [
    "BIKE THRU",
    "BRI AGRO",
    "DRIVE THRU",
    "GTI",
    "KANINS",
    "KANWIL",
    "KLINIK",
    "PABRIK",
    "PANGKALAN MILITER",
    "PELABUHAN",
    "PERKEBUNAN",
    "PERTAMBANGAN",
    "RUMAH MAKAN",
    "TEMPAT IBADAH",
    "TERMINAL",
  ]

  expandedCategories.forEach((kategori_lokasi, index) => {
    const result = validateMachineImportRows([
      createValidRow({
        tid: `TID-EXP-${index}`,
        sn: `SN-EXP-${index}`,
        kategori_lokasi,
      }),
    ])

    assert.equal(result.errors.length, 0)
    assert.equal(result.rows[0].kategori_lokasi, kategori_lokasi)
  })
})

test("accepts APOTEK, TERAS BRI, and KANTOR PUSAT location categories", () => {
  for (const kategori_lokasi of ["APOTEK", "TERAS BRI", "KANTOR PUSAT"]) {
    const result = validateMachineImportRows([
      createValidRow({ kategori_lokasi }),
    ])

    assert.equal(result.errors.length, 0)
    assert.equal(result.rows[0].kategori_lokasi, kategori_lokasi)
  }
})

test("normalizes common aliases for the new location categories", () => {
  const rows = [
    createValidRow({ _row_number: 2, tid: "TID-A", sn: "SN-A", kategori_lokasi: "apotik" }),
    createValidRow({ _row_number: 3, tid: "TID-B", sn: "SN-B", kategori_lokasi: "terasbri" }),
    createValidRow({ _row_number: 4, tid: "TID-C", sn: "SN-C", kategori_lokasi: "kantorpusat" }),
  ]
  const result = validateMachineImportRows(rows)

  assert.equal(result.errors.length, 0)
  assert.deepEqual(
    result.rows.map((row) => row.kategori_lokasi),
    ["APOTEK", "TERAS BRI", "KANTOR PUSAT"]
  )
})

test("accepts and normalizes 09:00 - 15:00 for NON 24 JAM", () => {
  const result = validateMachineImportRows([
    createValidRow({
      jam_ops: "NON 24 JAM",
      waktu_ops: "09.00–15.00",
    }),
  ])

  assert.equal(result.errors.length, 0)
  assert.equal(result.rows[0].waktu_ops, "09:00 - 15:00")
})
