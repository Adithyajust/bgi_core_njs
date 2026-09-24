import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { buildReport, DEFAULT_SETTINGS, evaluateRows, normalizeDenom, validateEdit } from "../modules/rpl-terjadwal/calculations.js"
import { HEADERS, normalizeRows, parseWorkbook, worksheetRows } from "../modules/rpl-terjadwal/workbook.js"

const row = (source_row, tid, day, selected = true, sheets = 4000) => ({ source_row, tid, event_date: `2026-08-${String(day).padStart(2, "0")}`, selected, sheets, location: `Lokasi ${tid}`, machine_type: "ATM", cluster: "Barat", cause: "", obstacle: "", note: "" })
const fixture = (values = {}) => ({ id: 1, revision: 0, period: "2026-08", period_label: "Agustus 2026", reporting_unit: "BG UJI", planning: [row(8, "001", 1), row(9, "001", 10)], dsr: [row(8, "001", 1), row(9, "002", 3)], parameters: [{ tid: "001", denom: "50000", avg_daily_transaction: 10000000 }], ...values })

test("optional Denom M preserves original A–L headers and validates values", () => {
  assert.equal(normalizeDenom("50.000"), "50000")
  assert.equal(normalizeDenom("ALL DENOM"), "All Denom")
  assert.throws(() => normalizeDenom("abc"), /Denom/)
  const header = { row: 7, values: [...HEADERS, "Denom"] }
  const values = ["1", "001", "Lokasi", "ATM", "Barat", "4000", "Ya", "", "", "", "", "", "100000"]
  const result = normalizeRows([header, { row: 8, values }], "planning", "2026-08")
  assert.equal(result.rows[0].denom, "100000")
  assert.equal(result.errors.length, 0)
  const bad = normalizeRows([header, { row: 8, values: [...values.slice(0, 12), "not money"] }], "planning", "2026-08")
  assert.match(bad.errors[0].message, /Denom/)
})

test("self-closing empty rows do not consume the following row", () => {
  const rows = worksheetRows('<worksheet><row r="1"/><row r="2"><c r="B2"><v>123</v></c></row></worksheet>', [])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].row, 2)
  assert.equal(rows[0].values[1], "123")
})

test("the delivered namespaced template is accepted and only needs user input rows", async () => {
  const bytes = await readFile(new URL("../modules/rpl-terjadwal/templates/RPL-Template-Upload.xlsx", import.meta.url))
  const result = parseWorkbook(bytes, "2026-08")
  assert.equal(result.error_count, 2)
  assert.ok(result.errors.every(e => e.message === "Sheet tidak memiliki data."))
  assert.equal(worksheetRows('<x:row r="8"><x:c r="B8"><x:v>123</x:v></x:c></x:row>', [])[0].values[1], "123")
})

test("INDEX/MATCH uses the first source row even when a later duplicate is Ya", () => {
  const p = [row(8, "001", 1)]
  const d = [row(10, "001", 1, true), row(9, "001", 1, false)]
  const result = evaluateRows(p, d)
  assert.equal(p[0].status, "False Positive")
  assert.equal(result.false_positive, 1)
  assert.equal(result.matched_dsr, 1)
  assert.equal(result.realized, 1)
})

test("KPI counts events while the schedule retains first TID/date amounts", () => {
  const f = fixture({ dsr: [row(8, "001", 1, true, 2000), row(9, "001", 1, true, 6000)] })
  const r = buildReport(f)
  assert.equal(r.summary.realized, 2)
  assert.equal(r.summary.matched_dsr, 2)
  assert.equal(r.summary.matched_planning, 1)
  assert.equal(r.grand.dsr_points, 1)
  assert.equal(r.schedule.items[0].dates[1].dsr.sheets, 2000)
  assert.equal(r.grand.dsr_cash, 100000000)
})

test("daily, KPI and schedule implement formula denominators and pagu thresholds", () => {
  const r = buildReport(fixture())
  assert.equal(r.summary.forecast_accuracy, 0.5)
  assert.equal(r.summary.false_negative_rate, 0.5)
  assert.equal(r.daily[0].forecast_accuracy, 1)
  assert.equal(r.daily[1].forecast_accuracy, 0)
  assert.equal(r.daily[2].grand_total, 1)
  const s = r.schedule.items[0]
  assert.equal(s.frequency, 16)
  assert.equal(s.average_pattern_transaction, 160000000)
  assert.equal(s.average_pattern_sheets, 3200)
  assert.equal(s.pagu_sheets, 4000)
  assert.equal(s.pagu_cash, 200000000)
  assert.equal(s.pagu_status, "Minimum Pagu")
  assert.equal(r.categories[2].share, 0.5)
})

test("missing denomination produces incomplete cash totals, not a guessed denomination", () => {
  const r = buildReport(fixture())
  assert.equal(r.summary.missing_denom, 1)
  assert.equal(r.totals[2].dsr_cash, null)
  assert.equal(r.grand.dsr_cash, null)
  assert.equal(r.totals[0].dsr_cash, 200000000)
  assert.equal(r.schedule.items[1].pagu_status, "Belum lengkap")
})

test("All Denom, rounding, threshold and team capacity follow editable workbook parameters", () => {
  const p = Array.from({ length: 15 }, (_, i) => ({ ...row(i + 8, String(i), 1), machine_type: "CRM" }))
  const parameters = p.map(r => ({ tid: r.tid, denom: "All Denom", avg_daily_transaction: 15000000 }))
  const report = buildReport(fixture({ planning: p, dsr: [], parameters }))
  assert.equal(report.totals[0].planning_teams, 2)
  assert.equal(report.totals[0].planning_cash, 4500000000)
  assert.equal(report.schedule.items[0].pagu_sheets, 8000)
  assert.equal(report.schedule.items[0].pagu_status, "Melebihi Pagu")
  const custom = buildReport(fixture({ planning: p, dsr: [], parameters, settings: { team_capacity: 15, all_denom_value: 100000 } }))
  assert.equal(custom.totals[0].planning_teams, 1)
  assert.equal(custom.schedule.items[0].pagu_sheets, 6000)
  assert.equal(custom.schedule.items[0].pagu_status, "Maksimum Pagu")
})

test("February uses the actual month length and input objects remain unchanged", () => {
  const f = fixture({ period: "2028-02", planning: [{ ...row(8, "001", 1), event_date: "2028-02-29" }], dsr: [] })
  const before = JSON.stringify(f)
  const r = buildReport(f)
  assert.equal(r.days, 29)
  assert.equal(r.schedule.items[0].frequency, 29)
  assert.equal(r.daily.length, 29)
  assert.equal(JSON.stringify(f), before)
})

test("filter totals span the whole filtered set independently of pagination", () => {
  const p = Array.from({ length: 70 }, (_, i) => row(8 + i, `ATM${i}`, 1))
  const f = fixture({ planning: p, dsr: [] })
  const r = buildReport(f, { view: "schedule", page: 1, cluster: "barat" })
  assert.equal(r.schedule.items.length, 20)
  assert.equal(r.summary.forecast, 70)
  assert.equal(r.totals[0].planning_points, 70)
  assert.equal(buildReport(f, { search: "no match" }).summary.forecast, 0)
})

test("edit validation bounds monetary, revision and text inputs", () => {
  const base = { batch: 1, revision: 0, type: "tid", tid: "001", denom: "50000", branch: "BG", cluster_flm: "", sub_cluster_rpl: "", avg_daily_transaction: 0.29 }
  assert.equal(validateEdit(base).avg_daily_transaction, 0.29)
  assert.throws(() => validateEdit({ ...base, avg_daily_transaction: -1 }), /transaksi/)
  assert.throws(() => validateEdit({ ...base, denom: "75000" }), /Denom/)
  assert.throws(() => validateEdit({ ...base, revision: -1 }), /Versi/)
  assert.throws(() => validateEdit({ batch: 1, revision: 0, type: "settings", settings: { ...DEFAULT_SETTINGS, team_capacity: 0 } }), /team_capacity/)
})

test("cash totals beyond Number.MAX_SAFE_INTEGER remain exact and JSON serializable", () => {
  const planning = Array.from({ length: 1001 }, (_, i) => row(i + 8, String(i), 1, true, 10000000))
  const parameters = planning.map(r => ({ tid: r.tid, denom: "All Denom" }))
  const report = buildReport(fixture({ planning, dsr: [], parameters, settings: { all_denom_value: 1000000 } }))
  assert.equal(report.grand.planning_cash, "10010000000000000")
  assert.doesNotThrow(() => JSON.stringify(report))
})

test("actual workbook reconciles Daily_Accuracy and Jadwal monthly totals", { skip: !process.env.RPL_TEST_XLSX }, async () => {
  const data = parseWorkbook(await readFile(process.env.RPL_TEST_XLSX), "2026-08")
  const report = buildReport({ ...data, reporting_unit: "BG SEMARANG" })
  assert.equal(data.error_count, 0)
  assert.equal(report.summary.forecast, 1685)
  assert.equal(report.summary.realized, 3758)
  assert.equal(report.summary.matched_planning, 1239)
  assert.equal(report.summary.matched_dsr, 1240)
  assert.equal(report.summary.implemented_clusters, 8)
  assert.equal(report.summary.unique_tids, 396)
  assert.equal(report.summary.missing_denom, 0)
  assert.equal(report.grand.planning_cash, 622800000000)
  assert.equal(report.grand.planning_points, 1685)
  assert.equal(report.grand.planning_teams, 132)
  assert.equal(report.daily[14].forecast, 101)
  assert.equal(report.daily[14].matched_planning, 99)
  assert.equal(report.daily[30].forecast, 101)
  assert.equal(report.daily[30].matched_planning, 76)
  assert.equal(report.grand.dsr_points, 3750)
  assert.equal(report.reference_fc_count, 386)
})
