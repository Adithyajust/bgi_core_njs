"use client"

import { Fragment, useEffect, useRef, useState } from "react"
import { CAUSES, DEFAULT_SETTINGS, STATUSES } from "@/modules/rpl-terjadwal/calculations"

const API = "/api/rpl-terjadwal"
const number = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 })
const num = v => v == null ? "—" : number.format(v)
const pct = v => v == null ? "—" : `${(v * 100).toFixed(2).replace(".", ",")}%`
const TABS = [["guide", "Petunjuk Pengisian"], ["planning", "Data Detail TID Perencanaan"], ["dsr", "Data Detail TID DSR"], ["daily", "Daily_Accuracy"], ["kpi", "Rekap KPI"], ["management", "Ringkasan Manajemen"], ["schedule", "Jadwal RPL vs Realisasi"], ["edit", "Edit"]]
const SETTING_LABELS = { total_clusters: "Total cluster pelaporan", team_capacity: "Kapasitas point per tim per hari", bundle_size: "Kelipatan pembulatan pagu (lembar)", atm_limit: "Batas pagu ATM (lembar)", crm_limit: "Batas pagu CRM (lembar)", all_denom_value: "Nilai estimasi All Denom (Rp/lembar)" }
const NOTE_LABELS = { findings: "Temuan utama", dominant_cause: "Penyebab dominan False Positive / False Negative", execution_obstacles: "Kendala pelaksanaan", follow_up: "Rencana tindak lanjut dan PIC", narrative_override: "Narasi pelaporan (kosongkan untuk narasi otomatis)" }

async function fetchData(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", credentials: "include", ...options })
  if (!(response.headers.get("content-type") || "").includes("application/json")) throw new Error("Sesi login berakhir atau respons server tidak valid. Muat ulang halaman.")
  const result = await response.json()
  if (!response.ok || !result.success) throw new Error(result.message || "Laporan gagal dimuat.")
  return result.data
}

function Grid({ headers, rows, label }) {
  return <div className="table-wrap rpl-upload-table" tabIndex={0} aria-label={label}><table><thead><tr>{headers.map((h, i) => <th scope="col" key={i}>{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell ?? "—"}</td>)}</tr>)}</tbody></table>{!rows.length && <p className="rpl-upload-empty">Tidak ada data untuk filter ini.</p>}</div>
}
function Status({ value }) { return <span className={`rpl-status rpl-status-${STATUSES.indexOf(value)}`}>{value}</span> }

function Indicators({ report }) {
  const s = report.summary
  return <Grid label="Indikator Rekap KPI" headers={["Indikator", "Nilai", "Dasar perhitungan"]} rows={[
    ["Total Cluster", s.total_clusters || "Belum diisi", "Isian pelaporan di tab Edit"], ["Cluster Implemented", num(s.implemented_clusters), "Cluster unik pada Perencanaan"],
    ["Total Forecast (Perencanaan)", num(s.forecast), "Forecast = Ya pada Perencanaan"], ["Total Realisasi RPL", num(s.realized), "Realisasi = Ya pada DSR"],
    ["Forecast Accuracy", pct(s.forecast_accuracy), "Sesuai Perencanaan / Total Forecast"], ["% Sesuai", pct(s.realization_match), "Sesuai DSR / Total Realisasi"],
    ["% Dijadwalkan tapi tidak perlu RPL", pct(s.false_positive_rate), "False Positive / Total Forecast"], ["% Tidak dijadwalkan namun harus RPL", pct(s.false_negative_rate), "False Negative / Total Realisasi"]
  ]} />
}
function Guide() {
  return <>
    <Grid label="Petunjuk pengisian RPL" headers={["Tahap", "Proses"]} rows={[
      ["1. Parameter TID", "Pilih unit pelaporan lalu upload sheet rpl_tid_parameter secara terpisah. Parameter dapat diubah kapan saja dan dipakai untuk upload RPL berikutnya."],
      ["2. Perencanaan", "Pilih periode lalu isi kolom A–J sesuai template baru. F: Pagu Perencanaan, G: Forecast, H–J: Penyebab, Kendala, Catatan. Date adalah angka hari dalam bulan."],
      ["3. DSR", "Isi kolom A–J. F: Pagu Realisasi, G: Realisasi Ya/Tidak, H–J: Penyebab, Kendala, Catatan. Pasangan dan Status dihitung berdasarkan TID + tanggal."],
      ["4. Preview dan simpan", "Perbaiki semua kesalahan sebelum menyimpan kedua sheet sebagai satu versi database."],
      ["5. Lengkapi isian", "Tab Edit mengubah parameter hanya untuk versi laporan terpilih. Gunakan Terapkan parameter terbaru untuk mengambil master terbaru. Rata-rata transaksi harian dan parameter perhitungan tetap dapat diubah di sini."],
      ["6. Evaluasi", "Daily_Accuracy dan Rekap KPI dihitung dari baris detail. Isi penyebab, kendala, dan catatan melalui tombol Catatan pada baris terkait."],
      ["7. Pelaporan", "Isi analisa, tindak lanjut, dan PIC pada Ringkasan Manajemen. Bandingkan pagu per tanggal pada Jadwal RPL vs Realisasi."],
      ["8. Pemeriksaan", "KPI menghitung setiap kejadian. Grid jadwal dan pencocokan menggunakan kejadian pertama per TID + tanggal, mengikuti INDEX/MATCH pada Excel."]
    ]} />
    <h4>Definisi status</h4><Grid label="Definisi status RPL" headers={["Status", "Definisi", "Tindak lanjut"]} rows={[
      ["Sesuai", "Forecast Ya dan Realisasi Ya", "Monitor konsistensi forecast."], ["False Positive", "Forecast Ya dan Realisasi Tidak", "Evaluasi parameter forecast dan catat penyebab."], ["False Negative", "Forecast Tidak dan Realisasi Ya", "Prioritaskan analisa penyebab."], ["Tidak Ada RPL", "Forecast Tidak dan Realisasi Tidak", "Tidak ada kejadian RPL pada pasangan data ini."]
    ]} />
  </>
}

function Daily({ report }) {
  const fields = [["Forecast Ya", "forecast"], ["Sesuai", "matched_planning"], ["False Positive", "false_positive"], ["Forecast Accuracy", "forecast_accuracy", true], ["% Dijadwalkan tapi tidak perlu RPL", "false_positive_rate", true], ["Forecast Tidak (DSR)", "not_forecast"], ["False Negative", "false_negative"], ["Grand Total", "grand_total"]]
  return <><p className="rpl-upload-help">Susunan mengikuti Daily_Accuracy. Persentase Grand Total dihitung dari total kejadian bulan tersebut. Grand Total kejadian = Forecast Ya + Forecast Tidak pada DSR.</p><Grid label="Daily Accuracy per tanggal" headers={["Forecast / Status", ...report.daily.map(r => r.day), "Grand Total"]} rows={fields.map(([label, field, percent]) => [label, ...report.daily.map(r => percent ? pct(r[field]) : num(r[field])), percent ? pct(report.summary[field]) : num(field === "grand_total" ? report.summary.forecast + report.summary.not_forecast : report.summary[field])])} /></>
}

function Schedule({ report, mode, measure }) {
  const days = Array.from({ length: report.days }, (_, i) => i + 1)
  const kinds = mode === "both" ? ["planning", "dsr"] : [mode]
  const fixedHeaders = ["TID", "Lokasi", "Kantor Cabang", "Jenis", "Denom", "Cluster FLM", "Cluster RPL", "Sub Cluster RPL", "Pagu (Rp)", "Pagu (lbr)", "Ratas Transaksi Harian (Rp)", "Ratas Transaksi Pola (Rp)", "Ratas Lembar Harian", "Ratas Lembar berdasarkan Frekuensi", "Status Pagu", "Pola Frekuensi RPL (hari)", "Data"]
  const totals = kinds.flatMap(kind => [["Kas (Rp miliar)", `${kind}_cash`, true], ["Total Point", `${kind}_points`], ["Kebutuhan Tim", `${kind}_teams`]].map(([label, field, cash]) => ({ label: `${kind === "planning" ? "Rencana" : "Realisasi"} · ${label}`, field, cash })))
  const formatCash = v => v === null ? "Belum lengkap" : num(v / 1e9)
  return <>
    <p className="rpl-upload-help">Tanggal menampilkan {measure === "sheets" ? "lembar" : "rupiah"}. Pola = jumlah hari dalam bulan / jumlah tanggal rencana dengan pagu &gt; 0, dibulatkan. Total tim adalah penjumlahan kebutuhan harian ({report.settings.team_capacity} point per tim). Angka ringkasan mencakup seluruh hasil filter.</p>
    <div className="table-wrap rpl-upload-table rpl-schedule" tabIndex={0} aria-label="Jadwal RPL vs Realisasi, geser untuk melihat semua tanggal"><table><thead><tr>{fixedHeaders.map((h, i) => <th className={i < 2 ? `rpl-freeze-${i}` : ""} scope="col" key={h}>{h}</th>)}{days.map(day => <th scope="col" key={day}>{day}</th>)}<th scope="col">Jumlah RPL</th></tr></thead><tbody>
      {totals.map(({ label, field, cash }) => <tr className="rpl-total-row" key={field}><th colSpan={fixedHeaders.length} scope="row">{label}</th>{report.totals.map(t => <td key={t.day}>{cash ? formatCash(t[field]) : num(t[field])}</td>)}<td>{cash ? formatCash(report.grand[field]) : num(report.grand[field])}</td></tr>)}
      {report.schedule.items.map(row => <Fragment key={row.tid}>{kinds.map((kind, idx) => <tr key={kind} className={kind === "dsr" ? "rpl-realized-row" : ""}>
        {idx === 0 && <><th scope="row" rowSpan={kinds.length} className="rpl-freeze-0">{row.tid}</th><td rowSpan={kinds.length} className="rpl-freeze-1">{row.location}</td>{[row.branch, row.machine_type, row.denom || "Belum diisi", row.cluster_flm || "—", row.cluster, row.sub_cluster_rpl || "—", num(row.pagu_cash), num(row.pagu_sheets), num(row.avg_daily_transaction), num(row.average_pattern_transaction), num(row.average_daily_sheets), num(row.average_pattern_sheets), row.pagu_status, num(row.frequency)].map((value, i) => <td key={i} rowSpan={kinds.length}>{value}</td>)}</>}
        <th scope="row">{kind === "planning" ? "Rencana" : "Realisasi"}</th>
        {days.map(day => { const cell = row.dates[day]?.[kind]; return <td key={day} className={cell ? `rpl-day rpl-day-${STATUSES.indexOf(cell.status)}` : ""} title={cell ? `${cell.status} · baris ${cell.source_row}` : "Tidak ada baris data"}>{cell ? measure === "sheets" ? num(cell.sheets) : cell.cash === null ? "Belum lengkap" : num(cell.cash) : "—"}</td> })}
        <td>{num(row[`${kind}_count`])}</td>
      </tr>)}</Fragment>)}
    </tbody></table>{!report.schedule.items.length && <p className="rpl-upload-empty">Tidak ada TID untuk filter ini.</p>}</div>
    <p className="rpl-upload-help">All Denom menggunakan estimasi /lembar sesuai parameter Excel. Pagu J–P memerlukan rata-rata transaksi harian; lengkapi pada tab Edit. Sel hijau = Sesuai, jingga = False Positive, merah = False Negative. “Sesuai” membandingkan kejadian, sehingga jumlah lembar masih dapat berbeda.</p>
  </>
}

function Editor({ draft, setDraft, busy, onSave, onCancel }) {
  const anchor = useRef(null)
  useEffect(() => { anchor.current?.focus(); anchor.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }) }, [])
  const field = (key, value) => setDraft(current => ({ ...current, [key]: value }))
  return <form className="rpl-editor" onSubmit={e => { e.preventDefault(); onSave() }}>
    <h4 ref={anchor} tabIndex={-1}>{draft.type === "tid" ? `Isian TID ${draft.tid}` : draft.type === "detail" ? `Catatan ${draft.kind === "planning" ? "Perencanaan" : "DSR"} · baris ${draft.source_row}` : "Parameter dan pelaporan"}</h4>
    {draft.type === "apply" && <p>Parameter master revisi {draft.parameter_revision} akan diterapkan pada semua TID yang cocok dalam laporan #{draft.batch}. TID tanpa pasangan tetap memakai parameter sebelumnya. Rata-rata transaksi harian, catatan, dan data kejadian tetap dipertahankan.</p>}
    {draft.type === "tid" && <div className="rpl-edit-fields">
      <label>Lokasi<input required value={draft.location || ""} maxLength={250} disabled={busy} onChange={e => field("location", e.target.value)} /></label>
      <label>Jenis<select value={draft.machine_type} disabled={busy} onChange={e => field("machine_type", e.target.value)}><option value="ATM">ATM</option><option value="CRM">CRM</option></select></label>
      <label>Cluster RPL<input required value={draft.cluster || ""} maxLength={100} disabled={busy} onChange={e => field("cluster", e.target.value)} /></label>
      <label>Denom<select value={draft.denom || ""} disabled={busy} onChange={e => field("denom", e.target.value || null)}><option value="">Belum diisi</option><option value="50000">50.000</option><option value="100000">100.000</option><option value="All Denom">All Denom</option></select></label>
      <label>Kantor Cabang<input value={draft.branch} maxLength={150} disabled={busy} onChange={e => field("branch", e.target.value)} /></label>
      <label>Cluster FLM<input value={draft.cluster_flm} maxLength={100} disabled={busy} onChange={e => field("cluster_flm", e.target.value)} /></label>
      <label>Sub Cluster RPL<input value={draft.sub_cluster_rpl} maxLength={100} disabled={busy} onChange={e => field("sub_cluster_rpl", e.target.value)} /></label>
      <label>Rata-rata transaksi harian (Rp)<input type="number" min="0" max="1000000000000" step="0.01" value={draft.avg_daily_transaction ?? ""} disabled={busy} onChange={e => field("avg_daily_transaction", e.target.value === "" ? null : Number(e.target.value))} /><small>Masukkan transaksi harian; nilai ini tidak tersedia pada kedua sheet detail.</small></label>
    </div>}
    {draft.type === "detail" && <div className="rpl-edit-fields"><label>Penyebab<input list="rpl-causes" value={draft.cause} maxLength={4000} disabled={busy} onChange={e => field("cause", e.target.value)} /><datalist id="rpl-causes">{CAUSES.map(c => <option key={c} value={c} />)}</datalist></label><label>Kendala<textarea value={draft.obstacle} maxLength={4000} disabled={busy} onChange={e => field("obstacle", e.target.value)} /></label><label>Catatan tambahan<textarea value={draft.note} maxLength={4000} disabled={busy} onChange={e => field("note", e.target.value)} /></label></div>}
    {draft.type === "settings" && <><div className="rpl-edit-fields">{Object.entries(SETTING_LABELS).map(([key, label]) => <label key={key}>{label}<input required type="number" min={key === "total_clusters" ? "0" : "1"} step="1" value={draft.settings[key]} disabled={busy} onChange={e => field("settings", { ...draft.settings, [key]: e.target.value === "" ? "" : Number(e.target.value) })} /></label>)}</div><div className="rpl-edit-fields">{Object.entries(NOTE_LABELS).map(([key, label]) => <label key={key}>{label}<textarea rows={3} value={draft.settings[key]} maxLength={4000} disabled={busy} onChange={e => field("settings", { ...draft.settings, [key]: e.target.value })} /></label>)}</div></>}
    <div className="rpl-upload-actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan perubahan"}</button><button className="ghost-button" type="button" disabled={busy} onClick={onCancel}>Batal</button></div>
  </form>
}

export default function RplReport({ batch }) {
  const [view, setView] = useState("planning"), [search, setSearch] = useState(""), [cluster, setCluster] = useState(""), [machine, setMachine] = useState(""), [status, setStatus] = useState("")
  const [page, setPage] = useState(0), [refresh, setRefresh] = useState(0), [report, setReport] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState("")
  const [draft, setDraft] = useState(null), [saving, setSaving] = useState(false), [saved, setSaved] = useState("")
  const [mode, setMode] = useState("both"), [measure, setMeasure] = useState("sheets")
  const saveLock = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true); setError("")
      try {
        const params = new URLSearchParams({ batch: String(batch.id), view, search, cluster, machine, status, page: String(page) })
        const data = await fetchData(`${API}?${params}`, { signal: controller.signal })
        if (!controller.signal.aborted) setReport(data)
      } catch (e) { if (!controller.signal.aborted) { setError(e.message); setReport(null) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, search ? 250 : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [batch.id, view, search, cluster, machine, status, page, refresh])
  function filter(setter, value) { setter(value); setPage(0); setLoading(true) }
  function openEditor(value) { setDraft({ ...value, batch: batch.id, revision: report.revision }); setError(""); setSaved("") }
  async function prepareApply() {
    if (saveLock.current || !report?.reporting_uker_id) return
    saveLock.current = true; setSaving(true); setError("")
    try {
      const data = await fetchData(`${API}/parameters?uker_id=${report.reporting_uker_id}`)
      if (!data.master_total) throw new Error("Belum ada master parameter pada unit laporan ini. Upload parameter terlebih dahulu.")
      openEditor({ type: "apply", uker_id: Number(report.reporting_uker_id), parameter_revision: data.revision })
    } catch (e) { setError(e.message) }
    finally { saveLock.current = false; setSaving(false) }
  }
  async function save() {
    if (saveLock.current) return
    saveLock.current = true; setSaving(true); setError("")
    try {
      const result = await fetchData(draft.type === "apply" ? `${API}/parameters` : API, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) })
      setDraft(null); setSaved(draft.type === "apply" ? `Parameter ${result.matched} TID diperbarui; ${result.unmatched} TID tanpa pasangan tetap memakai parameter sebelumnya. Seluruh grid dihitung ulang.` : "Perubahan tersimpan. Seluruh grid dihitung ulang."); setLoading(true); setRefresh(v => v + 1)
    }
    catch (e) { setError(e.message) }
    finally { saveLock.current = false; setSaving(false) }
  }
  const listTotal = !report ? 0 : ["schedule", "edit"].includes(view) ? report.schedule.total : report.details.total
  const paginated = ["planning", "dsr", "schedule", "edit"].includes(view)
  const disabled = !!draft || saving
  return <section className="panel rpl-report" aria-labelledby="rpl-report-title">
    <div className="panel-header"><div><p className="eyebrow">Workbook RPL · Upload #{batch.id}</p><h3 id="rpl-report-title">{batch.reporting_unit} · {batch.period}</h3></div><button type="button" className="ghost-button" disabled={disabled || loading} onClick={() => { setLoading(true); setRefresh(v => v + 1) }}>Muat ulang laporan</button></div>
    <nav className="rpl-sheet-tabs" aria-label="Sheet workbook">{TABS.map(([id, label]) => <button type="button" key={id} aria-pressed={view === id} className={view === id ? "primary-button" : "ghost-button"} disabled={disabled} onClick={() => { filter(setView, id); setStatus(""); setSaved("") }}>{label}</button>)}</nav>
    {view !== "guide" && <div className="rpl-report-filters">
      <label>Cari TID, lokasi, cluster<input value={search} maxLength={250} disabled={disabled} onChange={e => filter(setSearch, e.target.value)} /></label>
      <label>Cluster<select value={cluster} disabled={disabled} onChange={e => filter(setCluster, e.target.value)}><option value="">Semua cluster</option>{report?.clusters.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
      <label>Jenis mesin<select value={machine} disabled={disabled} onChange={e => filter(setMachine, e.target.value)}><option value="">Semua jenis</option><option value="ATM">ATM</option><option value="CRM">CRM</option></select></label>
      {["planning", "dsr"].includes(view) && <label>Status detail<select value={status} disabled={disabled} onChange={e => filter(setStatus, e.target.value)}><option value="">Semua status</option>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>}
      {(search || cluster || machine || status) && <button type="button" className="ghost-button" disabled={disabled} onClick={() => { setSearch(""); setCluster(""); setMachine(""); setStatus(""); setPage(0); setLoading(true) }}>Hapus filter</button>}
    </div>}
    {error && <p role="alert" className="rpl-upload-error">{error}</p>}{saved && <p role="status" className="rpl-upload-success">{saved}</p>}
    {draft && <Editor draft={draft} setDraft={setDraft} busy={saving} onSave={save} onCancel={() => setDraft(null)} />}
    {view === "guide" ? <Guide /> : loading ? <p role="status">Menghitung dan memuat grid…</p> : report && <>
      <p className="rpl-upload-help">{num(report.summary.unique_tids)} TID · {num(report.summary.planning_rows)} baris Perencanaan · {num(report.summary.dsr_rows)} baris DSR. Laporan menggunakan versi upload yang dipilih{search || cluster || machine ? " dan filter aktif" : ""}.</p>
      {report.summary.missing_denom > 0 && <p className="rpl-upload-warning">{num(report.summary.missing_denom)} TID belum memiliki Denom. Lengkapi pada tab Edit agar nilai rupiah dapat dihitung.</p>}
      {["planning", "dsr"].includes(view) && <><p className="rpl-upload-help">Denom berasal dari parameter yang tersimpan pada versi laporan ini. Perbarui melalui tab Edit. Tombol Catatan memperbarui penyebab, kendala, dan catatan tambahan.</p><Grid label={TABS.find(t => t[0] === view)[1]} headers={["Baris", "Date", "TID", "Nama Lokasi", "Jenis Mesin", "Cluster", view === "planning" ? "Pagu Perencanaan (lembar)" : "Pagu Realisasi (lembar)", "Forecast", "Realisasi", "Status", "Penyebab", "Kendala", "Catatan Tambahan", "Denom", "Aksi"]} rows={report.details.items.map(r => [r.source_row, r.event_date, r.tid, r.location, r.machine_type, r.cluster, num(r.sheets), r.forecast ? "Ya" : "Tidak", r.realized ? "Ya" : "Tidak", <Status key="status" value={r.status} />, r.cause, r.obstacle, r.note, r.denom || "Belum diisi", <button key="edit" type="button" className="ghost-button" disabled={disabled} onClick={() => openEditor({ type: "detail", kind: view, source_row: r.source_row, cause: r.cause || "", obstacle: r.obstacle || "", note: r.note || "" })}>Catatan</button>])} /></>}
      {view === "daily" && <Daily report={report} />}
      {view === "kpi" && <><Indicators report={report} /><h4>Rincian Evaluasi Forecasting</h4><Grid label="Rincian evaluasi forecasting" headers={["Kategori", "Definisi", "Jumlah kejadian", "% terhadap baris Perencanaan"]} rows={[...report.categories.map(r => [r.status, r.definition, num(r.count), pct(r.share)]), ["Total TID terisi", "Jumlah baris Perencanaan", num(report.summary.planning_rows), report.summary.planning_rows ? "100,00%" : "0,00%"]]} /><p className="rpl-upload-help">Persentase rincian mengikuti kolom D Excel: pembagi seluruh baris Perencanaan, termasuk untuk False Negative, sehingga dapat melebihi 100%. KPI False Negative di atas menggunakan total Realisasi sebagai pembagi.</p></>}
      {view === "management" && <><h4>Snapshot KPI</h4><Indicators report={report} /><h4>Narasi Pelaporan</h4><p className="rpl-narrative">{report.narrative}</p><Grid label="Analisa dan tindak lanjut" headers={["Poin analisa", "Isian"]} rows={Object.entries(NOTE_LABELS).filter(([k]) => k !== "narrative_override").map(([k, label]) => [label, report.settings[k] || "Belum diisi"])} /><div className="rpl-upload-actions"><button type="button" className="ghost-button" disabled={disabled} onClick={() => openEditor({ type: "settings", settings: { ...DEFAULT_SETTINGS, ...report.settings } })}>Ubah narasi dan tindak lanjut</button></div><h4>Penyebab False Positive / False Negative</h4><Grid label="Rekap penyebab" headers={["Status", "Penyebab", "Jumlah kejadian"]} rows={report.causes.map(r => [r.status, r.cause, num(r.count)])} /></>}
      {view === "schedule" && <><div className="rpl-upload-actions"><label>Tampilan<select value={mode} onChange={e => setMode(e.target.value)}><option value="both">Rencana & Realisasi</option><option value="planning">Rencana</option><option value="dsr">Realisasi</option></select></label><label>Satuan tanggal<select value={measure} onChange={e => setMeasure(e.target.value)}><option value="sheets">Lembar</option><option value="cash">Rupiah</option></select></label></div><Schedule report={report} mode={mode} measure={measure} /></>}
      {view === "edit" && <><h4>Isian TID untuk Jadwal RPL</h4>{report.reporting_uker_id ? <div className="rpl-upload-actions"><button className="ghost-button" type="button" disabled={disabled || loading} onClick={prepareApply}>Terapkan parameter terbaru</button></div> : <p className="rpl-upload-help">Versi lama ini belum terhubung ke unit master. Parameter tetap dapat diubah per TID di bawah.</p>}<p className="rpl-upload-help">Perubahan di sini berlaku pada upload #{batch.id}. Master parameter dapat diedit di panel Upload dan kelola parameter. Terapkan master terbaru bila ingin memperbarui versi laporan ini. Perubahan parameter berlaku untuk seluruh tanggal TID pada Perencanaan dan DSR.</p><Grid label="Isian TID" headers={["TID", "Lokasi", "Jenis", "Denom", "Kantor Cabang", "Cluster RPL", "Cluster FLM", "Sub Cluster RPL", "Rata-rata transaksi harian (Rp)", "Sumber isian", "Aksi"]} rows={report.schedule.items.map(r => [r.tid, r.location, r.machine_type, r.denom || "Belum diisi", r.branch, r.cluster, r.cluster_flm, r.sub_cluster_rpl, num(r.avg_daily_transaction), r.metadata_source, <button key="edit" type="button" className="ghost-button" disabled={disabled} onClick={() => openEditor({ type: "tid", tid: r.tid, location: r.location, machine_type: r.machine_type, cluster: r.cluster, denom: r.denom, branch: r.branch, cluster_flm: r.cluster_flm, sub_cluster_rpl: r.sub_cluster_rpl, avg_daily_transaction: r.avg_daily_transaction })}>Ubah</button>])} /><h4>Parameter perhitungan</h4><Grid label="Parameter Excel" headers={["Parameter", "Nilai"]} rows={Object.entries(SETTING_LABELS).map(([k, label]) => [label, num(report.settings[k])])} /><div className="rpl-upload-actions"><button type="button" className="ghost-button" disabled={disabled} onClick={() => openEditor({ type: "settings", settings: { ...DEFAULT_SETTINGS, ...report.settings } })}>Ubah parameter</button></div>{report.reference_fc_count > 0 && <details><summary>Daftar FC dari sheet Edit ({num(report.reference_fc_count)} baris referensi)</summary><p className="rpl-upload-help">Daftar asli dipertahankan sebagai referensi. Sheet lain pada Excel tidak menggunakan daftar ini dalam rumus. Halaman mengikuti nomor halaman grid TID di bawah.</p><Grid label="Referensi FC dari Excel" headers={["Baris Excel", "FC / TID"]} rows={report.reference_fc.map(r => [r.source_row, r.tid])} /></details>}</>}
      {paginated && <div className="rpl-upload-actions rpl-pagination"><button type="button" className="ghost-button" disabled={disabled || page === 0} onClick={() => { setPage(v => v - 1); setLoading(true) }}>Sebelumnya</button><span>Halaman {page + 1} / {Math.max(1, Math.ceil(listTotal / 50))} · {num(listTotal)} {view === "edit" || view === "schedule" ? "TID" : "baris"}</span><button type="button" className="ghost-button" disabled={disabled || (page + 1) * 50 >= listTotal} onClick={() => { setPage(v => v + 1); setLoading(true) }}>Berikutnya</button></div>}
      {!!report.warnings.length && <details className="rpl-import-notes"><summary>Catatan saat upload</summary>{report.warnings.map((w, i) => <p key={i} className="rpl-upload-help">{w}</p>)}</details>}
    </>}
  </section>
}
