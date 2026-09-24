import { inflateRawSync } from "node:zlib"
import { createHash } from "node:crypto"
import path from "node:path"
import { DEFAULT_SETTINGS, evaluateRows, normalizeDenom, tidKey } from "./calculations.js"

export const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_XML_BYTES = 64 * 1024 * 1024
const MAX_TOTAL_XML_BYTES = 128 * 1024 * 1024
export const MAX_EXCEL_ROW = 1_048_576
export const SHEETS = ["Data Detail TID Perencanaan", "Data Detail TID DSR"]
export const HEADERS = ["Date", "TID", "Nama Lokasi", "Jenis Mesin", "Pagu Realisasi (lembar)", "Forecast (Perencanaan)", "Realisasi", "Status", "Penyebab", "Kendala", "Catatan Tambahan"]
export const DETAIL_HEADERS = {
  planning: ["Date", "TID", "Nama Lokasi", "Jenis Mesin", "Pagu Perencanaan (lembar)", "Forecast (Perencanaan)", "Penyebab", "Kendala", "Catatan Tambahan"],
  dsr: ["Date", "TID", "Nama Lokasi", "Jenis Mesin", "Pagu Realisasi (lembar)", "Realisasi", "Penyebab", "Kendala", "Catatan Tambahan"],
}

export class UploadError extends Error {
  constructor(message, status = 422) { super(message); this.status = status }
}
const fail = (message) => { throw new UploadError(message) }
const clean = (v) => String(v ?? "").replace(/\u00a0/g, " ").trim()
// Excel and other conforming XLSX writers may use x: prefixes on element names.
const localNames = xml => xml.replace(/(<\/?)[A-Za-z_][\w.-]*:([A-Za-z_][\w.-]*)/g, "$1$2")
function decode(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (all, code) => {
    if (code[0] !== "#") return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[code] ?? all
    const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1))
    return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""
  })
}
function attrs(text) {
  return Object.fromEntries([...text.matchAll(/([\w:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1], decode(m[2] ?? m[3])]))
}
function texts(xml) { return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => decode(m[1])).join("") }

// Read only selected XML entries; never extract paths or evaluate Excel formulas.
export function openXlsx(buffer) {
  if (buffer.length > MAX_FILE_BYTES) throw new UploadError("File maksimal 10 MB.", 413)
  let end = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break }
  }
  if (end < 0) fail("File bukan XLSX yang valid.")
  const count = buffer.readUInt16LE(end + 10)
  const start = buffer.readUInt32LE(end + 16)
  if (count > 2048 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || start + buffer.readUInt32LE(end + 12) !== end) fail("Struktur ZIP tidak didukung.")
  const entries = new Map()
  let cursor = start
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) fail("Direktori ZIP rusak.")
    const length = buffer.readUInt16LE(cursor + 28)
    const next = cursor + 46 + length + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32)
    if (next > end) fail("Direktori ZIP tidak lengkap.")
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + length)
    if (entries.has(name)) fail("Entri XLSX duplikat.")
    entries.set(name, { flags: buffer.readUInt16LE(cursor + 8), method: buffer.readUInt16LE(cursor + 10), compressed: buffer.readUInt32LE(cursor + 20), size: buffer.readUInt32LE(cursor + 24), offset: buffer.readUInt32LE(cursor + 42) })
    cursor = next
  }
  let total = 0
  return (name, optional = false) => {
    const entry = entries.get(name)
    if (!entry) { if (optional) return ""; fail(`Bagian XLSX tidak ditemukan: ${name}`) }
    const { offset, compressed, size, method, flags } = entry
    if (flags & 1) fail("File XLSX yang diproteksi kata sandi tidak dapat diproses.")
    if (![0, 8].includes(method)) fail("Metode kompresi XLSX tidak didukung. Buka file di Microsoft Excel lalu simpan ulang sebagai .xlsx.")
    if (size > MAX_XML_BYTES) fail("Bagian internal XLSX terlalu besar untuk diproses. Maksimal 64 MB per bagian XML.")
    if (offset + 30 > start || buffer.readUInt32LE(offset) !== 0x04034b50) fail("Struktur entri XLSX tidak valid atau tidak didukung.")
    const data = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28)
    if (data + compressed > start) fail("Data ZIP di luar batas.")
    let inflated
    try { inflated = method === 0 ? buffer.subarray(data, data + compressed) : inflateRawSync(buffer.subarray(data, data + compressed), { maxOutputLength: MAX_XML_BYTES }) } catch { fail("Data XLSX gagal dibaca atau melewati batas ukuran.") }
    total += inflated.length
    if (inflated.length !== size || total > MAX_TOTAL_XML_BYTES) fail("Ukuran data XLSX tidak valid atau total isi workbook terlalu besar.")
    const xml = inflated.toString("utf8")
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail("Deklarasi XML eksternal tidak diperbolehkan.")
    return localNames(xml)
  }
}

export function worksheetRows(xml, strings, maxColumns = 13, options = {}) {
  xml = localNames(xml)
  const result = []
  const { skipFormulaOnly = false } = options
  // Resource protection is enforced at the XLSX/XML layer (10 MB upload, 64 MB
  // per XML part, 128 MB total). Do not reject a workbook merely because Excel
  // persisted many rows with cached formula results. Such rows are common in
  // templates that prefill formulas far below the actual user data.
  const seen = new Uint8Array(MAX_EXCEL_ROW + 1)
  for (const match of xml.matchAll(/<row\b([^>]*?)(?:\/|>([\s\S]*?)<\/row>)/g)) {
    const index = Number(attrs(match[1]).r)
    if (!Number.isInteger(index) || index < 1 || index > MAX_EXCEL_ROW || seen[index]) fail("Nomor baris XLSX tidak valid.")
    seen[index] = 1
    const values = Array(maxColumns).fill("")
    let hasValue = false
    let hasLiteralValue = false
    for (const cell of (match[2] || "").matchAll(/<c\b([^>]*?)(?:\/|>([\s\S]*?)<\/c>)/g)) {
      const a = attrs(cell[1]); const body = cell[2] || ""
      const ref = /^([A-Z]+)(\d+)$/.exec(a.r || "")
      if (!ref || Number(ref[2]) !== index) fail("Alamat sel XLSX tidak valid.")
      let col = 0
      for (const ch of ref[1]) col = col * 26 + ch.charCodeAt(0) - 64
      if (col > 128) fail("Sheet maksimal 128 kolom.")
      // XLSX often persists styled/blank cells outside the import area. They are
      // physical workbook metadata, not application data, so ignore them here.
      if (col > maxColumns) continue
      const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ""
      let value
      if (a.t === "s") {
        if (!clean(raw)) value = ""
        else {
          const stringIndex = Number(raw)
          if (!Number.isInteger(stringIndex) || stringIndex < 0 || strings[stringIndex] === undefined) fail("Referensi teks XLSX tidak valid.")
          value = strings[stringIndex]
        }
      } else value = a.t === "inlineStr" ? texts(body) : decode(raw)
      value = clean(value)
      if (value.length > 4000) fail(`Baris ${index}: teks terlalu panjang.`)
      if (!value) continue
      hasValue = true
      // A formula cell can carry a cached <v> even when the row contains no user
      // input. For upload detail sheets those formula-only rows must not consume
      // the logical data set; rows with any literal input are still retained and
      // their cached formula values remain available in `values`.
      if (!/<f(?:\s[^>]*)?(?:\/|>)/.test(body)) hasLiteralValue = true
      values[col - 1] = value
    }
    if (!hasValue || (skipFormulaOnly && !hasLiteralValue)) continue
    result.push({ row: index, values })
  }
  return result.sort((a, b) => a.row - b.row)
}

export function normalizeRows(source, kind, period) {
  const errors = []; const rows = []; const duplicates = new Set(); const keys = new Set()
  if (!source || !Array.isArray(source)) return { rows: [], errors: [], duplicate_keys: 0 }
  const normalizeHeader = v => clean(v).toLowerCase().replace(/\s+/g, " ")
  const matches = (row, headers) => {
    const values = row.values.map(normalizeHeader)
    const target = headers.map(normalizeHeader)
    return target.every((h, i) => values[i] === h)
  }
  const looseMatches = (row, headers) => {
    const values = row.values.map(normalizeHeader)
    const target = headers.map(normalizeHeader)
    const found = target.every((h) => values.includes(h))
    return found
  }
  const header = source.find(r => matches(r, DETAIL_HEADERS[kind]) || matches(r, HEADERS) || looseMatches(r, DETAIL_HEADERS[kind]))
  if (!header) fail(`${SHEETS[kind === "planning" ? 0 : 1]}: judul kolom tidak sesuai template Excel.`)
  const compact = matches(header, DETAIL_HEADERS[kind])
  const noCluster = compact
  if (compact && header.values.slice(9).some(v => clean(v))) fail("Format baru tanpa Cluster hanya memakai kolom sesuai template.")
  const hasDenom = !compact && kind === "planning" && clean(header.values[12]).toLowerCase() === "denom"
  if (!compact && kind === "planning" && clean(header.values[12]) && !hasDenom) fail("Kolom M pada Perencanaan harus berjudul Denom atau dikosongkan.")
  const paguIndex = noCluster ? 4 : 5
  const flagIndex = noCluster ? 5 : (kind === "planning" ? 6 : 7)
  const noteStart = noCluster ? 6 : (compact ? 7 : 9)
  for (const { row, values: v } of source) {
    if (row <= header.row) continue
    // Ignore prefilled formulas in G:H:I on otherwise empty rows.
    if ([...v.slice(0, paguIndex + 1), ...v.slice(noteStart)].every(x => !clean(x))) continue
    const issues = []
    let day = Number(v[0])
    if (!Number.isInteger(day)) {
      const parsed = new Date(v[0])
      if (!Number.isNaN(parsed.getTime())) day = parsed.getUTCDate()
    }
    if (Number.isInteger(day) && day > 40000) {
      day = new Date(Date.UTC(1899, 11, 30 + day)).getUTCDate()
    }
    const maxDay = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate()
    if (!Number.isInteger(day) || day < 1 || day > maxDay) issues.push(`Date harus angka hari 1–${maxDay}`)
    if (!/^[A-Za-z0-9._-]{1,50}$/.test(v[1])) issues.push("TID wajib diisi (maksimal 50 karakter, tanpa spasi)")
    if (!v[2] || v[2].length > 250) issues.push("Nama Lokasi wajib, maksimal 250 karakter")
    const machine = v[3].toUpperCase()
    if (!["ATM", "CRM"].includes(machine)) issues.push("Jenis Mesin harus ATM atau CRM")
    if (!noCluster && (!v[4] || v[4].length > 100)) issues.push("Cluster wajib, maksimal 100 karakter")
    const sheets = Number(v[paguIndex])
    if (!v[paguIndex] || !Number.isSafeInteger(sheets) || sheets < 0 || sheets > 10000000) issues.push("Pagu harus bilangan bulat lembar 0–10.000.000")
    const flag = clean(v[flagIndex]).toLowerCase()
    if (!["ya", "tidak"].includes(flag)) issues.push(`${kind === "planning" ? "Forecast" : "Realisasi"} harus Ya/Tidak`)
    let denom = null
    try { if (hasDenom) denom = normalizeDenom(v[12]) } catch (e) { issues.push(e.message) }
    if (issues.length) { errors.push({ sheet: kind, row, tid: v[1], message: issues.join("; ") }); continue }
    const item = { source_row: row, event_date: `${period}-${String(day).padStart(2, "0")}`, tid: v[1], location: v[2], machine_type: machine, cluster: noCluster ? null : v[4], sheets, selected: flag === "ya", cause: clean(v[noteStart]), obstacle: clean(v[noteStart + 1]), note: clean(v[noteStart + 2]), denom }
    const key = `${item.event_date}|${item.tid.toUpperCase()}`
    if (keys.has(key)) duplicates.add(key)
    keys.add(key); rows.push(item)
  }
  if (rows.length > 150000) fail("Maksimal 150.000 baris data per sheet.")
  if (!rows.length && !errors.length) errors.push({ sheet: kind, row: header.row + 1, message: "Sheet tidak memiliki data." })
  return { rows, errors, duplicate_keys: duplicates.size }
}

export function evaluate(planning, dsr) {
  return evaluateRows(planning, dsr)
}

export function readXlsxWorkbook(buffer) {
  const read = openXlsx(buffer)
  const workbook = read("xl/workbook.xml")
  if (/<workbookPr\b[^>]*date1904="(?:1|true)"/.test(workbook)) fail("Gunakan sistem tanggal Excel standar 1900.")
  const rels = new Map([...read("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b([^>]*?)\/?\s*>/g)].map(m => { const a = attrs(m[1]); return [a.Id, a] }))
  const names = new Map([...workbook.matchAll(/<sheet\b([^>]*?)\/?\s*>/g)].map(m => { const a = attrs(m[1]); return [a.name, a["r:id"]] }))
  const strings = [...read("xl/sharedStrings.xml", true).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m => texts(m[1]))
  if (strings.length > 50000) fail("Terlalu banyak teks bersama XLSX.")
  const readSheet = (name, columns = 13, optional = false, options = {}) => {
    if (!names.has(name) && optional) return []
    const rel = rels.get(names.get(name))
    if (!rel || rel.TargetMode === "External") fail(`Sheet wajib tidak ditemukan: ${name}`)
    const target = path.posix.normalize(rel.Target.startsWith("/") ? rel.Target.slice(1) : `xl/${rel.Target}`)
    if (!target.startsWith("xl/worksheets/")) fail("Relasi worksheet tidak valid.")
    return worksheetRows(read(target), strings, columns, options)
  }
  return { readSheet, sheetNames: [...names.keys()] }
}

export function parseWorkbook(buffer, period) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period || "")) fail("Pilih periode bulan dan tahun (2000–2099).")
  const { readSheet, sheetNames } = readXlsxWorkbook(buffer)
  const tables = SHEETS.map((name, index) => readSheet(name, 13, index !== 0, { skipFormulaOnly: true }))
  const planning = normalizeRows(tables[0], "planning", period)
  // DSR tidak lagi dibaca dari Excel. Data DSR diambil dari CRO dan disimpan ke rpl_dsr_uploads.
  // Sheet DSR lama tetap boleh ada untuk kompatibilitas, tetapi tidak divalidasi.
  const dsr = { rows: [], errors: [], duplicate_keys: 0 }
  const warnings = []
  const period_label = tables[0].find(r => r.row === 3)?.values[2] || ""
  const monthNames = ["januari", "februari", "maret", "april", "mei", "juni", "juli", "agustus", "september", "oktober", "november", "desember"]
  const monthIndex = monthNames.findIndex(m => period_label.toLowerCase().includes(m))
  const year = /\b20\d{2}\b/.exec(period_label)?.[0]
  if (year && monthIndex >= 0 && `${year}-${String(monthIndex + 1).padStart(2, "0")}` !== period) fail(`Periode pilihan tidak sesuai C3: ${period_label}`)
  if (planning.duplicate_keys || dsr.duplicate_keys) warnings.push(`TID + tanggal berulang: Perencanaan ${planning.duplicate_keys}, DSR ${dsr.duplicate_keys}. Semua kejadian disimpan untuk KPI. Pencocokan dan grid jadwal menggunakan baris pertama pada TID + tanggal yang sama, mengikuti INDEX/MATCH Excel.`)
  const errors = [...planning.errors, ...dsr.errors]
  const parameters = new Map()
  for (const r of [...planning.rows, ...dsr.rows]) if (!parameters.has(tidKey(r.tid))) parameters.set(tidKey(r.tid), { tid: tidKey(r.tid), denom: null, branch: "", cluster_flm: "", sub_cluster_rpl: "", avg_daily_transaction: null, metadata_source: "Belum dilengkapi" })
  // Only literal input fields from Jadwal are supplemental; never import its computed outputs.
  const schedule = readSheet("Jadwal RPL vs Realisasi", 12, true, { skipFormulaOnly: true })
  const scheduleHeader = schedule.find(r => r.row === 5)?.values
  if (schedule.length && (clean(scheduleHeader?.[1]).toUpperCase() !== "TID" || clean(scheduleHeader?.[5]).toLowerCase() !== "denom")) fail("Judul kolom tambahan pada Jadwal RPL vs Realisasi tidak sesuai workbook acuan.")
  for (const { row, values: v } of schedule) {
    if (row < 10) continue
    const item = parameters.get(tidKey(v[1]))
    if (!item) continue
    try {
      const denom = normalizeDenom(v[5])
      if (item.metadata_source !== "Belum dilengkapi" && item.denom !== denom) throw new Error("Denom untuk TID yang sama tidak konsisten.")
      const avg = clean(v[11]) ? Number(v[11]) : null
      if (avg !== null && (!Number.isFinite(avg) || avg < 0 || avg > 1e12)) throw new Error("Rata-rata transaksi harian tidak valid.")
      if (v[3].length > 150 || v[6].length > 100 || v[8].length > 100) throw new Error("Nama cabang atau cluster terlalu panjang.")
      Object.assign(item, { denom, branch: v[3], cluster_flm: v[6], sub_cluster_rpl: v[8], avg_daily_transaction: avg, metadata_source: "Jadwal pada Excel" })
    } catch (e) { errors.push({ sheet: "Jadwal RPL vs Realisasi", row, tid: v[1], message: e.message }) }
  }
  const explicitDenom = new Map()
  for (const r of planning.rows) if (r.denom) {
    const key = tidKey(r.tid)
    if (explicitDenom.has(key) && explicitDenom.get(key) !== r.denom) errors.push({ sheet: "planning", row: r.source_row, tid: r.tid, message: "Denom TID yang sama harus konsisten dalam satu periode." })
    explicitDenom.set(key, r.denom)
    const item = parameters.get(key)
    item.denom = r.denom; item.metadata_source = "Denom Perencanaan"
  }
  for (const r of [...planning.rows, ...dsr.rows]) r.denom = parameters.get(tidKey(r.tid)).denom
  const missing = [...parameters.values()].filter(r => !r.denom).length
  if (missing) warnings.push(`${missing} TID belum memiliki Denom. Upload Parameter TID secara terpisah atau lengkapi pada tab Edit. Nilai rupiah ditandai belum lengkap sampai Denom terisi.`)
  if (sheetNames.includes("rpl_tid_parameter")) warnings.push("Sheet rpl_tid_parameter tidak disimpan bersama data RPL. Gunakan Upload Parameter TID untuk mengimpor sheet tersebut.")
  if (schedule.length) warnings.push("Isian Denom, cabang, cluster FLM, sub cluster, dan rata-rata transaksi dibaca dari sheet Jadwal bila tersedia. Denom kolom M Perencanaan diprioritaskan; seluruh hasil perhitungan dibuat ulang dari dua sheet detail.")
  const settings = { ...DEFAULT_SETTINGS }
  const kpi = readSheet("Rekap KPI", 2, true)
  const totalClusters = kpi.find(r => r.row === 6)?.values[1]
  if (totalClusters && /^\d+$/.test(totalClusters) && Number(totalClusters) <= 100000) settings.total_clusters = Number(totalClusters)
  const reference_fc = readSheet("Edit", 2, true, { skipFormulaOnly: true }).filter(r => r.row >= 4 && /^[A-Za-z0-9._-]{1,50}$/.test(r.values[1])).map(r => ({ source_row: r.row, tid: r.values[1] }))
  return { period, period_label, file_hash: createHash("sha256").update(buffer).digest("hex"), planning: planning.rows, dsr: dsr.rows, parameters: [...parameters.values()], settings, reference_fc, summary: evaluate(planning.rows, dsr.rows), warnings, errors: errors.slice(0, 200), error_count: errors.length }
}
