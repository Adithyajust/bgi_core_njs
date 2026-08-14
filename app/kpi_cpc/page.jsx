"use client"

import { useEffect, useMemo, useState } from "react"

import { useAppBootstrap } from "@/components/app-bootstrap-context"
import { CPC_KPI_MENU_HREF } from "@/modules/cpc/constants"

function toDateInput(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function initialDateRange() {
  const today = new Date()
  return {
    dateFrom: toDateInput(new Date(today.getFullYear(), today.getMonth(), 1)),
    dateTo: toDateInput(today),
  }
}

function formatDate(value) {
  if (!value) return "-"
  const [year, month, day] = String(value).slice(0, 10).split("-")
  return year && month && day ? `${day}/${month}/${year}` : "-"
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

function formatNumber(value) {
  return new Intl.NumberFormat("id-ID").format(Number(value || 0))
}

function formatDuration(value) {
  const totalSeconds = Math.max(0, Math.round(Number(value || 0)))
  if (totalSeconds < 60) return `${totalSeconds} dtk`

  const totalMinutes = Math.round(totalSeconds / 60)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const parts = []
  if (days) parts.push(`${days} hari`)
  if (hours) parts.push(`${hours} jam`)
  if (minutes || parts.length === 0) parts.push(`${minutes} mnt`)
  return parts.join(" ")
}

function activityLabel(value) {
  if (value === "NORMAL") return "Replenish Normal"
  if (value === "PENGOSONGAN") return "Pengosongan"
  if (value === "PERDANA") return "Pengisian Perdana"
  if (value === "CAMPURAN") return "Aktivitas Campuran"
  return String(value || "-").replaceAll("_", " ")
}

async function requestJson(url) {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
  })
  const contentType = response.headers.get("content-type") || ""
  if (!contentType.includes("application/json")) {
    throw new Error(`Endpoint KPI CPC tidak mengembalikan JSON. Status ${response.status}.`)
  }
  const result = await response.json()
  if (!response.ok || !result.success) {
    throw new Error(result.message || "KPI CPC gagal dimuat.")
  }
  return result
}

const EMPTY_SUMMARY = {
  total_jobs: 0,
  average_packing_seconds: 0,
  average_approval_seconds: 0,
  average_total_seconds: 0,
  longest_total_seconds: 0,
  total_rejections: 0,
}

export default function CpcKpiPage() {
  const { user, permissions } = useAppBootstrap()
  const defaults = useMemo(() => initialDateRange(), [])
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(EMPTY_SUMMARY)
  const [operators, setOperators] = useState([])
  const [scope, setScope] = useState(null)
  const [calculation, setCalculation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [refreshKey, setRefreshKey] = useState(0)

  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [dateFrom, setDateFrom] = useState(defaults.dateFrom)
  const [dateTo, setDateTo] = useState(defaults.dateTo)
  const [operatorUserId, setOperatorUserId] = useState("")

  const [cursorStack, setCursorStack] = useState([null])
  const [cursorIndex, setCursorIndex] = useState(0)
  const [pagination, setPagination] = useState({ has_more: false, next_cursor: null })

  const currentCursor = cursorStack[cursorIndex] || null
  const permission = permissions?.[CPC_KPI_MENU_HREF] || null
  const canView = user?.roleCode === "SUPER_ADMIN" || Boolean(permission?.canView)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) {
        setCursorStack([null])
        setCursorIndex(0)
      }
    })
    return () => {
      cancelled = true
    }
  }, [debouncedSearch, dateFrom, dateTo, operatorUserId])

  useEffect(() => {
    let cancelled = false

    async function loadKpi() {
      setLoading(true)
      setLoadError("")
      try {
        const params = new URLSearchParams({
          page_size: "20",
          date_from: dateFrom,
          date_to: dateTo,
        })
        if (debouncedSearch) params.set("search", debouncedSearch)
        if (operatorUserId) params.set("operator_user_id", operatorUserId)
        if (currentCursor) {
          params.set("after_approved_at", currentCursor.approved_at)
          params.set("after_id", String(currentCursor.work_order_id))
        }

        const result = await requestJson(`/api/transactions/cpc/kpi?${params.toString()}`)
        if (cancelled) return
        setItems(result.data.items || [])
        setSummary(result.data.summary || EMPTY_SUMMARY)
        setOperators(result.data.operators || [])
        setScope(result.data.scope || null)
        setCalculation(result.data.calculation || null)
        setPagination(result.data.pagination || { has_more: false, next_cursor: null })
      } catch (error) {
        if (cancelled) return
        setItems([])
        setSummary(EMPTY_SUMMARY)
        setLoadError(error.message || "Gagal memuat KPI CPC.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    if (canView && dateFrom && dateTo) void loadKpi()
    return () => {
      cancelled = true
    }
  }, [canView, currentCursor, dateFrom, dateTo, debouncedSearch, operatorUserId, refreshKey])

  function nextPage() {
    if (!pagination.has_more || !pagination.next_cursor) return
    const nextStack = cursorStack.slice(0, cursorIndex + 1)
    nextStack.push(pagination.next_cursor)
    setCursorStack(nextStack)
    setCursorIndex(nextStack.length - 1)
  }

  function previousPage() {
    if (cursorIndex === 0) return
    setCursorIndex((current) => current - 1)
  }

  return (
    <div className="cpc-kpi-page">
      <section className="cpc-kpi-hero">
        <div>
          <p className="eyebrow">Asisten Manager CPC</p>
          <h2>KPI Penyelesaian Packing CPC</h2>
          <p>
            Mengukur waktu CPC menyiapkan kaset kebutuhan Replenish sampai packing memperoleh
            approval final Asisten Manager CPC.
          </p>
        </div>
        <div className="cpc-kpi-scope">
          <span>Lingkup data</span>
          <strong>{scope?.nama_uker || (scope?.is_super_admin ? "Seluruh Unit Kerja" : "-")}</strong>
          <small>{scope?.codeuker || user?.roleName || "Asisten Manager CPC"}</small>
        </div>
      </section>

      <section className="cpc-kpi-formula" aria-label="Rumus KPI CPC">
        <article>
          <span>01</span>
          <div>
            <strong>Durasi pengerjaan CPC</strong>
            <p>{calculation?.packing || "Mulai job sampai packing diajukan, termasuk waktu perbaikan."}</p>
          </div>
        </article>
        <article>
          <span>02</span>
          <div>
            <strong>Durasi approval</strong>
            <p>{calculation?.approval || "Pengajuan packing sampai keputusan Asisten Manager CPC."}</p>
          </div>
        </article>
        <article>
          <span>03</span>
          <div>
            <strong>Total penyelesaian</strong>
            <p>{calculation?.total || "Mulai job pertama sampai approval final."}</p>
          </div>
        </article>
      </section>

      <section className="cpc-kpi-summary" aria-label="Ringkasan KPI CPC">
        <article>
          <span>Job disetujui</span>
          <strong>{formatNumber(summary.total_jobs)}</strong>
          <small>Dalam rentang tanggal approval</small>
        </article>
        <article>
          <span>Rata-rata packing</span>
          <strong>{formatDuration(summary.average_packing_seconds)}</strong>
          <small>Waktu kerja CPC</small>
        </article>
        <article>
          <span>Rata-rata approval</span>
          <strong>{formatDuration(summary.average_approval_seconds)}</strong>
          <small>Waktu review Asisten Manager CPC</small>
        </article>
        <article className="accent">
          <span>Rata-rata total</span>
          <strong>{formatDuration(summary.average_total_seconds)}</strong>
          <small>Mulai job sampai approval final</small>
        </article>
        <article>
          <span>Total dikembalikan</span>
          <strong>{formatNumber(summary.total_rejections)}</strong>
          <small>Jumlah keputusan perbaikan packing</small>
        </article>
      </section>

      <section className="cpc-kpi-panel">
        <div className="cpc-kpi-toolbar">
          <div>
            <h3>Detail Penyelesaian Job</h3>
            <p>Data berdasarkan tanggal approval final packing CPC.</p>
          </div>
          <button type="button" onClick={() => setRefreshKey((current) => current + 1)} disabled={loading}>
            {loading ? "Memuat..." : "Muat Ulang"}
          </button>
        </div>

        <div className="cpc-kpi-filters">
          <label>
            <span>Cari job / TID / petugas</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nomor Work Order, TID, atau nama"
            />
          </label>
          <label>
            <span>Tanggal approval dari</span>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label>
            <span>Sampai</span>
            <input type="date" value={dateTo} min={dateFrom} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          <label>
            <span>CPC penyelesai</span>
            <select value={operatorUserId} onChange={(event) => setOperatorUserId(event.target.value)}>
              <option value="">Semua petugas CPC</option>
              {operators.map((operator) => (
                <option value={operator.user_id} key={operator.user_id}>{operator.full_name}</option>
              ))}
            </select>
          </label>
        </div>

        {loadError ? <div className="cpc-kpi-alert" role="alert">{loadError}</div> : null}

        <div className="cpc-kpi-table-wrap">
          <table className="cpc-kpi-table">
            <thead>
              <tr>
                <th>Work Order</th>
                <th>CPC Penyelesai</th>
                <th>Mulai Packing</th>
                <th>Packing Selesai</th>
                <th>Approval Final</th>
                <th>Durasi CPC</th>
                <th>Durasi Approval</th>
                <th>Total</th>
                <th>Perbaikan</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="9" className="cpc-kpi-empty">Menghitung KPI CPC...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan="9" className="cpc-kpi-empty">Belum ada packing yang disetujui pada filter ini.</td></tr>
              ) : items.map((item) => (
                <tr key={item.work_order_id}>
                  <td>
                    <strong>{item.work_order_no}</strong>
                    <span>{activityLabel(item.activity_type)} · Jadwal {formatDate(item.schedule_date)}</span>
                    <small>{formatNumber(item.total_points)} TID · {formatNumber(item.total_cassettes)} kaset</small>
                  </td>
                  <td>
                    <strong>{item.submitted_by_name || "-"}</strong>
                    <span>{item.codeuker} · {item.nama_uker}</span>
                  </td>
                  <td>{formatDateTime(item.packing_started_at)}</td>
                  <td>{formatDateTime(item.packing_completed_at)}</td>
                  <td>
                    <strong>{formatDateTime(item.approved_at)}</strong>
                    <span>{item.approved_by_name || "-"}</span>
                  </td>
                  <td><b className="cpc-kpi-duration packing">{formatDuration(item.packing_duration_seconds)}</b></td>
                  <td><b className="cpc-kpi-duration approval">{formatDuration(item.approval_duration_seconds)}</b></td>
                  <td><b className="cpc-kpi-duration total">{formatDuration(item.total_duration_seconds)}</b></td>
                  <td>
                    <span className={item.rejection_count > 0 ? "cpc-kpi-rework warning" : "cpc-kpi-rework"}>
                      {formatNumber(item.rejection_count)} kali
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="cpc-kpi-pagination">
          <span>Halaman {cursorIndex + 1} · Durasi terlama {formatDuration(summary.longest_total_seconds)}</span>
          <div>
            <button type="button" onClick={previousPage} disabled={loading || cursorIndex === 0}>Sebelumnya</button>
            <button type="button" onClick={nextPage} disabled={loading || !pagination.has_more}>Berikutnya</button>
          </div>
        </div>
      </section>
    </div>
  )
}
