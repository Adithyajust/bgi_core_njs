import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { DETAIL_HEADERS, HEADERS, SHEETS, normalizeRows, parseWorkbook } from "../modules/rpl-terjadwal/workbook.js"
import { PARAMETER_HEADERS, PARAMETER_SHEET, parseParameterWorkbook, validateParameter, applyParameterSnapshot } from "../modules/rpl-terjadwal/parameters.js"
import { buildReport } from "../modules/rpl-terjadwal/calculations.js"
import { xlsxFixture } from "./helpers/rpl-xlsx.mjs"

const detail = ["15", "00123", "Lokasi asli", "ATM", "Barat", "4000", "Ya", "Penyebab", "Kendala", "Catatan"]
const profile = ["00123", "Lokasi terbaru", "BG UJI", "ATM", "100000", "FLM 1", "Timur", "SUB 1"]
const parametersFile = rows => xlsxFixture({ [PARAMETER_SHEET]: [PARAMETER_HEADERS, ...rows] })
const workbook = () => xlsxFixture({ [SHEETS[0]]: [DETAIL_HEADERS.planning, detail], [SHEETS[1]]: [DETAIL_HEADERS.dsr, detail] })

test("user reference accepts the new headers and exactly 50 standalone parameters", async () => {
  const bytes = await readFile(new URL("./fixtures/rpl-upload-v4-reference.xlsx", import.meta.url))
  const data = parseWorkbook(bytes, "2026-09")
  assert.equal(data.error_count, 2)
  assert.ok(data.errors.every(e => e.message === "Sheet tidak memiliki data."))
  assert.equal(data.parameters.length, 0)
  const parameters = parseParameterWorkbook(bytes)
  assert.equal(parameters.error_count, 0); assert.equal(parameters.rows.length, 50)
  assert.equal(parameters.rows[0].tid, "790121"); assert.equal(parameters.rows[0].denom, "All Denom")
  assert.ok(parameters.rows.some(p => p.tid === "T0200066"))
})
test("new planning and DSR map flags from G and all three notes from H-J", () => {
  const data = parseWorkbook(workbook(), "2026-08")
  assert.equal(data.error_count, 0)
  for (const row of [data.planning[0], data.dsr[0]]) {
    assert.equal(row.cause, "Penyebab"); assert.equal(row.obstacle, "Kendala"); assert.equal(row.note, "Catatan")
    assert.equal(row.forecast, true); assert.equal(row.realized, true); assert.equal(row.status, "Sesuai")
    assert.equal(row.tid, "00123"); assert.equal(row.sheets, 4000)
  }
})
test("old and new formats produce the same business results", () => {
  const old = ["15", "00123", "Lokasi asli", "ATM", "Barat", "4000", "Ya", "Ya", "wrong cached status", "Penyebab", "Kendala", "Catatan"]
  const legacy = xlsxFixture({ [SHEETS[0]]: [HEADERS, old], [SHEETS[1]]: [HEADERS, old] })
  const before = parseWorkbook(legacy, "2026-08"), after = parseWorkbook(workbook(), "2026-08")
  assert.deepEqual(after.summary, before.summary); assert.deepEqual(after.planning, before.planning); assert.deepEqual(after.dsr, before.dsr)
})
test("new DSR validates G even when H contains Ya, and validates actual month length", () => {
  const v = [...detail]; v[0] = "31"; v[6] = ""; v[7] = "Ya"
  const data = normalizeRows([{ row: 7, values: DETAIL_HEADERS.dsr }, { row: 8, values: v }], "dsr", "2026-02")
  assert.match(data.errors[0].message, /1–28/); assert.match(data.errors[0].message, /Realisasi/)
})
test("parameter-only workbook needs no period or detail sheets and preserves zero prefixes", () => {
  const p = parseParameterWorkbook(parametersFile([profile]))
  assert.equal(p.error_count, 0); assert.equal(p.rows[0].tid, "00123")
  assert.equal(p.rows[0].cluster, "Timur"); assert.equal(p.rows[0].denom, "100000")
})
test("parameter import rejects case-insensitive duplicate TIDs before persistence", () => {
  const p = parseParameterWorkbook(parametersFile([["tid1", ...profile.slice(1)], ["TID1", ...profile.slice(1)]]))
  assert.equal(p.error_count, 1); assert.match(p.errors[0].message, /berulang/)
})
test("invalid parameter values and unknown extra columns are rejected", () => {
  for (const [column, value] of [[0, "has space"], [1, ""], [2, ""], [3, "EDC"], [4, "75000"], [4, ""], [6, ""], [1, "x".repeat(251)]]) {
    const row = [...profile]; row[column] = value
    assert.equal(parseParameterWorkbook(parametersFile([row])).error_count, 1, `${column}: ${value}`)
  }
  assert.equal(parseParameterWorkbook(parametersFile([[...profile, "extra"]])).error_count, 1)
  assert.throws(() => parseParameterWorkbook(workbook()), /rpl_tid_parameter/)
  assert.throws(() => validateParameter(null), /tidak valid/)
})
test("optional FLM/subcluster may be blank while numeric TIDs and denominations normalize", () => {
  const row = [...profile]; row[5] = ""; row[7] = ""; row[4] = "50.000"
  const result = parseParameterWorkbook(parametersFile([row]))
  assert.equal(result.error_count, 0); assert.equal(result.rows[0].denom, "50000")
})
test("master snapshot overrides matching metadata, preserves transaction inputs and leaves absent TIDs unchanged", () => {
  const data = parseWorkbook(workbook(), "2026-08")
  data.parameters[0].avg_daily_transaction = 123456.78
  const before = JSON.stringify(data)
  const master = { revision: 4, items: parseParameterWorkbook(parametersFile([profile, ["OTHER", ...profile.slice(1)]])).rows }
  const result = applyParameterSnapshot(data, master)
  assert.equal(JSON.stringify(data), before); assert.equal(result.parameter_revision, 4)
  assert.equal(result.parameters.length, 1); assert.equal(result.parameters[0].avg_daily_transaction, 123456.78)
  assert.equal(result.planning[0].location, "Lokasi asli"); assert.equal(result.planning[0].sheets, 4000)
  assert.equal(result.planning[0].denom, "100000"); assert.deepEqual(result.summary, data.summary)
  const report = buildReport({ ...result, reporting_unit: "BG UJI" })
  assert.equal(report.schedule.items[0].location, "Lokasi terbaru"); assert.equal(report.details.items[0].cluster, "Timur")
  assert.equal(report.grand.planning_cash, 400000000); assert.equal(report.summary.forecast_accuracy, 1)
  master.items[0].denom = "50000"
  assert.equal(result.parameters[0].denom, "100000")
  const missing = applyParameterSnapshot(data, { revision: 5, items: [] })
  assert.equal(missing.parameters[0].denom, null); assert.equal(buildReport(missing).grand.planning_cash, null)
})
test("independent blank parameter template contains only its required sheet and no uploadable data", async () => {
  const bytes = await readFile(new URL("../modules/rpl-terjadwal/templates/RPL-Template-Parameter.xlsx", import.meta.url))
  const data = parseParameterWorkbook(bytes)
  assert.equal(data.rows.length, 0); assert.equal(data.error_count, 1)
  assert.equal(data.errors[0].message, "Sheet parameter tidak memiliki data.")
})
