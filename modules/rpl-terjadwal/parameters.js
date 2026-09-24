import { createHash } from "node:crypto"
import { normalizeDenom, tidKey, evaluateRows } from "./calculations.js"
import { readXlsxWorkbook, UploadError } from "./workbook.js"

export const PARAMETER_SHEET = "rpl_tid_parameter"
export const PARAMETER_HEADERS = ["TID", "Lokasi", "Kantor Cabang", "Jenis", "Denom", "Cluster FLM", "Cluster RPL", "Sub Cluster RPL"]
export const MAX_PARAMETERS = 20000
const fields = ["tid", "location", "branch", "machine_type", "denom", "cluster_flm", "cluster", "sub_cluster_rpl"]

export function validateRevision(value) {
  if (!Number.isInteger(value) || value < 0 || value >= 2147483647) throw new UploadError("Revisi parameter tidak valid. Muat ulang atau preview kembali.")
  return value
}

export function validateParameter(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new UploadError("Parameter TID tidak valid.")
  const text = (key, max, required = true) => {
    const value = input[key]
    if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) throw new UploadError(`${PARAMETER_HEADERS[fields.indexOf(key)]} ${required ? "wajib diisi, " : ""}maksimal ${max} karakter.`)
    return value.trim()
  }
  const tid = tidKey(text("tid", 50))
  if (!/^[A-Z0-9._-]{1,50}$/.test(tid)) throw new UploadError("TID maksimal 50 karakter tanpa spasi.")
  const machine_type = text("machine_type", 3).toUpperCase()
  if (!["ATM", "CRM"].includes(machine_type)) throw new UploadError("Jenis harus ATM atau CRM.")
  let denom
  try { denom = normalizeDenom(input.denom) } catch (error) { throw new UploadError(error.message) }
  if (!denom) throw new UploadError("Denom wajib diisi: 50000, 100000, atau All Denom.")
  return { tid, location: text("location", 250), branch: text("branch", 150), machine_type, denom,
    cluster_flm: text("cluster_flm", 100, false), cluster: text("cluster", 100), sub_cluster_rpl: text("sub_cluster_rpl", 100, false) }
}

export function parseParameterWorkbook(buffer) {
  const source = readXlsxWorkbook(buffer).readSheet(PARAMETER_SHEET, 9)
  const header = source.find(r => r.values.slice(0, 8).map(v => v.trim().toLowerCase()).join("|") === PARAMETER_HEADERS.map(v => v.toLowerCase()).join("|"))
  if (!header || header.values[8]) throw new UploadError("Sheet rpl_tid_parameter harus memakai 8 judul kolom A–H sesuai template.")
  const rows = [], errors = [], seen = new Set()
  let count = 0
  for (const { row, values } of source) {
    if (row <= header.row || values.every(v => !v)) continue
    if (++count > MAX_PARAMETERS) throw new UploadError("Maksimal 20.000 parameter TID per file.")
    try {
      if (values[8]) throw new UploadError("Parameter hanya memakai kolom A–H.")
      const value = validateParameter(Object.fromEntries(fields.map((field, i) => [field, values[i]])))
      if (seen.has(value.tid)) throw new UploadError("TID berulang dalam file. Gunakan satu baris per TID.")
      seen.add(value.tid); rows.push({ ...value, source_row: row })
    } catch (error) { errors.push({ sheet: PARAMETER_SHEET, row, tid: values[0], message: error.message }) }
  }
  if (!rows.length && !errors.length) errors.push({ sheet: PARAMETER_SHEET, row: header.row + 1, message: "Sheet parameter tidak memiliki data." })
  return { rows, error_count: errors.length, errors: errors.slice(0, 200), file_hash: createHash("sha256").update(buffer).digest("hex") }
}

// Each batch keeps its own parameter snapshot. Master updates never rewrite history.
export function applyParameterSnapshot(data, master) {
  const byTid = new Map(master.items.map(p => [tidKey(p.tid), p]))
  const parameters = data.parameters.map(p => {
    const current = byTid.get(tidKey(p.tid))
    if (!current) return { ...p }
    return { ...p, ...Object.fromEntries(fields.map(key => [key, current[key]])), metadata_source: "Master Parameter TID" }
  })
  const profiles = new Map(parameters.map(p => [tidKey(p.tid), p]))
  const enrich = rows => rows.map(r => {
    const p = profiles.get(tidKey(r.tid))
    return { ...r, denom: p?.denom || null }
  })
  const planning = enrich(data.planning), dsr = enrich(data.dsr)
  const missing = parameters.filter(p => !p.denom).length
  const warnings = data.warnings.filter(w => !/^\d+ TID belum memiliki Denom\./.test(w))
  if (missing) warnings.push(`${missing} TID belum memiliki Denom. Lengkapi Upload Parameter TID atau tab Edit; nilai rupiah masih belum lengkap.`)
  return { ...data, parameters, planning, dsr, summary: evaluateRows(planning, dsr), warnings, parameter_revision: master.revision }
}
