"use client"
import { useEffect, useRef, useState } from "react"
import { ReplenishAutocomplete } from "@/components/replenish-autocomplete"
import RplReport from "./report-client"
import RplParameters from "./parameter-client"
import "./rpl-upload.css"

const API = "/api/rpl-terjadwal"
const num = v => new Intl.NumberFormat("id-ID").format(v || 0)
const pct = v => v == null ? "—" : `${(v * 100).toFixed(2).replace(".", ",")}%`
async function fetchJson(url, options = {}) {
  const response = await fetch(url, { credentials: "include", cache: "no-store", ...options })
  if (!(response.headers.get("content-type") || "").includes("application/json")) throw new Error("Respons server tidak valid. Periksa sesi login dan versi aplikasi.")
  const result = await response.json()
  if (!response.ok || !result.success) { const e = new Error(result.message || "Permintaan gagal."); e.data = result.data; throw e }
  return result.data
}
function Summary({ data }) {
  if (!data) return null
  return <div className="rpl-upload-metrics">{[["Forecast", num(data.forecast)], ["Realisasi", num(data.realized)], ["Forecast Accuracy", pct(data.forecast_accuracy)], ["Kesesuaian Realisasi", pct(data.realization_match)]].map(([label, value]) => <article className="settings-card" key={label}><p>{label}</p><strong>{value}</strong></article>)}</div>
}
function DataTable({ rows }) {
  return <div className="table-wrap rpl-upload-table" tabIndex={0} aria-label="Data Excel, geser horizontal untuk kolom lainnya"><table><thead><tr>{["Baris Excel", "Tanggal", "TID", "Nama Lokasi", "Jenis Mesin", "Cluster", "Pagu (lembar)", "Forecast", "Realisasi", "Status", "Penyebab", "Kendala", "Catatan", "Denom"].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{rows.map(r => <tr key={r.source_row}><td>{r.source_row}</td><td>{r.event_date}</td><td>{r.tid}</td><td>{r.location}</td><td>{r.machine_type}</td><td>{r.cluster}</td><td>{num(r.sheets)}</td><td>{r.forecast ? "Ya" : "Tidak"}</td><td>{r.realized ? "Ya" : "Tidak"}</td><td><span className={r.status === "Sesuai" ? "rpl-upload-match" : "rpl-upload-exception"}>{r.status}</span></td><td>{r.cause || "—"}</td><td>{r.obstacle || "—"}</td><td>{r.note || "—"}</td><td>{r.denom || "Belum diisi"}</td></tr>)}</tbody></table>{!rows.length && <p className="rpl-upload-empty">Tidak ada data.</p>}</div>
}
function SheetButtons({ value, onChange }) {
  return <>{[["planning", "Perencanaan"], ["dsr", "DSR (CRO)"]].map(([id, label]) => <button type="button" className={value === id ? "primary-button" : "ghost-button"} key={id} aria-pressed={value === id} onClick={() => onChange(id)}>{label}</button>)}</>
}

export default function RplUpload() {
  const [parametersBusy, setParametersBusy] = useState(false)
  const [period, setPeriod] = useState("")
  const [selectedUker, setSelectedUker] = useState(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [previewTab, setPreviewTab] = useState("planning")
  const [busy, setBusy] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [history, setHistory] = useState([])
  const [historyMore, setHistoryMore] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState("")
  const [refresh, setRefresh] = useState(0)
  const [batch, setBatch] = useState(null)
  const lock = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setHistoryLoading(true); setHistoryError("")
      try { const data = await fetchJson(API, { signal: controller.signal }); if (!controller.signal.aborted) { setHistory(data.items); setHistoryMore(data.has_more) } }
      catch (e) { if (!controller.signal.aborted) setHistoryError(e.message) }
      finally { if (!controller.signal.aborted) setHistoryLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [refresh])

  function invalidate() { setPreview(null); setMessage(""); setError("") }
  function selectBatch(item) { setBatch(item) }
  async function upload(mode) {
    if (lock.current || parametersBusy) return
    const unit = selectedUker?.data?.nama_uker?.trim() || ""
    if (!file || !period || !unit) { setError("Isi periode, pilih unit pelaporan dari master, dan pilih file."); return }
    if (file.size > 10 * 1024 * 1024 || !/\.xlsx$/i.test(file.name)) { setError("Pilih file .xlsx maksimal 10 MB."); return }
    if (mode === "commit" && (!preview || preview.error_count)) return
    lock.current = true; setBusy(mode); setError(""); setMessage("")
    try {
      const params = new URLSearchParams({ mode, period, unit, uker_id: selectedUker.value, file_name: file.name })
      if (mode === "commit") { params.set("preview_hash", preview.file_hash); params.set("parameter_revision", String(preview.parameter_revision)) }
      const data = await fetchJson(`${API}?${params}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file })
      if (mode === "preview") setPreview(data)
      else {
        setMessage(`Upload #${data.id} tersimpan: ${num(data.planning_rows)} baris Perencanaan dan ${num(data.dsr_rows)} baris DSR dari CRO.`)
        selectBatch({ id: data.id, period, reporting_unit: unit, summary: data, warnings: preview.warnings }); setPreview(null); setRefresh(v => v + 1)
      }
    } catch (e) { setError(e.message); setPreview(e.data || null) }
    finally { lock.current = false; setBusy("") }
  }
  async function moreHistory() {
    setHistoryLoading(true); setHistoryError("")
    try { const data = await fetchJson(`${API}?after=${history[history.length - 1].id}`); setHistory(current => [...current, ...data.items]); setHistoryMore(data.has_more) }
    catch (e) { setHistoryError(e.message) }
    finally { setHistoryLoading(false) }
  }

  return <div className="simple-page rpl-upload">
    <section className="page-heading-card"><p className="eyebrow">Replenish Management</p><h2>RPL Terjadwal</h2><p>Upload Perencanaan dan DSR, evaluasi akurasi, lalu bandingkan jadwal dengan realisasi per tanggal.</p></section>
    <section className="panel"><h3>Unit pelaporan</h3>
        <label>Unit/cabang pelaporan<div className="rpl-upload-uker"><ReplenishAutocomplete source="uker" optionsUrl={`${API}?uker_options=1`} selected={selectedUker} disabled={!!busy || parametersBusy} placeholder="Cari nama unit/cabang" onSelect={option => { setSelectedUker(option); invalidate() }} /></div><small>Pilih unit/cabang dari Master Uker berdasarkan nama_uker.</small></label>
    </section>
    <RplParameters key={selectedUker?.value || "none"} unit={selectedUker} disabled={!!busy} onBusy={setParametersBusy} onChanged={invalidate} />
    <section className="panel" aria-labelledby="rpl-upload-title">
      <div className="panel-header"><div><p className="eyebrow">01 · Upload & validasi</p><h3 id="rpl-upload-title">Impor Data Detail TID Perencanaan</h3></div></div>
      <p className="rpl-upload-help">Gunakan sheet <strong>Data Detail TID Perencanaan</strong>. Data Detail TID DSR akan diambil otomatis dari CRO saat proses upload. Gunakan 10 kolom A–J sesuai contoh Anda. Kolom F berisi pagu Perencanaan/DSR; kolom G berisi Forecast/Realisasi; H–J berisi Penyebab, Kendala, dan Catatan. Parameter berasal dari upload tersendiri untuk unit yang dipilih. Date berisi angka hari. Format lama tetap didukung.</p>
      <a className="ghost-button" href={`${API}?template=1`} download="RPL-Template-Upload.xlsx">Unduh template Perencanaan</a>
      <div className="rpl-upload-fields">
        <label>Periode pelaporan<input type="month" min="2000-01" max="2099-12" value={period} disabled={!!busy || parametersBusy} onChange={e => { setPeriod(e.target.value); invalidate() }} /></label>
        <label>File Excel<input type="file" accept=".xlsx" disabled={!!busy || parametersBusy} onChange={e => { setFile(e.target.files?.[0] || null); invalidate() }} /><small>Maksimal 10 MB · 20.000 baris data per sheet.</small></label>
      </div>
      <div className="rpl-upload-actions"><button className="primary-button" type="button" disabled={!!busy || parametersBusy || !file || !period || !selectedUker} onClick={() => upload("preview")}>{busy === "preview" ? "Membaca dan memvalidasi…" : "Preview & Validasi"}</button>{preview && <button className="ghost-button" type="button" disabled={!!busy || parametersBusy || preview.error_count > 0} onClick={() => upload("commit")}>{busy === "commit" ? "Menyimpan…" : "Simpan ke Database"}</button>}</div>
      {error && <p role="alert" className="rpl-upload-error">{error}</p>}{message && <p role="status" className="rpl-upload-success">{message}</p>}
    </section>
    {preview && <section className="panel"><div className="panel-header"><div><p className="eyebrow">02 · Preview sebelum simpan</p><h3>Hasil pembacaan Excel</h3></div></div>
      <p>{num(preview.summary.planning_rows)} baris valid Perencanaan · {num(preview.summary.dsr_rows)} baris valid DSR · {num(preview.error_count)} baris bermasalah.</p>
      {preview.period_label && <p>Periode pada file: {preview.period_label}</p>}<Summary data={preview.summary} />
      <p>{num(preview.parameter_count)} TID · {num(preview.missing_denom)} TID belum memiliki Denom.</p>{preview.warnings.map((warning, i) => <p className="rpl-upload-warning" key={i}>{warning}</p>)}
      {!!preview.error_count && <div role="alert"><strong>Perbaiki Excel lalu preview kembali. Ditampilkan maksimal 200 kesalahan.</strong><ul>{preview.errors.map((item, i) => <li key={i}>{item.sheet === "planning" ? "Perencanaan" : item.sheet === "dsr" ? "DSR" : item.sheet}, baris {item.row}, TID {item.tid || "—"}: {item.message}</li>)}</ul></div>}
      <div className="rpl-upload-actions"><SheetButtons value={previewTab} onChange={setPreviewTab} /></div><p className="rpl-upload-help">Preview maksimal 50 baris per sheet; semua baris valid disimpan. Baris kosong yang hanya berisi formula diabaikan.</p><DataTable rows={preview[previewTab]} />
    </section>}
    <section className="panel"><div className="panel-header"><div><p className="eyebrow">03 · Riwayat upload</p><h3>Versi data tersimpan</h3></div><button className="ghost-button" type="button" disabled={historyLoading} onClick={() => setRefresh(v => v + 1)}>Refresh</button></div>
      <p className="rpl-upload-help">Laporan menggunakan satu versi yang dipilih, bukan menjumlahkan semua upload. File identik untuk periode dan unit yang sama ditolak.</p>
      {historyError && <p role="alert" className="rpl-upload-error">{historyError}</p>}
      <div className="table-wrap"><table><thead><tr>{["Versi", "Periode", "Unit", "File", "Perencanaan / DSR", "Pengunggah", "Waktu", "Aksi"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{history.map(item => <tr key={item.id}><td>#{item.id}</td><td>{item.period}</td><td>{item.reporting_unit}</td><td>{item.file_name}</td><td>{num(item.summary.planning_rows)} / {num(item.summary.dsr_rows)}</td><td>{item.username}</td><td>{item.uploaded_at?.replace("T", " ")}</td><td><button className="ghost-button" type="button" onClick={() => selectBatch(item)}>Lihat Data</button></td></tr>)}</tbody></table></div>
      {historyLoading && <p role="status">Memuat riwayat…</p>}{!historyLoading && !history.length && !historyError && <p className="rpl-upload-empty">Belum ada upload tersimpan.</p>}{historyMore && <button className="ghost-button" type="button" disabled={historyLoading} onClick={moreHistory}>Riwayat berikutnya</button>}
    </section>
    {batch && <RplReport key={batch.id} batch={batch} />}
  </div>
}
