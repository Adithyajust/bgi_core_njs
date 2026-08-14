"use client"

import { useEffect, useRef, useState } from "react"

import { useAppBootstrap } from "@/components/app-bootstrap-context"
import { CPC_SPARE_CASSETTE_MENU_HREF } from "@/modules/cpc/constants"
import "./spare-kaset.css"

// Kontrak tampilan ini sengaja lokal pada client page. Dengan demikian form
// tidak crash saat browser masih memegang chunk lama modules/cpc/constants.js
// setelah deployment/hot reload. API tetap menjadi sumber validasi final.
const SPARE_CASSETTE_DENOMINATIONS = Object.freeze([50000, 100000])

function formatCurrency(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function formatNumber(value) {
  return new Intl.NumberFormat("id-ID").format(Number(value || 0))
}

function formatDateTime(value) {
  if (!value) return "-"
  const date = new Date(String(value).replace(" ", "T"))
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function statusLabel(status) {
  if (status === "READY") return "Siap Dipakai"
  if (status === "ALLOCATED") return "Dipakai WO"
  return "Belum Disortir"
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...options,
  })
  const contentType = response.headers.get("content-type") || ""
  if (!contentType.includes("application/json")) {
    throw new Error(`Endpoint spare kaset tidak mengembalikan JSON. Status ${response.status}.`)
  }
  const result = await response.json()
  if (!response.ok || !result.success) {
    const error = new Error(result.message || "Permintaan spare kaset gagal diproses.")
    error.status = response.status
    throw error
  }
  return result
}

const EMPTY_SUMMARY = {
  total: 0,
  ready: 0,
  empty: 0,
  allocated: 0,
  ready_50000: 0,
  ready_100000: 0,
}

export default function SpareCassettePage() {
  const { user, permissions } = useAppBootstrap()
  const messageTimer = useRef(null)
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(EMPTY_SUMMARY)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [refreshKey, setRefreshKey] = useState(0)
  const [savingSerial, setSavingSerial] = useState("")
  const [sealDrafts, setSealDrafts] = useState({})
  const [denominationDrafts, setDenominationDrafts] = useState({})
  const [newCassetteSerial, setNewCassetteSerial] = useState("")
  const [newDenominationValue, setNewDenominationValue] = useState("")
  const [newRubberSealNo, setNewRubberSealNo] = useState("")
  const [message, setMessage] = useState({ type: "", text: "" })

  const permission = permissions?.[CPC_SPARE_CASSETTE_MENU_HREF] || null
  const canUpdate = user?.roleCode === "SUPER_ADMIN" || Boolean(permission?.canUpdate)
  const normalizedNewSerial = String(newCassetteSerial || "").trim().toUpperCase()

  function showMessage(type, text) {
    if (messageTimer.current) window.clearTimeout(messageTimer.current)
    setMessage({ type, text })
    messageTimer.current = window.setTimeout(() => setMessage({ type: "", text: "" }), type === "error" ? 6000 : 4000)
  }

  useEffect(() => {
    let cancelled = false

    async function loadInventory() {
      setLoading(true)
      setLoadError("")
      try {
        const result = await requestJson("/api/transactions/cpc/spare-cassettes")
        if (cancelled) return
        setItems(result.data?.items || [])
        setSummary(result.data?.summary || EMPTY_SUMMARY)
      } catch (error) {
        if (cancelled) return
        setItems([])
        setSummary(EMPTY_SUMMARY)
        setLoadError(error.message || "Gagal memuat persediaan spare kaset.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadInventory()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  useEffect(() => () => {
    if (messageTimer.current) window.clearTimeout(messageTimer.current)
  }, [])

  async function savePreparedCassette(cassetteSerial, denominationValue, rubberSealNo, { clearNewForm = false } = {}) {
    if (!cassetteSerial || !canUpdate || savingSerial) return
    if (!SPARE_CASSETTE_DENOMINATIONS.includes(Number(denominationValue))) {
      showMessage("error", `Pilih denom Rp50.000 atau Rp100.000 untuk ${cassetteSerial}.`)
      return
    }
    if (!rubberSealNo) {
      showMessage("error", `Scan segel karet untuk ${cassetteSerial} terlebih dahulu.`)
      return
    }

    setSavingSerial(cassetteSerial)
    try {
      const result = await requestJson("/api/transactions/cpc/spare-cassettes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cassette_serial: cassetteSerial,
          denomination_value: Number(denominationValue),
          rubber_seal_no: rubberSealNo,
        }),
      })
      setItems(result.data?.items || [])
      setSummary(result.data?.summary || EMPTY_SUMMARY)
      setSealDrafts((current) => ({ ...current, [cassetteSerial]: "" }))
      setDenominationDrafts((current) => ({ ...current, [cassetteSerial]: "" }))
      if (clearNewForm) {
        setNewCassetteSerial("")
        setNewDenominationValue("")
        setNewRubberSealNo("")
      }
      showMessage("success", result.message || "Spare kaset berhasil disiapkan.")
    } catch (error) {
      showMessage("error", error.message || "Gagal menyimpan spare kaset.")
    } finally {
      setSavingSerial("")
    }
  }

  function prepareExistingCassette(item) {
    if (!item?.cassette_serial) return
    if (item.status === "ALLOCATED") {
      showMessage("error", `${item.cassette_serial} sedang dipakai ${item.work_order_no || "Work Order lain"}.`)
      return
    }
    const denominationValue = Number(denominationDrafts[item.cassette_serial] || item.denomination_value)
    const rubberSealNo = String(sealDrafts[item.cassette_serial] || "").trim().toUpperCase()
    void savePreparedCassette(item.cassette_serial, denominationValue, rubberSealNo)
  }

  function addCassetteFromZero(event) {
    event.preventDefault()
    if (!normalizedNewSerial) {
      showMessage("error", "Pilih atau scan label kaset terlebih dahulu.")
      return
    }
    if (!SPARE_CASSETTE_DENOMINATIONS.includes(Number(newDenominationValue))) {
      showMessage("error", "Pilih denom Rp50.000 atau Rp100.000.")
      return
    }
    const rubberSealNo = String(newRubberSealNo || "").trim().toUpperCase()
    void savePreparedCassette(normalizedNewSerial, Number(newDenominationValue), rubberSealNo, { clearNewForm: true })
  }

  return (
    <div
      className="simple-page replenish-page cpc-page spare-cassette-page"
      data-spare-layout-version="17"
    >
      <section className="page-heading-card replenish-heading">
        <div>
          <p className="eyebrow">CPC Operations · Persediaan Kaset</p>
          <h2>Spare Kaset</h2>
          <p>
            Form khusus untuk sortir uang ke kaset, pemasangan segel karet, dan pencatatan petugas CPC.
            Kaset yang sudah siap akan tersedia otomatis pada proses Add Spare Kaset di Work Order RPL sesuai denominasinya.
          </p>
        </div>
        <div className="replenish-heading-actions">
          <button
            type="button"
            className="replenish-button secondary"
            onClick={() => setRefreshKey((value) => value + 1)}
            disabled={loading}
          >
            {loading ? "Memuat..." : "Muat Ulang"}
          </button>
        </div>
      </section>

      {!canUpdate ? (
        <div className="replenish-alert warning">
          Role Anda memiliki akses lihat ke menu Spare Kaset, tetapi belum memiliki permission Ubah. Form sortir dinonaktifkan.
        </div>
      ) : null}

      {message.text ? <div className={`replenish-alert ${message.type === "error" ? "error" : "success"}`}>{message.text}</div> : null}
      {loadError ? <div className="replenish-alert error">{loadError}</div> : null}

      <section className="replenish-summary-grid cpc-summary-grid cpc-spare-page-summary">
        <article><span>Total Label</span><strong>{formatNumber(summary.total)}</strong></article>
        <article><span>Siap Rp50.000</span><strong>{formatNumber(summary.ready_50000)}</strong></article>
        <article><span>Siap Rp100.000</span><strong>{formatNumber(summary.ready_100000)}</strong></article>
        <article><span>Dipakai Work Order</span><strong>{formatNumber(summary.allocated)}</strong></article>
        <article><span>Belum Disortir</span><strong>{formatNumber(summary.empty)}</strong></article>
      </section>

      <section className="panel cpc-spare-panel">
        <div className="panel-header cpc-spare-panel-header">
          <div>
            <p className="eyebrow">Form Sortir ke Kaset</p>
            <h3>Persediaan Spare Kaset CPC</h3>
            <p>
              Petugas memilih atau scan kaset, memilih denom Rp50.000 atau Rp100.000, memastikan isi tepat 2.000 lembar,
              lalu scan segel karet sebelum kaset berstatus siap.
            </p>
          </div>
        </div>

        <div className="replenish-alert success cpc-spare-rule">
          Akun petugas CPC dan waktu persiapan dicatat pada setiap label. Kaset berstatus Dipakai WO dikunci dan tidak dapat disortir ulang sampai dilepas dari alokasi.
        </div>

        <form className="cpc-spare-create-form" onSubmit={addCassetteFromZero}>
          <div className="cpc-spare-create-heading">
            <div>
              <strong>Input Spare Kaset dari Nol</strong>
              <small>Pilih kaset, pilih denom, pastikan 2.000 lembar, lalu scan segel karet.</small>
            </div>
            <span>Denom dipilih petugas CPC</span>
          </div>
          <div className="cpc-spare-create-grid">
            <label>
              <span>Label Kaset</span>
              <input
                value={newCassetteSerial}
                onChange={(event) => setNewCassetteSerial(String(event.target.value || "").toUpperCase().replaceAll(/\s+/g, "").slice(0, 20))}
                placeholder="Pilih / scan label kaset"
                disabled={!canUpdate || Boolean(savingSerial)}
                autoComplete="off"
              />
            </label>
            <label>
              <span>Pilih Denom</span>
              <select
                value={newDenominationValue}
                onChange={(event) => setNewDenominationValue(event.target.value)}
                disabled={!canUpdate || Boolean(savingSerial)}
              >
                <option value="">Pilih denom</option>
                {SPARE_CASSETTE_DENOMINATIONS.map((value) => (
                  <option key={value} value={value}>{formatCurrency(value)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Isi Tetap</span>
              <input value="2.000 lembar" readOnly />
            </label>
            <label>
              <span>Segel Karet</span>
              <input
                value={newRubberSealNo}
                onChange={(event) => setNewRubberSealNo(String(event.target.value || "").toUpperCase().replaceAll(/\s+/g, "").slice(0, 100))}
                placeholder="Scan nomor segel karet"
                disabled={!canUpdate || Boolean(savingSerial)}
                autoComplete="off"
              />
            </label>
            <button
              type="submit"
              className="replenish-button primary"
              disabled={!canUpdate || Boolean(savingSerial) || !normalizedNewSerial || !newDenominationValue || !String(newRubberSealNo || "").trim()}
            >
              {savingSerial === normalizedNewSerial ? "Menyimpan..." : "Simpan Kaset Siap"}
            </button>
          </div>
        </form>

        <div className="table-wrap cpc-spare-table-wrap">
          <table className="cpc-spare-table">
            <thead>
              <tr>
                <th>Label Kaset</th>
                <th>Denom Isi</th>
                <th>Isi</th>
                <th>Segel Karet</th>
                <th>Petugas Persiapan</th>
                <th>Status</th>
                <th>Sortir / Pasang Segel</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7" className="replenish-empty">Memuat persediaan spare kaset...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan="7" className="replenish-empty">Tabel masih kosong. Input kaset pertama melalui form di atas.</td></tr>
              ) : items.map((item) => {
                const allocated = item.status === "ALLOCATED"
                const saving = savingSerial === item.cassette_serial
                return (
                  <tr key={item.id}>
                    <td><strong>{item.cassette_serial}</strong></td>
                    <td><strong>{formatCurrency(item.denomination_value)}</strong></td>
                    <td>
                      <strong>{formatNumber(item.sheets_count)} lembar</strong>
                      <small>{formatCurrency(item.amount)}</small>
                    </td>
                    <td><code className="cpc-seal-code">{item.rubber_seal_no || "-"}</code></td>
                    <td>
                      <strong>{item.prepared_by_name || "-"}</strong>
                      <small>{formatDateTime(item.prepared_at)}</small>
                    </td>
                    <td>
                      <span className={`cpc-spare-state ${String(item.status || "").toLowerCase()}`}>
                        {statusLabel(item.status)}
                      </span>
                      {allocated ? <small>{item.work_order_no || "WO aktif"}{item.tid ? ` · ${item.tid}` : ""}</small> : null}
                    </td>
                    <td>
                      <div className="cpc-spare-prepare-form">
                        <select
                          value={denominationDrafts[item.cassette_serial] || String(Number(item.denomination_value))}
                          onChange={(event) => setDenominationDrafts((current) => ({
                            ...current,
                            [item.cassette_serial]: event.target.value,
                          }))}
                          disabled={!canUpdate || allocated || saving}
                          aria-label={`Pilih denom ${item.cassette_serial}`}
                        >
                          {SPARE_CASSETTE_DENOMINATIONS.map((value) => (
                            <option key={value} value={value}>{formatCurrency(value)}</option>
                          ))}
                        </select>
                        <input
                          value={sealDrafts[item.cassette_serial] || ""}
                          onChange={(event) => setSealDrafts((current) => ({
                            ...current,
                            [item.cassette_serial]: String(event.target.value || "").toUpperCase().slice(0, 100),
                          }))}
                          placeholder={allocated ? "Sedang dipakai WO" : "Scan segel karet baru"}
                          disabled={!canUpdate || allocated || saving}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          className="replenish-button primary compact"
                          onClick={() => prepareExistingCassette(item)}
                          disabled={!canUpdate || allocated || saving || !String(sealDrafts[item.cassette_serial] || "").trim()}
                        >
                          {saving ? "Menyimpan..." : item.status === "READY" ? "Sortir Ulang" : "Simpan Siap"}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
