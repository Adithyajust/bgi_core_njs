// Business rules transcribed from the supplied workbook; no application master data.
const MAX_EXCEL_ROW = 1_048_576

export const DEFAULT_SETTINGS = Object.freeze({ total_clusters: 0, team_capacity: 14, bundle_size: 2000, atm_limit: 8000, crm_limit: 6000, all_denom_value: 75000, findings: "", dominant_cause: "", execution_obstacles: "", follow_up: "", narrative_override: "" })
export const CAUSES = ["Transaksi aktual lebih rendah dari prediksi", "Update saldo terlambat", "Perubahan pola transaksi", "Gangguan sistem", "Keterlambatan eksekusi", "Lainnya"]
export const STATUSES = ["Sesuai", "False Positive", "False Negative", "Tidak Ada RPL"]
export const ratio = (a, b) => b ? a / b : 0
export const tidKey = value => String(value).trim().toUpperCase()
const addInteger = (a, b) => typeof a === "bigint" || typeof b === "bigint" || !Number.isSafeInteger(a + b) ? BigInt(a) + BigInt(b) : a + b
const jsonIntegers = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value]))
export function normalizeDenom(value) {
  const text = String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ")
  if (!text) return null
  if (text === "ALL DENOM") return "All Denom"
  const numeric = text.replace(/[.,]/g, "")
  if (["50000", "100000"].includes(numeric)) return numeric
  throw new Error("Denom harus 50000, 100000, atau All Denom.")
}
export function denominator(value, settings) {
  return value === "All Denom" ? settings.all_denom_value : value ? Number(value) : null
}
export function firstByDate(rows) {
  const map = new Map()
  for (const row of [...rows].sort((a, b) => a.source_row - b.source_row)) {
    const key = `${row.event_date}|${tidKey(row.tid)}`
    if (!map.has(key)) map.set(key, row)
  }
  return map
}
export function evaluateRows(planning, dsr) {
  const planned = firstByDate(planning), realized = firstByDate(dsr)
  const selected = (r, kind) => Boolean(r?.selected ?? r?.[kind === "planning" ? "forecast" : "realized"])
  for (const [rows, kind] of [[planning, "planning"], [dsr, "dsr"]]) {
    for (const row of rows) {
      const key = `${row.event_date}|${tidKey(row.tid)}`
      row.forecast = kind === "planning" ? selected(row, kind) : selected(planned.get(key), "planning")
      row.realized = kind === "dsr" ? selected(row, kind) : selected(realized.get(key), "dsr")
      row.status = row.forecast ? row.realized ? STATUSES[0] : STATUSES[1] : row.realized ? STATUSES[2] : STATUSES[3]
    }
  }
  const count = (rows, field, value) => rows.filter(r => r[field] === value).length
  const forecast = count(planning, "forecast", true), actual = count(dsr, "realized", true)
  const matchedPlanning = count(planning, "status", STATUSES[0]), matchedDsr = count(dsr, "status", STATUSES[0])
  const fp = count(planning, "status", STATUSES[1]), fn = count(dsr, "status", STATUSES[2])
  return { planning_rows: planning.length, dsr_rows: dsr.length, forecast, realized: actual, matched_planning: matchedPlanning, matched_dsr: matchedDsr, false_positive: fp, false_negative: fn, no_rpl: count(dsr, "status", STATUSES[3]), not_forecast: count(dsr, "forecast", false), forecast_accuracy: ratio(matchedPlanning, forecast), realization_match: ratio(matchedDsr, actual), false_positive_rate: ratio(fp, forecast), false_negative_rate: ratio(fn, actual), implemented_clusters: new Set(planning.map(r => tidKey(r.cluster))).size }
}

export function validateEdit(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Data perubahan tidak valid.")
  if (!Number.isInteger(input.batch) || input.batch < 1 || input.batch > 2147483647 || !Number.isInteger(input.revision) || input.revision < 0 || input.revision >= 2147483647) throw new Error("Versi data tidak valid. Muat ulang laporan.")
  const text = (value, max = 4000) => {
    if (typeof value !== "string" || value.length > max) throw new Error(`Teks wajib berupa string, maksimal ${max} karakter.`)
    return value.trim()
  }
  const base = { batch: input.batch, revision: input.revision, type: input.type }
  if (input.type === "tid") {
    const tid = tidKey(text(input.tid, 50))
    if (!/^[A-Z0-9._-]{1,50}$/.test(tid)) throw new Error("TID tidak valid.")
    const avg = input.avg_daily_transaction
    if (avg !== null && (typeof avg !== "number" || !Number.isFinite(avg) || avg < 0 || avg > 1e12 || Math.abs(Math.round(avg * 100) - avg * 100) > 0.001)) throw new Error("Rata-rata transaksi harus angka rupiah 0–1 triliun, maksimal dua desimal; kosong boleh.")
    const optional = (key, max) => {
      if (input[key] === undefined || input[key] === null) return null
      const value = text(input[key], max)
      if (!value) throw new Error(`${key} wajib diisi.`)
      return value
    }
    const machine_type = optional("machine_type", 3)?.toUpperCase() || null
    if (machine_type && !["ATM", "CRM"].includes(machine_type)) throw new Error("Jenis harus ATM atau CRM.")
    return { ...base, tid, denom: normalizeDenom(input.denom), branch: text(input.branch, 150), cluster_flm: text(input.cluster_flm, 100), sub_cluster_rpl: text(input.sub_cluster_rpl, 100), avg_daily_transaction: avg,
      location: optional("location", 250), machine_type, cluster: optional("cluster", 100) }
  }
  if (input.type === "settings") {
    const limits = { total_clusters: [0, 100000], team_capacity: [1, 1000], bundle_size: [1, 1000000], atm_limit: [1, 10000000], crm_limit: [1, 10000000], all_denom_value: [1, 1000000] }
    const settings = {}
    for (const [key, [min, max]] of Object.entries(limits)) {
      const value = input.settings?.[key]
      if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} harus bilangan bulat ${min}–${max}.`)
      settings[key] = value
    }
    for (const key of ["findings", "dominant_cause", "execution_obstacles", "follow_up", "narrative_override"]) settings[key] = text(input.settings?.[key] ?? "")
    return { ...base, settings }
  }
  if (input.type === "detail") {
    if (!["planning", "dsr"].includes(input.kind) || !Number.isInteger(input.source_row) || input.source_row < 1 || input.source_row > MAX_EXCEL_ROW) throw new Error("Baris data tidak valid.")
    return { ...base, kind: input.kind, source_row: input.source_row, cause: text(input.cause), obstacle: text(input.obstacle), note: text(input.note) }
  }
  throw new Error("Jenis perubahan tidak valid.")
}

export function buildReport(data, filters = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...data.settings }
  const days = new Date(Date.UTC(Number(data.period.slice(0, 4)), Number(data.period.slice(5, 7)), 0)).getUTCDate()
  const profiles = new Map((data.parameters || []).map(r => [tidKey(r.tid), r]))
  const groups = new Map()
  // Copies protect stored inputs. Recompute matching for uploads made by older versions too.
  const planning = data.planning.map(r => ({ ...r })), dsr = data.dsr.map(r => ({ ...r }))
  evaluateRows(planning, dsr)
  for (const [rows, kind] of [[planning, "planning"], [dsr, "dsr"]]) {
    for (const row of rows) {
      const key = tidKey(row.tid)
      const profile = profiles.get(key) || {}
      for (const field of ["location", "machine_type", "cluster"]) if (profile[field]) row[field] = profile[field]
      if (!groups.has(key)) {
        groups.set(key, { tid: row.tid, location: row.location, machine_type: row.machine_type, cluster: row.cluster, branch: profile.branch || data.reporting_unit, denom: profile.denom || null, cluster_flm: profile.cluster_flm || "", sub_cluster_rpl: profile.sub_cluster_rpl || "", avg_daily_transaction: profile.avg_daily_transaction ?? null, metadata_source: profile.metadata_source || "Belum dilengkapi", planning: [], dsr: [] })
      }
      groups.get(key)[kind].push(row)
      row.denom = groups.get(key).denom
    }
  }
  const allGroups = [...groups.values()]
  const search = (filters.search || "").toLocaleLowerCase("id-ID")
  const visible = allGroups.filter(r => (!filters.cluster || tidKey(r.cluster) === tidKey(filters.cluster)) && (!filters.machine || r.machine_type === filters.machine) && (!search || [r.tid, r.location, r.cluster, r.sub_cluster_rpl].some(v => v.toLocaleLowerCase("id-ID").includes(search))))
  const p = visible.flatMap(r => r.planning).sort((a, b) => a.source_row - b.source_row)
  const d = visible.flatMap(r => r.dsr).sort((a, b) => a.source_row - b.source_row)
  const summary = evaluateRows(p, d)
  summary.total_clusters = settings.total_clusters
  summary.unique_tids = visible.length
  summary.missing_denom = visible.filter(r => !r.denom).length
  const daily = Array.from({ length: days }, (_, i) => {
    const date = `${data.period}-${String(i + 1).padStart(2, "0")}`
    const counts = evaluateRows(p.filter(r => r.event_date === date), d.filter(r => r.event_date === date))
    return { day: i + 1, ...counts, grand_total: counts.forecast + counts.not_forecast }
  })
  const categories = STATUSES.map((status, i) => ({ status, definition: ["Forecast Ya / Realisasi Ya", "Forecast Ya / Realisasi Tidak", "Forecast Tidak / Realisasi Ya", "Forecast Tidak / Realisasi Tidak"][i], count: [summary.matched_planning, summary.false_positive, summary.false_negative, summary.no_rpl][i], share: ratio([summary.matched_planning, summary.false_positive, summary.false_negative, summary.no_rpl][i], p.length) }))
  const causes = new Map()
  for (const row of [...p.filter(r => r.status === STATUSES[1]), ...d.filter(r => r.status === STATUSES[2])]) {
    const cause = row.cause || "Belum diisi", key = `${row.status}|${cause}`
    const item = causes.get(key) || { status: row.status, cause, count: 0 }
    item.count++; causes.set(key, item)
  }
  const totals = Array.from({ length: days }, (_, i) => ({ day: i + 1, planning_sheets: 0, dsr_sheets: 0, planning_cash: 0, dsr_cash: 0, planning_points: 0, dsr_points: 0, planning_missing_denom: 0, dsr_missing_denom: 0 }))
  const schedule = visible.map(group => {
    const row = { ...group }; delete row.planning; delete row.dsr
    row.dates = {}; row.planning_count = 0; row.dsr_count = 0
    const value = denominator(row.denom, settings)
    for (const kind of ["planning", "dsr"]) {
      for (const r of firstByDate(group[kind]).values()) {
        const day = Number(r.event_date.slice(8)), total = totals[day - 1]
        if (!total) continue
        const pair = row.dates[day] || { planning: null, dsr: null }
        pair[kind] = { sheets: r.sheets, status: r.status, source_row: r.source_row, cash: value === null && r.sheets > 0 ? null : r.sheets * (value || 0) }
        row.dates[day] = pair
        if (r.sheets > 0) row[`${kind}_count`]++
        total[`${kind}_points`]++
        total[`${kind}_sheets`] += r.sheets
        if (value === null && r.sheets > 0) total[`${kind}_missing_denom`]++
        else total[`${kind}_cash`] = addInteger(total[`${kind}_cash`], r.sheets * (value || 0))
      }
    }
    row.frequency = row.planning_count ? Math.round(days / row.planning_count) : null
    // Jadwal J:Q: CRM transaction conversion uses the All Denom assumption.
    const trxDenom = row.machine_type === "CRM" ? settings.all_denom_value : value
    row.average_pattern_transaction = row.avg_daily_transaction === null || row.frequency === null ? null : row.avg_daily_transaction * row.frequency
    row.average_daily_sheets = row.avg_daily_transaction === null || !trxDenom ? null : row.avg_daily_transaction / trxDenom
    row.average_pattern_sheets = row.average_daily_sheets === null || row.frequency === null ? null : row.average_daily_sheets * row.frequency
    row.pagu_sheets = row.average_pattern_sheets === null ? null : Math.ceil(row.average_pattern_sheets / settings.bundle_size) * settings.bundle_size
    row.pagu_cash = row.pagu_sheets === null || !trxDenom ? null : row.pagu_sheets * trxDenom
    const limit = row.machine_type === "ATM" ? settings.atm_limit : settings.crm_limit
    row.pagu_status = row.pagu_sheets === null ? "Belum lengkap" : row.pagu_sheets > limit ? "Melebihi Pagu" : row.pagu_sheets === limit ? "Maksimum Pagu" : "Minimum Pagu"
    return row
  })
  for (const total of totals) for (const kind of ["planning", "dsr"]) {
    total[`${kind}_known_cash`] = total[`${kind}_cash`]
    if (total[`${kind}_missing_denom`]) total[`${kind}_cash`] = null
    total[`${kind}_teams`] = Math.ceil(total[`${kind}_points`] / settings.team_capacity)
  }
  const grand = {}
  for (const field of Object.keys(totals[0]).filter(k => k !== "day")) grand[field] = totals.some(t => t[field] === null) ? null : totals.reduce((sum, t) => addInteger(sum, t[field]), 0)
  const page = filters.page || 0, size = 50, start = page * size
  const detailSource = filters.view === "dsr" ? d : p
  const details = filters.status ? detailSource.filter(r => r.status === filters.status) : detailSource
  const percent = v => `${(v * 100).toFixed(1).replace(".", ",")}%`
  const narrative = `Pada periode ${data.period_label || data.period}, ${summary.implemented_clusters} cluster memiliki data perencanaan${settings.total_clusters ? ` dari ${settings.total_clusters} total cluster` : ""}. Perencanaan menghasilkan ${summary.forecast} forecast dan terdapat ${summary.realized} realisasi RPL. Forecast accuracy ${percent(summary.forecast_accuracy)}; porsi realisasi yang sesuai forecast ${percent(summary.realization_match)}. False Positive ${summary.false_positive} dan False Negative ${summary.false_negative}.`
  return { id: data.id, revision: data.revision || 0, reporting_uker_id: data.reporting_uker_id ?? null, parameter_revision: data.parameter_revision ?? null, period: data.period, period_label: data.period_label, reporting_unit: data.reporting_unit, settings, warnings: data.warnings || [], summary, days, daily, categories, causes: [...causes.values()].sort((a, b) => b.count - a.count), narrative: settings.narrative_override || narrative, automatic_narrative: narrative, totals: totals.map(jsonIntegers), grand: jsonIntegers(grand), clusters: [...new Set(allGroups.map(r => r.cluster))].sort(), schedule: { items: schedule.slice(start, start + size), total: schedule.length }, details: { items: details.slice(start, start + size), total: details.length }, page, page_size: size, reference_fc: (data.reference_fc || []).slice(start, start + size), reference_fc_count: data.reference_fc?.length || 0 }
}
