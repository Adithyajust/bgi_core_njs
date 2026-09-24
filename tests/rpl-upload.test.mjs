import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { deflateRawSync } from "node:zlib"
import { HEADERS, normalizeRows, evaluate, parseWorkbook, openXlsx, worksheetRows, MAX_FILE_BYTES, MAX_EXCEL_ROW } from "../modules/rpl-terjadwal/workbook.js"

const header = { row: 7, values: HEADERS }
const raw = (row, override = {}) => ({ row, values: Object.assign(["15", "00123", "Lokasi", "ATM", "BARAT", "6000", "Ya", "Ya", "", "", "", ""], override) })
function zip(files) {
  const chunks = []; const directory = []; let offset = 0
  for (const [name, value] of Object.entries(files)) {
    const bytes = Buffer.from(value); const compressed = deflateRawSync(bytes); const n = Buffer.from(name)
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(n.length, 26)
    chunks.push(local, n, compressed)
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42)
    directory.push(central, n); offset += local.length + n.length + compressed.length
  }
  const d = Buffer.concat(directory); const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(d.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, d, end])
}
const escape = s => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
function xmlRow(r) { return `<row r="${r.row}">${r.values.map((v, i) => `<c r="${String.fromCharCode(65 + i)}${r.row}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`).join("")}</row>` }
function fixture() {
  const xml = `<worksheet><sheetData>${xmlRow(header)}${xmlRow(raw(8))}</sheetData></worksheet>`
  return zip({ "xl/workbook.xml": '<workbook><sheets><sheet name="Data Detail TID Perencanaan" r:id="rId1"/><sheet name="Data Detail TID DSR" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": xml, "xl/worksheets/sheet2.xml": xml })
}

test("reads two named sheets and preserves leading-zero TID without master lookup", () => {
  const result = parseWorkbook(fixture(), "2026-08")
  assert.equal(result.error_count, 0); assert.equal(result.planning[0].tid, "00123")
  assert.equal(result.planning[0].event_date, "2026-08-15"); assert.equal(result.summary.matched_planning, 1)
})
test("ignores formula-only blank rows and rejects partially populated rows", () => {
  const blank = { row: 9, values: ["", "", "", "", "", "", "Tidak", "Tidak", "Tidak Ada RPL", "", "", ""] }
  const data = normalizeRows([header, raw(8), blank, raw(10, { 1: "" })], "planning", "2026-08")
  assert.equal(data.rows.length, 1); assert.equal(data.errors.length, 1); assert.equal(data.errors[0].row, 10)
})
test("validates calendar, pagu, mandatory input flag and column names", () => {
  const data = normalizeRows([header, raw(8, { 0: "31", 5: "-1", 6: "x" })], "planning", "2026-02")
  assert.match(data.errors[0].message, /1–28/); assert.match(data.errors[0].message, /Pagu/); assert.match(data.errors[0].message, /Forecast/)
  assert.throws(() => normalizeRows([raw(1)], "planning", "2026-08"), /judul kolom/)
  assert.equal(normalizeRows([header, raw(8, { 0: "29" })], "planning", "2028-02").errors.length, 0)
})
test("matching is same day and TID, independent of cached formula, retaining repeated DSR events", () => {
  const p = normalizeRows([header, raw(8), raw(9, { 1: "999" }), raw(10, { 1: "777", 6: "Tidak" })], "planning", "2026-08").rows
  const d = normalizeRows([header, raw(8), raw(9), raw(10, { 0: "16" }), raw(11, { 1: "555" })], "dsr", "2026-08")
  const summary = evaluate(p, d.rows)
  assert.equal(d.duplicate_keys, 1); assert.equal(summary.matched_planning, 1); assert.equal(summary.matched_dsr, 2)
  assert.equal(summary.false_positive, 1); assert.equal(summary.false_negative, 2)
  assert.equal(p[2].status, "Tidak Ada RPL")
})
test("reads shared strings, inline entities, and skips out-of-scope columns", () => {
  const rows = worksheetRows('<worksheet><row r="8"><c r="A8"><v>15</v></c><c r="B8" t="s"><v>0</v></c><c r="C8" t="inlineStr"><is><t>A &amp; B</t></is></c></row></worksheet>', ["00123"])
  assert.equal(rows[0].values[1], "00123"); assert.equal(rows[0].values[2], "A & B")
  assert.equal(worksheetRows('<row r="9"><c r="A9" t="s" s="1"/></row>', ["SHOULD_NOT_APPEAR"]).length, 0)
  assert.equal(worksheetRows('<row r="999999"><c r="A999999"><v>1</v></c></row>', [])[0].row, 999999)
  assert.throws(() => worksheetRows(`<row r="${MAX_EXCEL_ROW + 1}"><c r="A${MAX_EXCEL_ROW + 1}"><v>1</v></c></row>`, []), /Nomor baris XLSX tidak valid/)
})
test("styled blank ranges above the old 350k-cell threshold are ignored", () => {
  const columns = Array.from({ length: 13 }, (_, i) => String.fromCharCode(65 + i))
  const body = Array.from({ length: 26924 }, (_, i) => {
    const row = i + 1
    return `<row r="${row}">${columns.map(col => `<c r="${col}${row}"/>`).join("")}</row>`
  }).join("")
  const rows = worksheetRows(`<worksheet><sheetData>${body}</sheetData></worksheet>`, [], 13)
  assert.equal(rows.length, 0)
})

test("more than 100k physical blank row records do not consume the RPL data quota", () => {
  const blankRows = Array.from({ length: 100005 }, (_, i) => `<row r="${i + 1}" s="1"/>`).join("")
  const valued = '<row r="150000"><c r="A150000"><v>15</v></c><c r="B150000" t="inlineStr"><is><t>00123</t></is></c></row>'
  const rows = worksheetRows(`<worksheet><sheetData>${blankRows}${valued}</sheetData></worksheet>`, [], 13)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].row, 150000)
  assert.equal(rows[0].values[1], "00123")
})

test("more than 100k cached formula-only rows are ignored for RPL detail imports", () => {
  const formulaRows = Array.from({ length: 100005 }, (_, i) => {
    const row = i + 100
    return `<row r="${row}"><c r="G${row}" t="str"><f>IF(A${row}="","", "Tidak")</f><v>Tidak</v></c></row>`
  }).join("")
  const actual = '<row r="250000"><c r="A250000"><v>15</v></c><c r="B250000" t="inlineStr"><is><t>00123</t></is></c><c r="G250000" t="str"><f>IF(A250000="","", "Ya")</f><v>Ya</v></c></row>'
  const rows = worksheetRows(`<worksheet><sheetData>${formulaRows}${actual}</sheetData></worksheet>`, [], 13, { skipFormulaOnly: true })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].row, 250000)
  assert.equal(rows[0].values[1], "00123")
  assert.equal(rows[0].values[6], "Ya")
})

test("invalid, oversized, malicious XML and decompression bombs are rejected", () => {
  assert.throws(() => openXlsx(Buffer.from("not xlsx")), /bukan XLSX/)
  assert.throws(() => openXlsx(Buffer.alloc(MAX_FILE_BYTES + 1)), /10 MB/)
  assert.throws(() => parseWorkbook(fixture(), "2026-13"), /periode/)
  assert.throws(() => openXlsx(zip({ "evil.xml": '<!DOCTYPE x><x/>' }))("evil.xml"), /eksternal/)
  const oversized = zip({ "large.xml": "x" })
  const central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  oversized.writeUInt32LE(64 * 1024 * 1024 + 1, central + 24)
  assert.throws(() => openXlsx(oversized)("large.xml"), /64 MB/)
})
test("API authorizes both methods and validates raw bytes again before commit", async () => {
  const source = await readFile(new URL("../app/api/rpl-terjadwal/route.js", import.meta.url), "utf8") + await readFile(new URL("../modules/rpl-terjadwal/http.js", import.meta.url), "utf8")
  assert.match(source, /authorize\(request, "create"\)/); assert.match(source, /authorize\(request, "view"\)/)
  assert.match(source, /isSuperAdmin\(auth.user\)/); assert.match(source, /await reader.cancel/)
  assert.match(source, /parseWorkbook\(await readBytes/); assert.match(source, /preview_hash/)
  assert.match(source, /if \(data.error_count\) return/)
})
test("database imports are atomic and audit is part of the same transaction", async () => {
  const source = await readFile(new URL("../modules/rpl-terjadwal/database.js", import.meta.url), "utf8")
  const schema = await readFile(new URL("../scripts/migrations/055-rpl-terjadwal-upload.sql", import.meta.url), "utf8")
  assert.match(source, /insertAuditLog\(tx/); assert.match(source, /await tx.rollback/)
  assert.match(source, /OPENJSON\(@rows\)/); assert.match(source, /TOP \(51\)/)
  assert.match(schema, /UNIQUE \(period, reporting_unit, file_hash\)/)
  assert.doesNotMatch(source + schema, /master_mesin|replenish_work_order|DELETE FROM/)
})
test("real reference workbook reconciles with original Excel cached KPI", { skip: !process.env.RPL_TEST_XLSX }, async () => {
  const data = parseWorkbook(await readFile(process.env.RPL_TEST_XLSX), "2026-08")
  assert.equal(data.error_count, 0); assert.equal(data.planning.length, 1685); assert.equal(data.dsr.length, 3758)
  assert.equal(data.summary.matched_planning, 1239); assert.equal(data.summary.matched_dsr, 1240)
  assert.equal(data.summary.false_positive, 446); assert.equal(data.summary.false_negative, 2518)
  assert.throws(() => parseWorkbook(Buffer.from(""), "2026-08"), /bukan XLSX/)
})
