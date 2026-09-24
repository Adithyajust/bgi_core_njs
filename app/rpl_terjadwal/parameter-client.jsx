"use client"

import { useEffect, useRef, useState } from "react"

const API = "/api/rpl-terjadwal/parameters"
const fields = [["tid", "TID", 50], ["location", "Lokasi", 250], ["branch", "Kantor Cabang", 150], ["machine_type", "Jenis", 3], ["denom", "Denom", 15], ["cluster_flm", "Cluster FLM", 100], ["cluster", "Cluster RPL", 100], ["sub_cluster_rpl", "Sub Cluster RPL", 100]]
async function fetchData(url, options = {}) {
  const response = await fetch(url, { credentials: "include", cache: "no-store", ...options })
  if (!(response.headers.get("content-type") || "").includes("application/json")) throw new Error("Respons tidak valid. Periksa sesi login.")
  const result = await response.json()
  if (!response.ok || !result.success) { const error = new Error(result.message || "Parameter gagal diproses."); error.data = result.data; throw error }
  return result.data
}
function ParameterTable({ rows, onEdit, disabled }) {
  return <div className="table-wrap rpl-upload-table" tabIndex={0} aria-label="Parameter TID"><table><thead><tr>{fields.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}{onEdit && <th scope="col">Aksi</th>}</tr></thead><tbody>{rows.map(row => <tr key={row.tid}>{fields.map(([key]) => <td key={key}>{row[key] || "-"}</td>)}{onEdit && <td><button type="button" className="ghost-button" disabled={disabled} onClick={() => onEdit(row)}>Ubah</button></td>}</tr>)}</tbody></table>{!rows.length && <p className="rpl-upload-empty">Belum ada parameter untuk pilihan ini.</p>}</div>
}

export default function RplParameters({ unit, disabled, onBusy, onChanged }) {
  const [file, setFile] = useState(null), [preview, setPreview] = useState(null), [busy, setBusy] = useState("")
  const [data, setData] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("")
  const [search, setSearch] = useState(""), [page, setPage] = useState(0), [refresh, setRefresh] = useState(0), [draft, setDraft] = useState(null)
  const lock = useRef(false)
  const unitId = unit?.value
  useEffect(() => {
    if (!unitId) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const result = await fetchData(`${API}?${new URLSearchParams({ uker_id: unitId, page: String(page), search })}`, { signal: controller.signal })
        if (!controller.signal.aborted) setData(result)
      } catch (e) { if (!controller.signal.aborted) { setError(e.message); setData(null) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, search ? 250 : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [unitId, page, search, refresh])

  function start(mode) { lock.current = true; setBusy(mode); onBusy(true); setError(""); setMessage("") }
  function finish() { lock.current = false; setBusy(""); onBusy(false) }
  function saved(text) { setPreview(null); setDraft(null); setMessage(text); setRefresh(v => v + 1); onChanged() }
  async function upload(mode) {
    if (lock.current || disabled) return
    if (!unitId || !file) { setError("Pilih unit pelaporan dan file parameter."); return }
    if (!/\.xlsx$/i.test(file.name) || file.size > 10 * 1024 * 1024) { setError("Pilih file .xlsx maksimal 10 MB."); return }
    if (mode === "commit" && (!preview || preview.error_count)) return
    start(mode)
    try {
      const params = new URLSearchParams({ mode, uker_id: unitId, file_name: file.name })
      if (mode === "commit") { params.set("preview_hash", preview.file_hash); params.set("revision", String(preview.revision)) }
      const result = await fetchData(`${API}?${params}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file })
      if (mode === "preview") setPreview(result)
      else saved(`${result.inserted} TID ditambahkan dan ${result.updated} TID diperbarui. Parameter siap dipakai untuk upload RPL berikutnya.`)
    } catch (e) { setError(e.message); setPreview(e.data || null) }
    finally { finish() }
  }
  async function saveEdit(event) {
    event.preventDefault()
    if (lock.current || disabled) return
    start("edit")
    try {
      await fetchData(API, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "edit", uker_id: Number(unitId), revision: draft.revision, parameter: draft.parameter }) })
      saved(`Parameter TID ${draft.parameter.tid} tersimpan.`)
    } catch (e) { setError(e.message) }
    finally { finish() }
  }
  const locked = disabled || !!busy
  return <section className="panel" aria-labelledby="rpl-parameter-title">
    <div className="panel-header"><div><p className="eyebrow">Parameter TID</p><h3 id="rpl-parameter-title">Upload dan kelola parameter</h3></div><a className="ghost-button" href={`${API}?template=1`} download="RPL-Template-Parameter.xlsx">Unduh template parameter</a></div>
    <p className="rpl-upload-help">Gunakan sheet <strong>rpl_tid_parameter</strong> dengan 8 kolom A–H: TID, Lokasi, Kantor Cabang, Jenis, Denom, Cluster FLM, Cluster RPL, dan Sub Cluster RPL. Upload ini tidak memerlukan periode atau data RPL. File gabungan Anda juga dapat dipakai; hanya sheet parameter yang dibaca.</p>
    <p className="rpl-upload-help">Upload ulang memperbarui TID dalam file dan menambahkan TID baru. TID lain tetap tersimpan. Untuk laporan yang sudah ada, buka tab Edit dan pilih Terapkan parameter terbaru.</p>
    {!unitId ? <p className="rpl-upload-warning">Pilih unit pelaporan di atas untuk mengelola parameter.</p> : <>
      <label>File parameter Excel<input type="file" accept=".xlsx" disabled={locked || !!draft} onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); setError(""); setMessage("") }} /></label>
      <div className="rpl-upload-actions"><button className="primary-button" type="button" disabled={locked || !file || !!draft} onClick={() => upload("preview")}>{busy === "preview" ? "Memvalidasi…" : "Preview parameter"}</button>{preview && <button className="ghost-button" type="button" disabled={locked || !!preview.error_count || !!draft} onClick={() => upload("commit")}>{busy === "commit" ? "Menyimpan…" : "Simpan parameter"}</button>}</div>
      {preview && <div><h4>Preview parameter</h4><p>{preview.total} baris valid · {preview.inserted} TID baru · {preview.updated} TID diperbarui · {preview.error_count} kesalahan.</p>{preview.error_count > 0 && <ul>{preview.errors.map((e, i) => <li key={i}>Baris {e.row}, TID {e.tid || "-"}: {e.message}</li>)}</ul>}<p className="rpl-upload-help">Preview maksimal 50 baris. Seluruh baris valid disimpan setelah semua kesalahan diperbaiki.</p><ParameterTable rows={preview.rows} /></div>}
      {draft && <form className="rpl-editor" onSubmit={saveEdit}><h4>Ubah parameter TID {draft.parameter.tid}</h4><div className="rpl-edit-fields">{fields.map(([key, label, max]) => {
        const change = value => setDraft(d => ({ ...d, parameter: { ...d.parameter, [key]: value } }))
        const options = key === "machine_type" ? ["ATM", "CRM"] : key === "denom" ? ["50000", "100000", "All Denom"] : null
        return <label key={key}>{label}{options ? <select disabled={locked} value={draft.parameter[key]} onChange={e => change(e.target.value)}>{options.map(v => <option key={v}>{v}</option>)}</select> : <input required={!["cluster_flm", "sub_cluster_rpl"].includes(key)} disabled={locked || key === "tid"} maxLength={max} value={draft.parameter[key]} onChange={e => change(e.target.value)} />}</label>
      })}</div><div className="rpl-upload-actions"><button className="primary-button" disabled={locked} type="submit">{busy === "edit" ? "Menyimpan…" : "Simpan perubahan"}</button><button className="ghost-button" disabled={locked} type="button" onClick={() => setDraft(null)}>Batal</button></div></form>}
      <h4>Parameter tersimpan{data ? ` (${data.master_total} TID)` : ""}</h4><div className="rpl-upload-actions"><label>Cari TID, lokasi, atau cluster<input value={search} maxLength={250} disabled={locked || !!draft} onChange={e => { setSearch(e.target.value); setPage(0); setLoading(true) }} /></label><button type="button" className="ghost-button" disabled={locked || loading || !!draft} onClick={() => { setError(""); setPreview(null); setLoading(true); setRefresh(v => v + 1) }}>Muat ulang parameter</button></div>
      {loading ? <p role="status">Memuat parameter…</p> : data && <><ParameterTable rows={data.items} disabled={locked || !!draft} onEdit={row => { setDraft({ parameter: { ...row }, revision: data.revision }); setPreview(null); setError(""); setMessage("") }} /><div className="rpl-upload-actions"><button type="button" className="ghost-button" disabled={locked || !!draft || !page} onClick={() => { setPage(v => v - 1); setLoading(true) }}>Sebelumnya</button><span>Halaman {page + 1} / {Math.max(1, Math.ceil(data.total / 50))} · {data.total} TID</span><button type="button" className="ghost-button" disabled={locked || !!draft || (page + 1) * 50 >= data.total} onClick={() => { setPage(v => v + 1); setLoading(true) }}>Berikutnya</button></div></>}
    </>}
    {error && <p role="alert" className="rpl-upload-error">{error}</p>}{message && <p role="status" className="rpl-upload-success">{message}</p>}
  </section>
}
