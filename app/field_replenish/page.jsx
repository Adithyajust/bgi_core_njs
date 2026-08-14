"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useAppBootstrap } from "@/components/app-bootstrap-context"
import { REPLENISH_FIELD_ACTIONS, REPLENISH_FIELD_MENU_HREF } from "@/modules/replenish/constants"
import {
  cacheFieldSnapshot,
  countPendingFieldEvents,
  createFieldEvent,
  getCachedFieldSnapshot,
  queueFieldEvent,
  registerFieldServiceWorker,
  removeFieldEvent,
  syncPendingFieldEvents,
} from "@/modules/replenish/field-offline"

const TERMINAL_POINT_STATUSES = new Set(["BERHASIL", "BERHASIL_DENGAN_CATATAN"])

function statusLabel(value) {
  return String(value || "-").replaceAll("_", " ")
}

function formatDate(value) {
  if (!value) return "-"
  const [year, month, day] = String(value).slice(0, 10).split("-")
  return year && month && day ? `${day}/${month}/${year}` : String(value)
}

function formatCurrency(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function emptyScan(point) {
  return {
    departure_bag_seal_no: point?.scanned_departure_bag_seal_no || "",
    reject_cassette_serial: point?.scanned_reject_cassette_serial || "",
    reject_cassette_seal_no: point?.scanned_reject_cassette_seal_no || "",
    return_bag_seal_no: point?.scanned_return_bag_seal_no || "",
    cassettes: (point?.cassettes || []).map((item) => ({
      cassette_no: Number(item.cassette_no),
      old_cassette_serial: item.old_cassette_serial || "",
      old_seal_no: item.old_seal_no || "",
      new_cassette_serial: item.new_cassette_serial || "",
      new_seal_no: item.new_seal_no || "",
    })),
  }
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase()
}

function findDuplicateCodes(scan) {
  const fields = [
    ["Segel BAG Berangkat", scan.departure_bag_seal_no],
    ...scan.cassettes.flatMap((cassette) => [
      [`Serial kaset lama ${cassette.cassette_no}`, cassette.old_cassette_serial],
      [`Segel kaset lama ${cassette.cassette_no}`, cassette.old_seal_no],
      [`Serial kaset baru ${cassette.cassette_no}`, cassette.new_cassette_serial],
      [`Segel kaset baru ${cassette.cassette_no}`, cassette.new_seal_no],
    ]),
    ["Serial kaset reject", scan.reject_cassette_serial],
    ["Segel kaset reject", scan.reject_cassette_seal_no],
    ["Segel BAG Kembali", scan.return_bag_seal_no],
  ]
  const seen = new Map()
  const duplicates = []
  for (const [label, rawValue] of fields) {
    const value = normalizeCode(rawValue)
    if (!value) continue
    if (seen.has(value)) duplicates.push(`${value}: ${seen.get(value)} dan ${label}`)
    else seen.set(value, label)
  }
  return duplicates
}

function scanComplete(scan) {
  return Boolean(
    normalizeCode(scan.departure_bag_seal_no)
    && normalizeCode(scan.reject_cassette_serial)
    && normalizeCode(scan.reject_cassette_seal_no)
    && normalizeCode(scan.return_bag_seal_no)
    && scan.cassettes.length > 0
    && scan.cassettes.every((item) =>
      normalizeCode(item.old_cassette_serial)
      && normalizeCode(item.old_seal_no)
      && normalizeCode(item.new_cassette_serial)
      && normalizeCode(item.new_seal_no)
    )
  )
}

function optimisticSnapshot(snapshot, action, pointId) {
  const copy = structuredClone(snapshot)
  const point = copy.points?.find((item) => Number(item.id) === Number(pointId))
  if (action === REPLENISH_FIELD_ACTIONS.START_TRIP) {
    copy.work_order.status = "DALAM_PERJALANAN"
    copy.points = copy.points.map((item) => item.status === "TERJADWAL" ? { ...item, status: "DALAM_PERJALANAN" } : item)
  } else if (action === REPLENISH_FIELD_ACTIONS.ARRIVE_POINT && point) {
    point.status = "TIBA"
    if (["SIAP_BERANGKAT", "BERANGKAT", "DALAM_PERJALANAN"].includes(copy.work_order.status)) {
      copy.work_order.status = "TIBA_DI_LOKASI"
    }
  } else if (action === REPLENISH_FIELD_ACTIONS.START_POINT && point) {
    point.status = "DALAM_PROSES"
    copy.work_order.status = "DALAM_PROSES_REPLENISH"
  } else if (action === REPLENISH_FIELD_ACTIONS.COMPLETE_POINT && point) {
    point.status = "BERHASIL"
    if (copy.points.every((item) => TERMINAL_POINT_STATUSES.has(item.status))) {
      copy.work_order.status = "SELESAI_DI_LOKASI"
    }
  } else if (action === REPLENISH_FIELD_ACTIONS.REPORT_EXCEPTION && point) {
    point.pending_exception_id = -1
    point.scan_status = "EXCEPTION_PENDING"
  } else if (action === REPLENISH_FIELD_ACTIONS.START_RETURN) {
    copy.work_order.status = "DALAM_PERJALANAN_KEMBALI"
  } else if (action === REPLENISH_FIELD_ACTIONS.ARRIVE_OFFICE) {
    copy.work_order.status = "TIBA_DI_KANTOR"
  }
  return copy
}

function getGpsLocation() {
  if (!navigator.geolocation) return Promise.reject(new Error("GPS tidak tersedia pada perangkat ini."))
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }),
      (error) => reject(new Error(error.code === 1
        ? "Izin GPS ditolak. Aktifkan izin lokasi untuk aplikasi ini."
        : "Lokasi GPS belum dapat diperoleh. Coba di area yang lebih terbuka.")),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 }
    )
  })
}

async function fileToEvidence(file) {
  if (!file) throw new Error("Foto bukti wajib dipilih.")
  if (!file.type.startsWith("image/")) throw new Error("Bukti harus berupa foto.")
  const image = await new Promise((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error("Foto tidak dapat dibaca."))
    element.src = URL.createObjectURL(file)
  })
  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height)
  URL.revokeObjectURL(image.src)
  const dataUrl = canvas.toDataURL("image/jpeg", 0.78)
  const approximateBytes = Math.ceil((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75)
  if (approximateBytes > 3 * 1024 * 1024) throw new Error("Foto masih lebih besar dari 3 MB.")
  return { dataUrl, fileName: file.name || "bukti-lapangan.jpg" }
}

async function readJson(response) {
  const contentType = response.headers.get("content-type") || ""
  if (!contentType.includes("application/json")) throw new Error(`Respons server tidak valid (HTTP ${response.status}).`)
  const result = await response.json()
  if (!response.ok || !result.success) {
    const error = new Error(result.message || "Permintaan Replenish Lapangan gagal.")
    error.status = response.status
    error.details = result
    throw error
  }
  return result
}

function CameraScanner({ onDetected, onClose }) {
  const videoRef = useRef(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    let stream = null
    let frame = null
    async function start() {
      try {
        if (!("BarcodeDetector" in window)) throw new Error("Pemindai kamera belum didukung browser ini. Gunakan scanner Bluetooth atau input manual.")
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
        if (!active) return
        const video = videoRef.current
        video.srcObject = stream
        await video.play()
        const detector = new window.BarcodeDetector({ formats: ["code_128", "code_39", "qr_code", "data_matrix"] })
        const detect = async () => {
          if (!active) return
          try {
            const codes = await detector.detect(video)
            const value = codes.find((item) => item.rawValue)?.rawValue
            if (value) {
              onDetected(normalizeCode(value))
              return
            }
          } catch {}
          frame = requestAnimationFrame(detect)
        }
        frame = requestAnimationFrame(detect)
      } catch (startError) {
        setError(startError.message || "Kamera tidak dapat dibuka.")
      }
    }
    void start()
    return () => {
      active = false
      if (frame) cancelAnimationFrame(frame)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [onDetected])

  return (
    <div className="field-camera-backdrop" role="dialog" aria-modal="true" aria-label="Pemindai barcode">
      <div className="field-camera-panel">
        <div><strong>Scan barcode</strong><button type="button" onClick={onClose}>Tutup</button></div>
        {error ? <p className="field-error">{error}</p> : <video ref={videoRef} muted playsInline />}
        <small>Arahkan kamera ke barcode kaset atau segel.</small>
      </div>
    </div>
  )
}

function ScanInput({ label, value, expected = null, onChange, onCamera }) {
  return (
    <label className="field-scan-input">
      <span>{label}</span>
      {expected ? <small>Referensi CPC: <b>{expected}</b></small> : null}
      <div>
        <input
          value={value}
          onChange={(event) => onChange(normalizeCode(event.target.value))}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck="false"
          placeholder={`Scan ${label.toLowerCase()}`}
        />
        <button type="button" onClick={onCamera} aria-label={`Buka kamera untuk ${label}`}>Kamera</button>
      </div>
    </label>
  )
}

export default function ReplenishFieldPage() {
  const { user, permissions } = useAppBootstrap()
  const permission = permissions?.[REPLENISH_FIELD_MENU_HREF]
  const canView = user?.roleCode === "SUPER_ADMIN" || Boolean(permission?.canView)
  const [jobs, setJobs] = useState([])
  const [capabilities, setCapabilities] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [selectedJobId, setSelectedJobId] = useState(null)
  const [selectedPointId, setSelectedPointId] = useState(null)
  const [scan, setScan] = useState(emptyScan(null))
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [gps, setGps] = useState(null)
  const [cameraTarget, setCameraTarget] = useState(null)
  const [exceptionReason, setExceptionReason] = useState("")
  const [evidence, setEvidence] = useState(null)
  const [reviewNotes, setReviewNotes] = useState({})
  const [installPrompt, setInstallPrompt] = useState(null)

  const selectedPoint = useMemo(
    () => snapshot?.points?.find((item) => Number(item.id) === Number(selectedPointId)) || null,
    [selectedPointId, snapshot]
  )
  const duplicateCodes = useMemo(() => findDuplicateCodes(scan), [scan])

  const updateQueueCount = useCallback(async () => {
    try { setPendingCount(await countPendingFieldEvents()) } catch {}
  }, [])

  const loadJobs = useCallback(async () => {
    if (!canView || !navigator.onLine) return
    const result = await readJson(await fetch("/api/transactions/replenish/field", {
      credentials: "include",
      cache: "no-store",
    }))
    setJobs(result.data.jobs || [])
    setCapabilities(result.data.capabilities || null)
  }, [canView])

  const loadSnapshot = useCallback(async (workOrderId, { preferCache = false } = {}) => {
    setError("")
    if (preferCache || !navigator.onLine) {
      const cached = await getCachedFieldSnapshot(workOrderId)
      if (cached) {
        setSnapshot(cached)
        return cached
      }
      if (!navigator.onLine) throw new Error("Job ini belum pernah dimuat di perangkat untuk mode offline.")
    }
    const result = await readJson(await fetch(`/api/transactions/replenish/field/${workOrderId}`, {
      credentials: "include",
      cache: "no-store",
    }))
    setSnapshot(result.data)
    await cacheFieldSnapshot(result.data)
    return result.data
  }, [])

  const synchronize = useCallback(async () => {
    if (!navigator.onLine) return
    setBusy(true)
    try {
      let latest = null
      const result = await syncPendingFieldEvents({
        onSynced({ result: syncResult }) {
          if (syncResult.data?.snapshot) latest = syncResult.data.snapshot
        },
      })
      if (latest) setSnapshot(latest)
      await updateQueueCount()
      if (result.synced) setMessage(`${result.synced} event offline berhasil disinkronkan.`)
      await loadJobs()
    } catch (syncError) {
      if (syncError.status >= 400 && syncError.status < 500 && syncError.queuedEvent?.client_event_id) {
        await removeFieldEvent(syncError.queuedEvent.client_event_id).catch(() => {})
        await updateQueueCount()
        if (selectedJobId) await loadSnapshot(selectedJobId).catch(() => {})
      }
      setError(syncError.message || "Sinkronisasi gagal.")
    } finally {
      setBusy(false)
    }
  }, [loadJobs, loadSnapshot, selectedJobId, updateQueueCount])

  useEffect(() => {
    void registerFieldServiceWorker().catch(() => {})
    queueMicrotask(() => void updateQueueCount())
    const handleOnline = () => {
      setOnline(true)
      void synchronize()
    }
    const handleOffline = () => setOnline(false)
    const handleInstall = (event) => {
      event.preventDefault()
      setInstallPrompt(event)
    }
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    window.addEventListener("beforeinstallprompt", handleInstall)
    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      window.removeEventListener("beforeinstallprompt", handleInstall)
    }
  }, [synchronize, updateQueueCount])

  useEffect(() => {
    if (!canView) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setLoading(true)
      loadJobs()
        .catch((loadError) => {
          if (!cancelled) setError(loadError.message)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    })
    return () => { cancelled = true }
  }, [canView, loadJobs])

  async function selectJob(jobId) {
    setSelectedJobId(jobId)
    setSelectedPointId(null)
    setBusy(true)
    try { await loadSnapshot(jobId) }
    catch (loadError) { setError(loadError.message) }
    finally { setBusy(false) }
  }

  function selectPoint(point) {
    setSelectedPointId(point.id)
    setScan(emptyScan(point))
    setExceptionReason("")
    setEvidence(null)
  }

  async function submitAction(action, { pointId = null, payload = {} } = {}) {
    setBusy(true)
    setError("")
    setMessage("")
    let queued = null
    try {
      const location = await getGpsLocation()
      setGps(location)
      const event = createFieldEvent(action, { pointId, location, payload })
      queued = await queueFieldEvent(selectedJobId, event)
      await updateQueueCount()

      if (navigator.onLine) {
        let latest = null
        await syncPendingFieldEvents({
          onSynced({ result }) {
            if (result.data?.snapshot) latest = result.data.snapshot
          },
        })
        if (latest) {
          setSnapshot(latest)
          await cacheFieldSnapshot(latest)
        }
        setMessage("Event berhasil disimpan dan disinkronkan.")
        await loadJobs()
      } else {
        const optimistic = optimisticSnapshot(snapshot, action, pointId)
        setSnapshot(optimistic)
        await cacheFieldSnapshot(optimistic)
        setMessage("Event tersimpan offline dan akan dikirim otomatis saat ada sinyal.")
      }
      await updateQueueCount()
    } catch (actionError) {
      if (actionError.status >= 400 && actionError.status < 500) {
        const invalidEventId = actionError.queuedEvent?.client_event_id || queued?.client_event_id
        if (invalidEventId) await removeFieldEvent(invalidEventId).catch(() => {})
        await updateQueueCount()
      }
      setError(actionError.message || "Aksi lapangan gagal.")
    } finally {
      setBusy(false)
    }
  }

  async function submitNoGpsReview(action, exception, notes) {
    setBusy(true)
    setError("")
    let queued = null
    try {
      const event = createFieldEvent(action, {
        pointId: exception.work_order_point_id,
        payload: { exception_id: exception.id, notes },
      })
      queued = await queueFieldEvent(selectedJobId, event)
      const result = await syncPendingFieldEvents()
      await updateQueueCount()
      await loadSnapshot(selectedJobId)
      await loadJobs()
      setMessage(result.synced ? "Keputusan supervisor berhasil disimpan." : "Keputusan masuk antrean offline.")
    } catch (reviewError) {
      if (reviewError.status >= 400 && reviewError.status < 500) {
        const invalidEventId = reviewError.queuedEvent?.client_event_id || queued?.client_event_id
        if (invalidEventId) await removeFieldEvent(invalidEventId).catch(() => {})
      }
      await updateQueueCount()
      setError(reviewError.message || "Review gagal disimpan.")
    } finally {
      setBusy(false)
    }
  }

  function updateCassette(index, field, value) {
    setScan((current) => ({
      ...current,
      cassettes: current.cassettes.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    }))
  }

  function setTargetValue(value) {
    if (!cameraTarget) return
    if (cameraTarget.type === "asset") {
      setScan((current) => ({ ...current, [cameraTarget.field]: value }))
    } else {
      updateCassette(cameraTarget.index, cameraTarget.field, value)
    }
    setCameraTarget(null)
  }

  async function completePoint() {
    if (!scanComplete(scan)) {
      setError("Seluruh kaset dan segel wajib discan sebelum TID diselesaikan.")
      return
    }
    if (duplicateCodes.length) {
      setError(`Kode hasil scan tidak boleh sama. ${duplicateCodes[0]}`)
      return
    }
    await submitAction(REPLENISH_FIELD_ACTIONS.COMPLETE_POINT, {
      pointId: selectedPoint.id,
      payload: { scan },
    })
  }

  async function reportException() {
    if (!scanComplete(scan)) {
      setError("Lengkapi seluruh hasil scan sebelum melaporkan ketidaksesuaian.")
      return
    }
    if (exceptionReason.trim().length < 10 || !evidence) {
      setError("Alasan minimal 10 karakter dan foto bukti wajib dilampirkan.")
      return
    }
    await submitAction(REPLENISH_FIELD_ACTIONS.REPORT_EXCEPTION, {
      pointId: selectedPoint.id,
      payload: { scan, reason: exceptionReason, evidence },
    })
  }

  async function installApp() {
    if (!installPrompt) return
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }

  if (!canView) return <div className="error-box">Anda tidak memiliki akses Replenish Lapangan.</div>

  return (
    <div className="field-page">
      <section className="field-hero">
        <div>
          <p className="eyebrow">Operasional Replenish</p>
          <h2>Replenish Lapangan</h2>
          <p>Job Custody, GPS tahapan utama, scan kaset/segel per TID, dan antrean offline.</p>
        </div>
        <div className="field-connectivity">
          <span className={online ? "online" : "offline"}>{online ? "Online" : "Offline"}</span>
          <strong>{pendingCount} antrean</strong>
          <small>{gps ? `GPS ±${Math.round(gps.accuracy)} m` : "GPS belum diambil"}</small>
        </div>
      </section>

      <div className="field-toolbar">
        <button type="button" onClick={synchronize} disabled={busy || !online}>Sinkronkan</button>
        {installPrompt ? <button type="button" onClick={installApp}>Pasang Aplikasi</button> : null}
        <span>{user?.pegawai?.nama || user?.fullName || "Petugas Lapangan"}</span>
      </div>
      {message ? <div className="success-box">{message}</div> : null}
      {error ? <div className="error-box">{error}</div> : null}

      {!selectedJobId ? (
        <section className="field-section">
          <div className="field-section-heading">
            <div><span>Daftar tugas</span><h3>{capabilities?.supervisor ? "Review Ketidaksesuaian" : "Job Saya Hari Ini"}</h3></div>
            <small>{jobs.length} job</small>
          </div>
          {loading ? <p>Memuat job...</p> : null}
          {!loading && !jobs.length ? <div className="field-empty">Belum ada job lapangan yang aktif.</div> : null}
          <div className="field-job-list">
            {jobs.map((job) => (
              <button type="button" className="field-job-card" key={job.id} onClick={() => selectJob(job.id)}>
                <div><strong>{job.work_order_no}</strong><span className={`field-status status-${String(job.status).toLowerCase()}`}>{statusLabel(job.status)}</span></div>
                <p>{formatDate(job.schedule_date)} · {job.departure_time} · {job.vehicle_label}</p>
                <small>{job.completed_points}/{job.total_points} TID selesai · {job.pending_exceptions} menunggu review</small>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {selectedJobId && snapshot ? (
        <>
          <button type="button" className="field-back" onClick={() => { setSelectedJobId(null); setSnapshot(null); setSelectedPointId(null) }}>← Kembali ke daftar job</button>
          <section className="field-section field-job-summary">
            <div className="field-section-heading">
              <div><span>Work Order</span><h3>{snapshot.work_order.work_order_no}</h3></div>
              <span className="field-status">{statusLabel(snapshot.work_order.status)}</span>
            </div>
            <div className="field-summary-grid">
              <div><span>Jadwal</span><strong>{formatDate(snapshot.work_order.schedule_date)} · {snapshot.work_order.departure_time}</strong></div>
              <div><span>Kendaraan</span><strong>{snapshot.work_order.vehicle_label}</strong></div>
              <div><span>Unit Kerja</span><strong>{snapshot.work_order.nama_uker}</strong></div>
            </div>

            {snapshot.capabilities?.can_confirm_departure
              && snapshot.work_order.status === "SIAP_BERANGKAT"
              && !snapshot.events?.some((event) => event.action === "CONFIRM_DEPARTURE") ? (
              <button type="button" className="field-primary" disabled={busy} onClick={() => submitAction(REPLENISH_FIELD_ACTIONS.CONFIRM_DEPARTURE)}>Konfirmasi Keberangkatan Driver</button>
            ) : null}
            {snapshot.capabilities?.can_operate && snapshot.work_order.status === "SIAP_BERANGKAT" ? (
              <button type="button" className="field-primary" disabled={busy} onClick={() => submitAction(REPLENISH_FIELD_ACTIONS.START_TRIP)}>Mulai Perjalanan</button>
            ) : null}
            {snapshot.capabilities?.can_operate && snapshot.work_order.status === "SELESAI_DI_LOKASI" ? (
              <button type="button" className="field-primary" disabled={busy} onClick={() => submitAction(REPLENISH_FIELD_ACTIONS.START_RETURN)}>Mulai Perjalanan Kembali</button>
            ) : null}
            {snapshot.capabilities?.can_operate && snapshot.work_order.status === "DALAM_PERJALANAN_KEMBALI" ? (
              <button type="button" className="field-primary" disabled={busy} onClick={() => submitAction(REPLENISH_FIELD_ACTIONS.ARRIVE_OFFICE)}>Konfirmasi Tiba di Kantor</button>
            ) : null}
          </section>

          {snapshot.capabilities?.can_review_exception ? (
            <section className="field-section">
              <div className="field-section-heading"><div><span>Supervisor</span><h3>Antrean Ketidaksesuaian</h3></div></div>
              <div className="field-exception-list">
                {snapshot.exceptions.filter((item) => item.status === "MENUNGGU_REVIEW").map((exception) => {
                  const point = snapshot.points.find((item) => item.id === exception.work_order_point_id)
                  return (
                    <article key={exception.id} className="field-exception-card">
                      <div><strong>{point?.tid || `Point ${exception.work_order_point_id}`}</strong><span>Menunggu Review</span></div>
                      <p>{exception.reason}</p>
                      <ul>{exception.mismatches.map((item) => <li key={item.field}>{item.label}: <b>{item.actual}</b> (referensi {item.expected || "-"})</li>)}</ul>
                      {exception.evidence_id ? <a href={`/api/transactions/replenish/field/evidence/${exception.evidence_id}`} target="_blank" rel="noreferrer">Lihat foto bukti</a> : null}
                      <textarea value={reviewNotes[exception.id] || ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [exception.id]: event.target.value }))} placeholder="Catatan keputusan supervisor" maxLength={1000} />
                      <div className="field-review-actions">
                        <button type="button" disabled={busy} onClick={() => submitNoGpsReview(REPLENISH_FIELD_ACTIONS.REJECT_EXCEPTION, exception, reviewNotes[exception.id] || "")}>Tolak</button>
                        <button type="button" disabled={busy} onClick={() => submitNoGpsReview(REPLENISH_FIELD_ACTIONS.APPROVE_EXCEPTION, exception, reviewNotes[exception.id] || "")}>Setujui dengan Catatan</button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          ) : (
            <section className="field-section">
              <div className="field-section-heading"><div><span>Rute TID</span><h3>Pilih Lokasi</h3></div><small>{snapshot.points.filter((item) => TERMINAL_POINT_STATUSES.has(item.status)).length}/{snapshot.points.length} selesai</small></div>
              <div className="field-point-list">
                {snapshot.points.map((point) => (
                  <article className={`field-point-card ${selectedPointId === point.id ? "selected" : ""}`} key={point.id}>
                    <button type="button" onClick={() => selectPoint(point)}>
                      <span>{String(point.sequence_no).padStart(2, "0")}</span>
                      <div><strong>{point.tid}</strong><p>{point.lokasi}</p><small>{formatCurrency(point.requested_amount)} · {statusLabel(point.status)}</small></div>
                    </button>
                    {snapshot.capabilities?.can_operate && point.status === "DALAM_PERJALANAN" ? <button type="button" className="field-inline-action" disabled={busy} onClick={() => submitAction(REPLENISH_FIELD_ACTIONS.ARRIVE_POINT, { pointId: point.id })}>Saya Tiba</button> : null}
                    {snapshot.capabilities?.can_operate && point.status === "TIBA" ? <button type="button" className="field-inline-action" disabled={busy} onClick={() => submitAction(REPLENISH_FIELD_ACTIONS.START_POINT, { pointId: point.id })}>Mulai Scan</button> : null}
                  </article>
                ))}
              </div>
            </section>
          )}

          {selectedPoint && snapshot.capabilities?.can_operate && selectedPoint.status === "DALAM_PROSES" ? (
            <section className="field-section field-scan-section">
              <div className="field-section-heading"><div><span>Scan per TID</span><h3>{selectedPoint.tid} · {selectedPoint.lokasi}</h3></div><small>{scanComplete(scan) ? "Lengkap" : "Belum lengkap"}</small></div>
              <div className="field-scan-order"><b>Urutan:</b> BAG Berangkat → kaset lama → kaset baru → kaset reject → BAG Kembali</div>
              <ScanInput label="Segel BAG Berangkat" value={scan.departure_bag_seal_no} expected={selectedPoint.departure_bag_seal_no} onChange={(value) => setScan((current) => ({ ...current, departure_bag_seal_no: value }))} onCamera={() => setCameraTarget({ type: "asset", field: "departure_bag_seal_no" })} />

              {scan.cassettes.map((cassette, index) => {
                const expected = selectedPoint.cassettes[index]
                return (
                  <article className="field-cassette-card" key={cassette.cassette_no}>
                    <div><strong>Kaset {cassette.cassette_no}</strong><small>{formatCurrency(expected?.denomination_value)} · {expected?.sheets_count || 0} lembar</small></div>
                    <div className="field-cassette-columns">
                      <div><b>Kaset Lama dari ATM</b>
                        <ScanInput label="Serial kaset lama" value={cassette.old_cassette_serial} onChange={(value) => updateCassette(index, "old_cassette_serial", value)} onCamera={() => setCameraTarget({ type: "cassette", index, field: "old_cassette_serial" })} />
                        <ScanInput label="Segel kaset lama" value={cassette.old_seal_no} onChange={(value) => updateCassette(index, "old_seal_no", value)} onCamera={() => setCameraTarget({ type: "cassette", index, field: "old_seal_no" })} />
                      </div>
                      <div><b>Kaset Baru dari CPC</b>
                        <ScanInput label="Serial kaset baru" value={cassette.new_cassette_serial} expected={expected?.cassette_serial} onChange={(value) => updateCassette(index, "new_cassette_serial", value)} onCamera={() => setCameraTarget({ type: "cassette", index, field: "new_cassette_serial" })} />
                        <ScanInput label="Segel kaset baru" value={cassette.new_seal_no} expected={expected?.seal_no} onChange={(value) => updateCassette(index, "new_seal_no", value)} onCamera={() => setCameraTarget({ type: "cassette", index, field: "new_seal_no" })} />
                      </div>
                    </div>
                  </article>
                )
              })}

              <div className="field-reject-grid">
                <ScanInput label="Serial kaset reject" value={scan.reject_cassette_serial} expected={selectedPoint.reject_cassette_serial} onChange={(value) => setScan((current) => ({ ...current, reject_cassette_serial: value }))} onCamera={() => setCameraTarget({ type: "asset", field: "reject_cassette_serial" })} />
                <ScanInput label="Segel kaset reject" value={scan.reject_cassette_seal_no} expected={selectedPoint.reject_cassette_seal_no} onChange={(value) => setScan((current) => ({ ...current, reject_cassette_seal_no: value }))} onCamera={() => setCameraTarget({ type: "asset", field: "reject_cassette_seal_no" })} />
              </div>
              <ScanInput label="Segel BAG Kembali" value={scan.return_bag_seal_no} expected={selectedPoint.return_bag_seal_no} onChange={(value) => setScan((current) => ({ ...current, return_bag_seal_no: value }))} onCamera={() => setCameraTarget({ type: "asset", field: "return_bag_seal_no" })} />

              {duplicateCodes.length ? <div className="error-box">Kode duplikat: {duplicateCodes.join("; ")}</div> : null}
              <button type="button" className="field-primary" disabled={busy || !scanComplete(scan) || duplicateCodes.length > 0} onClick={completePoint}>Simpan TID Berhasil</button>

              <details className="field-exception-form">
                <summary>Laporkan Ketidaksesuaian</summary>
                <p>Gunakan hanya jika hasil scan tidak sama dengan data packing CPC.</p>
                <textarea value={exceptionReason} onChange={(event) => setExceptionReason(event.target.value)} maxLength={1000} placeholder="Jelaskan ketidaksesuaian minimal 10 karakter" />
                <label><span>Foto bukti wajib</span><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={async (event) => {
                  try { setEvidence(await fileToEvidence(event.target.files?.[0])); setError("") }
                  catch (fileError) { setEvidence(null); setError(fileError.message) }
                }} /></label>
                <small>{evidence ? "Foto siap dikirim dan disimpan di antrean offline." : "Belum ada foto."}</small>
                <button type="button" disabled={busy || !evidence || exceptionReason.trim().length < 10} onClick={reportException}>Kirim ke Supervisor</button>
              </details>
            </section>
          ) : null}
        </>
      ) : null}

      {cameraTarget ? <CameraScanner onDetected={setTargetValue} onClose={() => setCameraTarget(null)} /> : null}
    </div>
  )
}
