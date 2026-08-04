"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { ReplenishAutocomplete } from "@/components/replenish-autocomplete"
import { useAppBootstrap } from "@/components/app-bootstrap-context"
import { isReplenishTeamApprover } from "@/modules/replenish/authorization"
import { REPLENISH_MAKER_CANCELLABLE_STATUSES } from "@/modules/replenish/constants"

const ACTIVITY_OPTIONS = [
  { value: "NORMAL", label: "Replenish Normal" },
  { value: "PENGOSONGAN", label: "Pengosongan ATM/CRM" },
  { value: "PERDANA", label: "Pengisian Perdana" },
]

const PRIORITY_OPTIONS = ["RENDAH", "NORMAL", "TINGGI", "DARURAT"]

const STATUS_OPTIONS = [
  "DRAFT",
  "MENUNGGU_PERSETUJUAN_TIM",
  "DITOLAK",
  "DISETUJUI",
  "DIBATALKAN",
]

function todayString() {
  const date = new Date()
  const timezoneOffset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10)
}

function emptyForm() {
  return {
    uker: null,
    activity_type: "NORMAL",
    schedule_date: todayString(),
    departure_time: "08:00",
    estimated_finish_time: "17:00",
    priority: "NORMAL",
    vehicle: null,
    custody: null,
    driver: null,
    escort_name: "",
    points: [],
    route_notes: "",
    notes: "",
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...options,
  })
  const contentType = response.headers.get("content-type") || ""
  if (!contentType.includes("application/json")) {
    throw new Error(`Endpoint tidak mengembalikan JSON. Status ${response.status}.`)
  }
  const result = await response.json()
  if (!response.ok || !result.success) {
    const error = new Error(result.message || "Permintaan gagal diproses.")
    error.status = response.status
    throw error
  }
  return result
}

function formatCurrency(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function formatDate(value) {
  if (!value) return "-"
  const [year, month, day] = String(value).slice(0, 10).split("-")
  return year && month && day ? `${day}/${month}/${year}` : "-"
}

function formatDateTime(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function titleCaseStatus(value) {
  return String(value || "-")
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function activityLabel(value) {
  return ACTIVITY_OPTIONS.find((item) => item.value === value)?.label || value
}

function statusClass(status) {
  if (["DISETUJUI", "SELESAI", "DITUTUP"].includes(status)) return "success"
  if (["DITOLAK", "GAGAL", "DIBATALKAN"].includes(status)) return "danger"
  if (["MENUNGGU_PERSETUJUAN_TIM", "DARURAT"].includes(status)) return "warning"
  return "neutral"
}

function mapDetailToForm(workOrder) {
  const teamByRole = Object.fromEntries(
    (workOrder.team || []).map((member) => [member.member_role, member])
  )

  function employeeOption(role) {
    const member = teamByRole[role]
    return member
      ? {
          value: String(member.employee_id),
          label: `${member.nip} · ${member.nama}${member.jabatan ? ` · ${member.jabatan}` : ""}`,
          data: member,
        }
      : null
  }

  return {
    uker: {
      value: String(workOrder.uker_id),
      label: `${workOrder.codeuker} · ${workOrder.nama_uker}`,
      data: {
        id: workOrder.uker_id,
        codeuker: workOrder.codeuker,
        nama_uker: workOrder.nama_uker,
      },
    },
    activity_type: workOrder.activity_type,
    schedule_date: workOrder.schedule_date,
    departure_time: workOrder.departure_time,
    estimated_finish_time: workOrder.estimated_finish_time,
    priority: workOrder.priority,
    vehicle: {
      value: String(workOrder.vehicle_id),
      label: workOrder.vehicle_label,
      data: { id: workOrder.vehicle_id },
    },
    custody: employeeOption("CUSTODY"),
    driver: employeeOption("PENGEMUDI"),
    escort_name: workOrder.escort_name || "",
    points: (workOrder.points || []).map((point) => ({
      machine: {
        value: String(point.machine_id),
        label: `${point.tid || point.sn} · ${point.lokasi}`,
        data: point,
      },
      requested_amount:
        point.requested_amount === null || point.requested_amount === undefined
          ? ""
          : String(point.requested_amount),
      notes: point.notes || "",
    })),
    route_notes: workOrder.route_notes || "",
    notes: workOrder.notes || "",
  }
}

export default function ReplenishPage() {
  const router = useRouter()
  const { user, permissions } = useAppBootstrap()
  const toastTimer = useRef(null)
  const approvalFilterInitialized = useRef(false)

  const [workOrders, setWorkOrders] = useState([])
  const [summary, setSummary] = useState({
    total: 0,
    draft: 0,
    waiting_approval: 0,
    approved: 0,
    attention: 0,
    total_requested_amount: 0,
  })
  const [scope, setScope] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [refreshKey, setRefreshKey] = useState(0)

  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [activityFilter, setActivityFilter] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [ukerFilter, setUkerFilter] = useState(null)

  const [cursorStack, setCursorStack] = useState([null])
  const [cursorIndex, setCursorIndex] = useState(0)
  const [pagination, setPagination] = useState({ has_more: false, next_cursor: null })

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [machineCandidate, setMachineCandidate] = useState(null)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState("")

  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionLoadingId, setActionLoadingId] = useState(null)

  const [toast, setToast] = useState({ open: false, type: "success", message: "" })

  const isSuperAdmin = user?.roleCode === "SUPER_ADMIN"
  const transactionPermission = permissions?.["/transactions"] || null
  const approvalRole = isReplenishTeamApprover(user)
  const canCreate =
    (isSuperAdmin || Boolean(transactionPermission?.canCreate)) &&
    (isSuperAdmin || !approvalRole)
  const canUpdate = isSuperAdmin || Boolean(transactionPermission?.canUpdate)
  // Admin CRO yang memiliki izin create tetap boleh mengajukan atau membatalkan
  // work order miliknya sendiri. Aksi lifecycle draft tidak bergantung pada
  // permission update generik karena beberapa role legacy hanya diberi canCreate.
  const canManageOwnDraft = canCreate || canUpdate
  const canApprove = canUpdate && approvalRole
  const selectedUkerId = form.uker?.value || scope?.uker_id || null

  const excludedEmployeeValues = useMemo(
    () => [form.custody?.value, form.driver?.value].filter(Boolean),
    [form.custody, form.driver]
  )

  function showToast(type, message) {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    setToast({ open: true, type, message })
    toastTimer.current = window.setTimeout(() => {
      setToast((current) => ({ ...current, open: false }))
    }, type === "error" ? 5000 : 3500)
  }

  function resetCursor() {
    setCursorStack([null])
    setCursorIndex(0)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (!canApprove || approvalFilterInitialized.current) return
    approvalFilterInitialized.current = true
    setStatusFilter("MENUNGGU_PERSETUJUAN_TIM")
  }, [canApprove])

  useEffect(() => {
    resetCursor()
  }, [activityFilter, dateFrom, dateTo, debouncedSearch, statusFilter, ukerFilter])

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ page_size: "10" })
    const cursor = cursorStack[cursorIndex]

    if (cursor) query.set("after_id", String(cursor))
    if (debouncedSearch) query.set("search", debouncedSearch)
    if (statusFilter) query.set("status", statusFilter)
    if (activityFilter) query.set("activity_type", activityFilter)
    if (dateFrom) query.set("date_from", dateFrom)
    if (dateTo) query.set("date_to", dateTo)
    if (ukerFilter?.value) query.set("uker_id", ukerFilter.value)

    queueMicrotask(() => {
      setLoading(true)
      setLoadError("")
    })

    requestJson(`/api/transactions/replenish?${query}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        setWorkOrders(result.data?.work_orders || [])
        setSummary(result.data?.summary || {})
        setScope(result.data?.scope || null)
        setPagination(result.data?.pagination || { has_more: false, next_cursor: null })
      })
      .catch((error) => {
        if (error.name === "AbortError") return
        if (error.status === 401) {
          router.replace(`/login?next=${encodeURIComponent("/transactions/replenish")}`)
          return
        }
        if (error.status === 403) {
          router.replace("/forbidden")
          return
        }
        setLoadError(error.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [
    activityFilter,
    cursorIndex,
    cursorStack,
    dateFrom,
    dateTo,
    debouncedSearch,
    refreshKey,
    router,
    statusFilter,
    ukerFilter,
  ])

  useEffect(() => {
    if (modalOpen && !isSuperAdmin && scope?.uker_id && !form.uker) {
      setForm((current) => ({
        ...current,
        uker: {
          value: String(scope.uker_id),
          label: `${scope.codeuker || ""} · ${scope.nama_uker || "Unit Kerja"}`,
          data: scope,
        },
      }))
    }
  }, [form.uker, isSuperAdmin, modalOpen, scope])

  useEffect(() => {
    const overlayOpen = modalOpen || detailOpen
    if (!overlayOpen) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [detailOpen, modalOpen])

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
  }, [])

  function openCreateModal() {
    if (!canCreate) {
      showToast(
        "error",
        "Role Anda belum memiliki izin Tambah pada menu Transaksi. Hubungi Super Admin atau perbarui permission role."
      )
      return
    }

    const next = emptyForm()
    if (!isSuperAdmin && scope?.uker_id) {
      next.uker = {
        value: String(scope.uker_id),
        label: `${scope.codeuker || ""} · ${scope.nama_uker || "Unit Kerja"}`,
        data: scope,
      }
    }
    setEditingId(null)
    setForm(next)
    setMachineCandidate(null)
    setModalError("")
    setModalOpen(true)
  }

  async function openEditModal(id) {
    if (!canUpdate) {
      showToast("error", "Role Anda belum memiliki izin Ubah pada menu Transaksi.")
      return
    }

    setActionLoadingId(id)
    try {
      const result = await requestJson(`/api/transactions/replenish/${id}`)
      setEditingId(id)
      setForm(mapDetailToForm(result.data.work_order))
      setMachineCandidate(null)
      setModalError("")
      setModalOpen(true)
    } catch (error) {
      showToast("error", error.message)
    } finally {
      setActionLoadingId(null)
    }
  }

  function closeModal() {
    if (saving) return
    setModalOpen(false)
    setEditingId(null)
    setForm(emptyForm())
    setMachineCandidate(null)
    setModalError("")
  }

  function handleUkerSelect(option) {
    setForm((current) => ({
      ...current,
      uker: option,
      vehicle: null,
      custody: null,
      driver: null,
      escort_name: "",
      points: [],
    }))
    setMachineCandidate(null)
  }

  function addMachine(option) {
    if (!option) return
    setForm((current) => ({
      ...current,
      points: [
        ...current.points,
        { machine: option, requested_amount: "", notes: "" },
      ],
    }))
    setMachineCandidate(null)
  }

  function updatePoint(index, field, value) {
    setForm((current) => ({
      ...current,
      points: current.points.map((point, pointIndex) =>
        pointIndex === index ? { ...point, [field]: value } : point
      ),
    }))
  }

  function removePoint(index) {
    setForm((current) => ({
      ...current,
      points: current.points.filter((_, pointIndex) => pointIndex !== index),
    }))
  }

  async function handleSave(event) {
    event.preventDefault()
    if (saving) return

    const saveIntent = event.nativeEvent?.submitter?.value === "SUBMIT" ? "SUBMIT" : "DRAFT"
    const allowed = editingId ? canUpdate : canCreate
    if (!allowed) {
      setModalError(
        editingId
          ? "Role Anda belum memiliki izin Ubah pada menu Transaksi."
          : "Role Anda belum memiliki izin Tambah pada menu Transaksi."
      )
      return
    }

    setSaving(true)
    setModalError("")

    const payload = {
      uker_id: form.uker?.value || null,
      activity_type: form.activity_type,
      schedule_date: form.schedule_date,
      departure_time: form.departure_time,
      estimated_finish_time: form.estimated_finish_time,
      priority: form.priority,
      vehicle_id: form.vehicle?.value || null,
      custody_id: form.custody?.value || null,
      driver_id: form.driver?.value || null,
      escort_name: form.escort_name,
      points: form.points.map((point) => ({
        machine_id: point.machine.value,
        requested_amount: point.requested_amount,
        notes: point.notes,
      })),
      route_notes: form.route_notes,
      notes: form.notes,
    }

    try {
      const saveResult = await requestJson(
        editingId
          ? `/api/transactions/replenish/${editingId}`
          : "/api/transactions/replenish",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      )

      let finalResult = saveResult
      if (saveIntent === "SUBMIT") {
        const savedWorkOrder = saveResult.data?.work_order
        if (!savedWorkOrder?.id) {
          throw new Error("Draft berhasil disimpan, tetapi identitas work order tidak tersedia untuk proses pengajuan.")
        }

        try {
          finalResult = await requestJson(`/api/transactions/replenish/${savedWorkOrder.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "SUBMIT",
              reason: "",
            }),
          })
        } catch (submitError) {
          setEditingId(savedWorkOrder.id)
          setRefreshKey((value) => value + 1)
          throw new Error(`Draft berhasil disimpan, tetapi gagal diajukan: ${submitError.message}`)
        }
      }

      setModalOpen(false)
      setEditingId(null)
      setForm(emptyForm())
      setMachineCandidate(null)
      showToast(
        "success",
        saveIntent === "SUBMIT"
          ? `${finalResult.data?.work_order?.work_order_no || "Work order"} berhasil diajukan ke Manager Operasional.`
          : saveResult.message
      )
      resetCursor()
      setRefreshKey((value) => value + 1)
    } catch (error) {
      setModalError(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function openDetail(id) {
    setDetailOpen(true)
    setDetailLoading(true)
    setDetail(null)
    try {
      const result = await requestJson(`/api/transactions/replenish/${id}`)
      setDetail(result.data.work_order)
    } catch (error) {
      showToast("error", error.message)
      setDetailOpen(false)
    } finally {
      setDetailLoading(false)
    }
  }

  async function handleAction(item, action) {
    let reason = ""
    if (action === "REJECT") {
      reason = window.prompt("Masukkan alasan penolakan:") || ""
      if (!reason.trim()) return
    }
    if (action === "CANCEL") {
      const confirmed = window.confirm(`Batalkan work order ${item.work_order_no}?`)
      if (!confirmed) return
      reason = window.prompt("Alasan pembatalan (opsional):") || ""
    }
    if (action === "APPROVE") {
      const confirmed = window.confirm(`Setujui tim dan jadwal ${item.work_order_no}?`)
      if (!confirmed) return
    }
    if (action === "SUBMIT") {
      const confirmed = window.confirm(`Ajukan ${item.work_order_no} untuk persetujuan?`)
      if (!confirmed) return
    }

    setActionLoadingId(item.id)
    try {
      // Aksi lifecycle diproses terhadap row yang dikunci langsung di server.
      // Browser tidak perlu mengirim row_version karena representasi Buffer/hex
      // dapat berbeda antar versi driver SQL dan hasil serialisasi JSON.
      const result = await requestJson(`/api/transactions/replenish/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      })
      showToast("success", result.message)
      setRefreshKey((value) => value + 1)
      if (detail?.id === item.id) setDetail(result.data.work_order)
    } catch (error) {
      showToast("error", error.message)
    } finally {
      setActionLoadingId(null)
    }
  }

  function nextPage() {
    if (!pagination.has_more || !pagination.next_cursor) return
    const nextStack = cursorStack.slice(0, cursorIndex + 1)
    nextStack.push(pagination.next_cursor)
    setCursorStack(nextStack)
    setCursorIndex(cursorIndex + 1)
  }

  function previousPage() {
    if (cursorIndex === 0) return
    setCursorIndex((value) => value - 1)
  }

  const pointTotal = form.points.reduce(
    (total, point) => total + Number(String(point.requested_amount || "0").replaceAll(".", "").replace(",", ".") || 0),
    0
  )
  const detailIsOwner = Number(detail?.created_by) === Number(user?.id)
  const canSubmitDetail = Boolean(
    detail &&
    canManageOwnDraft &&
    ["DRAFT", "DITOLAK"].includes(detail.status) &&
    (detailIsOwner || isSuperAdmin)
  )
  const canCancelDetail = Boolean(
    detail &&
    canManageOwnDraft &&
    REPLENISH_MAKER_CANCELLABLE_STATUSES.includes(detail.status) &&
    (detailIsOwner || isSuperAdmin)
  )
  const canReviewDetail = Boolean(
    detail &&
    canUpdate &&
    canApprove &&
    detail.status === "MENUNGGU_PERSETUJUAN_TIM" &&
    !detailIsOwner
  )

  return (
    <div className="simple-page replenish-page">
      <section className="page-heading-card replenish-heading">
        <div>
          <p className="eyebrow">ATM/CRM Operations</p>
          <h2>Transaksi Replenish</h2>
          <p>
            Kelola work order, jadwal, rute, tim, kendaraan, dan persetujuan
            replenish dalam satu alur yang dapat diaudit.
          </p>
        </div>
        <div className="replenish-heading-actions">
          <Link href="/transactions" className="replenish-button secondary">
            Kembali
          </Link>
          {canCreate ? (
            <button type="button" className="replenish-button primary" onClick={openCreateModal}>
              + Buat Work Order
            </button>
          ) : null}
        </div>
      </section>

      {!canCreate && !canApprove ? (
        <div className="replenish-alert warning">
          Role <strong>{user?.roleName || user?.roleCode || "Anda"}</strong> hanya memiliki akses lihat pada menu Transaksi.
          Aktifkan permission <strong>Tambah</strong> melalui Pengaturan → User &amp; Role agar dapat membuat work order.
        </div>
      ) : null}

      {canApprove ? (
        <div className="replenish-alert warning replenish-approval-banner">
          <div>
            <strong>Antrian Approval Manager Operasional</strong> — {summary.waiting_approval || 0} work order menunggu pemeriksaan tim dan jadwal.
            {(summary.waiting_approval || 0) === 0 ? (
              <small>Belum ada transaksi yang diajukan. Work order berstatus Draft harus diajukan terlebih dahulu oleh Admin CRO.</small>
            ) : null}
          </div>
          <div className="replenish-approval-toggle">
            <button
              type="button"
              className={statusFilter === "MENUNGGU_PERSETUJUAN_TIM" ? "active" : ""}
              onClick={() => setStatusFilter("MENUNGGU_PERSETUJUAN_TIM")}
              disabled={statusFilter === "MENUNGGU_PERSETUJUAN_TIM"}
            >
              Tampilkan Antrian
            </button>
            <button
              type="button"
              className={statusFilter === "" ? "active" : ""}
              onClick={() => setStatusFilter("")}
              disabled={statusFilter === ""}
            >
              Tampilkan Semua
            </button>
          </div>
        </div>
      ) : null}

      {canCreate && !canApprove && (summary.draft || 0) > 0 ? (
        <div className="replenish-alert warning">
          Terdapat <strong>{summary.draft}</strong> work order berstatus Draft. Gunakan tombol <strong>Ajukan</strong> pada tabel atau <strong>Simpan &amp; Ajukan</strong> pada form agar transaksi masuk ke antrian Manager Operasional.
        </div>
      ) : null}

      <section className="replenish-summary-grid">
        <article><span>Total WO</span><strong>{summary.total || 0}</strong></article>
        <article><span>Draft</span><strong>{summary.draft || 0}</strong></article>
        <article><span>Menunggu Approval</span><strong>{summary.waiting_approval || 0}</strong></article>
        <article><span>Disetujui</span><strong>{summary.approved || 0}</strong></article>
        <article><span>Nominal Direncanakan</span><strong>{formatCurrency(summary.total_requested_amount)}</strong></article>
      </section>

      <section className="panel replenish-filter-panel">
        <div className="replenish-filter-grid">
          <label>
            <span>Cari WO / ATM / lokasi</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="RPL-, TID, SN, atau lokasi" />
          </label>
          <label>
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">Semua status</option>
              {STATUS_OPTIONS.map((item) => <option key={item} value={item}>{titleCaseStatus(item)}</option>)}
            </select>
          </label>
          <label>
            <span>Jenis aktivitas</span>
            <select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)}>
              <option value="">Semua aktivitas</option>
              {ACTIVITY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label>
            <span>Dari tanggal</span>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label>
            <span>Sampai tanggal</span>
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          {isSuperAdmin ? (
            <label>
              <span>Unit kerja</span>
              <ReplenishAutocomplete source="uker" selected={ukerFilter} onSelect={setUkerFilter} placeholder="Semua unit kerja" />
            </label>
          ) : null}
        </div>
      </section>

      <section className="panel replenish-table-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Work Order</p>
            <h3>Daftar transaksi replenish</h3>
          </div>
          <button type="button" className="text-button" onClick={() => setRefreshKey((value) => value + 1)}>
            Muat ulang
          </button>
        </div>

        {loadError ? <div className="replenish-alert error">{loadError}</div> : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Work Order</th>
                <th>Jadwal</th>
                <th>Aktivitas</th>
                <th>Tim</th>
                <th>Point / Nominal</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7" className="replenish-empty">Memuat data...</td></tr>
              ) : workOrders.length === 0 ? (
                <tr><td colSpan="7" className="replenish-empty">Belum ada work order replenish.</td></tr>
              ) : workOrders.map((item) => {
                const isOwner = Number(item.created_by) === Number(user?.id)
                const canEdit = canUpdate && ["DRAFT", "DITOLAK"].includes(item.status) && (isOwner || isSuperAdmin)
                const canSubmit = canManageOwnDraft && ["DRAFT", "DITOLAK"].includes(item.status) && (isOwner || isSuperAdmin)
                const canReview = canUpdate && item.status === "MENUNGGU_PERSETUJUAN_TIM" && canApprove && !isOwner
                const canCancel = canManageOwnDraft && REPLENISH_MAKER_CANCELLABLE_STATUSES.includes(item.status) && (isOwner || isSuperAdmin)
                const busy = actionLoadingId === item.id

                return (
                  <tr key={item.id}>
                    <td>
                      <button type="button" className="replenish-link-button" onClick={() => openDetail(item.id)}>
                        {item.work_order_no}
                      </button>
                      <small>{item.codeuker} · {item.nama_uker}</small>
                    </td>
                    <td>
                      <strong>{formatDate(item.schedule_date)}</strong>
                      <small>{item.departure_time}–{item.estimated_finish_time}</small>
                    </td>
                    <td>
                      <strong>{activityLabel(item.activity_type)}</strong>
                      <small>Prioritas {titleCaseStatus(item.priority)}</small>
                    </td>
                    <td>
                      <strong>Custody: {item.custody_name || "-"}</strong>
                      <small>Pengemudi: {item.driver_name || "-"}</small>
                      <small>Pengawalan: {item.escort_name || "-"}</small>
                      <small>Mobil: {item.vehicle_label}</small>
                    </td>
                    <td>
                      <strong>{item.total_points} ATM/CRM</strong>
                      <small>{formatCurrency(item.total_requested_amount)}</small>
                    </td>
                    <td>
                      <span className={`replenish-status ${statusClass(item.status)}`}>{titleCaseStatus(item.status)}</span>
                    </td>
                    <td>
                      <div className="replenish-row-actions">
                        <button type="button" onClick={() => openDetail(item.id)} disabled={busy}>Detail</button>
                        {canEdit ? <button type="button" onClick={() => openEditModal(item.id)} disabled={busy}>Ubah</button> : null}
                        {canSubmit ? <button type="button" onClick={() => handleAction(item, "SUBMIT")} disabled={busy}>Ajukan</button> : null}
                        {canReview ? <button type="button" className="approve" onClick={() => handleAction(item, "APPROVE")} disabled={busy}>Setujui</button> : null}
                        {canReview ? <button type="button" className="reject" onClick={() => handleAction(item, "REJECT")} disabled={busy}>Tolak</button> : null}
                        {canApprove && item.status === "DRAFT" && !isOwner ? (
                          <span className="replenish-action-note">Menunggu diajukan Admin CRO</span>
                        ) : null}
                        {isOwner && item.status === "MENUNGGU_PERSETUJUAN_TIM" ? (
                          <span className="replenish-action-note">Menunggu keputusan Manager Operasional / Asisten Manager CRO</span>
                        ) : null}
                        {canManageOwnDraft && ["DRAFT", "DITOLAK"].includes(item.status) && !isOwner && !isSuperAdmin && !canApprove ? (
                          <span className="replenish-action-note">Hanya pembuat draft yang dapat mengajukan</span>
                        ) : null}
                        {canCancel ? <button type="button" className="reject" onClick={() => handleAction(item, "CANCEL")} disabled={busy}>Batal</button> : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="replenish-pagination">
          <button type="button" onClick={previousPage} disabled={cursorIndex === 0 || loading}>← Sebelumnya</button>
          <span>Halaman {cursorIndex + 1}</span>
          <button type="button" onClick={nextPage} disabled={!pagination.has_more || loading}>Berikutnya →</button>
        </div>
      </section>

      {modalOpen ? (
        <div className="replenish-modal-backdrop" role="presentation">
          <section className="replenish-modal" role="dialog" aria-modal="true" aria-label="Form work order replenish">
            <header>
              <div>
                <p className="eyebrow">Work Order Replenish</p>
                <h3>{editingId ? "Ubah Draft Work Order" : "Buat Work Order Baru"}</h3>
              </div>
              <button type="button" onClick={closeModal} disabled={saving}>×</button>
            </header>

            <form onSubmit={handleSave}>
              {modalError ? <div className="replenish-alert error">{modalError}</div> : null}

              <div className="replenish-form-section">
                <h4>1. Jadwal dan Unit Kerja</h4>
                <div className="replenish-form-grid">
                  <label className="full">
                    <span>Unit kerja *</span>
                    <ReplenishAutocomplete
                      source="uker"
                      selected={form.uker}
                      onSelect={handleUkerSelect}
                      placeholder="Cari unit kerja"
                      disabled={!isSuperAdmin}
                    />
                  </label>
                  <label>
                    <span>Jenis aktivitas *</span>
                    <select value={form.activity_type} onChange={(event) => setForm((current) => ({ ...current, activity_type: event.target.value }))}>
                      {ACTIVITY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Prioritas *</span>
                    <select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}>
                      {PRIORITY_OPTIONS.map((item) => <option key={item} value={item}>{titleCaseStatus(item)}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Tanggal kegiatan *</span>
                    <input type="date" required value={form.schedule_date} onChange={(event) => setForm((current) => ({ ...current, schedule_date: event.target.value }))} />
                  </label>
                  <label>
                    <span>Jam keberangkatan *</span>
                    <input type="time" required value={form.departure_time} onChange={(event) => setForm((current) => ({ ...current, departure_time: event.target.value }))} />
                  </label>
                  <label>
                    <span>Estimasi selesai *</span>
                    <input type="time" required value={form.estimated_finish_time} onChange={(event) => setForm((current) => ({ ...current, estimated_finish_time: event.target.value }))} />
                  </label>
                  <label>
                    <span>Kendaraan *</span>
                    <ReplenishAutocomplete source="vehicle" selected={form.vehicle} onSelect={(option) => setForm((current) => ({ ...current, vehicle: option }))} ukerId={selectedUkerId} placeholder="Cari mobil operasional" />
                  </label>
                </div>
              </div>

              <div className="replenish-form-section">
                <h4>2. Komposisi Tim</h4>
                <div className="replenish-form-grid three">
                  <label>
                    <span>Custody *</span>
                    <ReplenishAutocomplete source="employee" teamRole="CUSTODY" selected={form.custody} onSelect={(option) => setForm((current) => ({ ...current, custody: option }))} ukerId={selectedUkerId} placeholder="Cari pegawai dengan jabatan Custody" excludeValues={excludedEmployeeValues.filter((value) => value !== form.custody?.value)} />
                  </label>
                  <label>
                    <span>Pengemudi *</span>
                    <ReplenishAutocomplete source="employee" teamRole="DRIVER" selected={form.driver} onSelect={(option) => setForm((current) => ({ ...current, driver: option }))} ukerId={selectedUkerId} placeholder="Cari pegawai dengan jabatan Driver" excludeValues={excludedEmployeeValues.filter((value) => value !== form.driver?.value)} />
                  </label>
                  <label>
                    <span>Petugas Pengawalan *</span>
                    <input
                      type="text"
                      required
                      maxLength="200"
                      value={form.escort_name}
                      onChange={(event) => setForm((current) => ({ ...current, escort_name: event.target.value }))}
                      placeholder="Contoh: Serka Andi / Bripka Budi"
                    />
                  </label>
                </div>
              </div>

              <div className="replenish-form-section">
                <div className="replenish-section-heading">
                  <div>
                    <h4>3. ATM/CRM dan Urutan Rute</h4>
                    <p>Maksimal 50 point dalam satu work order.</p>
                  </div>
                  <strong>{form.points.length} point · {formatCurrency(pointTotal)}</strong>
                </div>
                <div className="replenish-add-machine">
                  <ReplenishAutocomplete
                    source="machine"
                    selected={machineCandidate}
                    onSelect={(option) => {
                      setMachineCandidate(option)
                      if (option) addMachine(option)
                    }}
                    ukerId={selectedUkerId}
                    placeholder="Cari TID, SN, atau lokasi ATM/CRM"
                    excludeValues={form.points.map((point) => point.machine.value)}
                  />
                </div>

                <div className="replenish-point-list">
                  {form.points.length === 0 ? (
                    <p className="replenish-empty-card">Belum ada ATM/CRM yang dipilih.</p>
                  ) : form.points.map((point, index) => (
                    <article key={point.machine.value}>
                      <span className="replenish-sequence">{index + 1}</span>
                      <div className="replenish-point-main">
                        <strong>{point.machine.label}</strong>
                        <div className="replenish-point-inputs">
                          <label>
                            <span>Nominal kebutuhan</span>
                            <input value={point.requested_amount} onChange={(event) => updatePoint(index, "requested_amount", event.target.value)} placeholder="Contoh 500000000" inputMode="decimal" />
                          </label>
                          <label>
                            <span>Catatan point</span>
                            <input value={point.notes} onChange={(event) => updatePoint(index, "notes", event.target.value)} placeholder="Catatan khusus lokasi" />
                          </label>
                        </div>
                      </div>
                      <button type="button" className="replenish-remove-point" onClick={() => removePoint(index)}>Hapus</button>
                    </article>
                  ))}
                </div>
              </div>

              <div className="replenish-form-section">
                <h4>4. Catatan Operasional</h4>
                <div className="replenish-form-grid">
                  <label className="full">
                    <span>Rute / instruksi perjalanan</span>
                    <textarea rows="3" value={form.route_notes} onChange={(event) => setForm((current) => ({ ...current, route_notes: event.target.value }))} placeholder="Urutan area, titik kumpul, instruksi akses, atau catatan keamanan" />
                  </label>
                  <label className="full">
                    <span>Catatan work order</span>
                    <textarea rows="3" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Catatan tambahan" />
                  </label>
                </div>
              </div>

              <footer>
                <button type="button" className="replenish-button secondary" onClick={closeModal} disabled={saving}>Batal</button>
                <button type="submit" value="DRAFT" className="replenish-button secondary" disabled={saving}>
                  {saving ? "Menyimpan..." : editingId ? "Simpan Perubahan" : "Simpan Draft"}
                </button>
                {(editingId ? canUpdate : canCreate) ? (
                  <button type="submit" value="SUBMIT" className="replenish-button primary" disabled={saving}>
                    {saving ? "Memproses..." : "Simpan & Ajukan"}
                  </button>
                ) : null}
              </footer>
            </form>
          </section>
        </div>
      ) : null}

      {detailOpen ? (
        <div className="replenish-modal-backdrop" role="presentation">
          <section className="replenish-modal detail" role="dialog" aria-modal="true" aria-label="Detail work order replenish">
            <header>
              <div>
                <p className="eyebrow">Detail Work Order</p>
                <h3>{detail?.work_order_no || "Memuat..."}</h3>
              </div>
              <button type="button" onClick={() => setDetailOpen(false)}>×</button>
            </header>

            <div className="replenish-detail-body">
              {detailLoading ? <p className="replenish-empty-card">Memuat detail...</p> : detail ? (
                <>
                  <div className="replenish-detail-grid">
                    <article><span>Status</span><strong className={`replenish-status ${statusClass(detail.status)}`}>{titleCaseStatus(detail.status)}</strong></article>
                    <article><span>Aktivitas</span><strong>{activityLabel(detail.activity_type)}</strong></article>
                    <article><span>Jadwal</span><strong>{formatDate(detail.schedule_date)} · {detail.departure_time}</strong></article>
                    <article><span>Unit Kerja</span><strong>{detail.codeuker} · {detail.nama_uker}</strong></article>
                    <article><span>Kendaraan</span><strong>{detail.vehicle_label}</strong></article>
                    <article><span>Nominal</span><strong>{formatCurrency(detail.total_requested_amount)}</strong></article>
                  </div>

                  {detail.rejection_reason ? <div className="replenish-alert error"><strong>Alasan penolakan:</strong> {detail.rejection_reason}</div> : null}
                  {canApprove && detail.status === "DRAFT" && !detailIsOwner ? (
                    <div className="replenish-alert warning">
                      Work order ini masih Draft. Tombol Setujui dan Tolak akan aktif setelah Admin CRO mengajukannya.
                    </div>
                  ) : null}
                  {detailIsOwner && detail.status === "MENUNGGU_PERSETUJUAN_TIM" ? (
                    <div className="replenish-alert warning">
                      Work order sudah diajukan dan tidak dapat dibatalkan oleh Admin CRO. Tunggu keputusan Manager Operasional atau Asisten Manager CRO. Tombol Batalkan akan tersedia kembali apabila work order ditolak.
                    </div>
                  ) : null}
                  {canManageOwnDraft && ["DRAFT", "DITOLAK"].includes(detail.status) && !detailIsOwner && !isSuperAdmin && !canApprove ? (
                    <div className="replenish-alert warning">
                      Work order ini dibuat oleh {detail.created_by_name || "Admin CRO lain"}. Hanya pembuat draft yang dapat mengajukannya.
                    </div>
                  ) : null}

                  <div className="replenish-detail-section">
                    <h4>Tim Replenish</h4>
                    <div className="replenish-team-cards">
                      {(detail.team || []).map((member) => (
                        <article key={member.id}><span>{titleCaseStatus(member.member_role)}</span><strong>{member.nama}</strong><small>{member.nip} · {member.jabatan || "-"}</small></article>
                      ))}
                      <article>
                        <span>Petugas Pengawalan</span>
                        <strong>{detail.escort_name || "-"}</strong>
                        <small>Diinput manual pada work order</small>
                      </article>
                    </div>
                  </div>

                  <div className="replenish-detail-section">
                    <h4>Daftar ATM/CRM</h4>
                    <div className="replenish-detail-points">
                      {(detail.points || []).map((point) => (
                        <article key={point.id}>
                          <span>{point.sequence_no}</span>
                          <div><strong>{point.tid || point.sn} · {point.lokasi}</strong><small>{point.kategori_mesin} · {formatCurrency(point.requested_amount)}</small></div>
                        </article>
                      ))}
                    </div>
                  </div>

                  <div className="replenish-detail-section">
                    <h4>Riwayat Status</h4>
                    <div className="replenish-history">
                      {(detail.history || []).map((history) => (
                        <article key={history.id}>
                          <span>{formatDateTime(history.created_at)}</span>
                          <div><strong>{titleCaseStatus(history.action)} · {titleCaseStatus(history.to_status)}</strong><p>{history.notes || "-"}</p><small>Oleh {history.actor_name}</small></div>
                        </article>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
            {detail ? (
              <footer className="replenish-detail-actions">
                <button type="button" className="replenish-button secondary" onClick={() => setDetailOpen(false)} disabled={actionLoadingId === detail.id}>Tutup</button>
                {canCancelDetail ? (
                  <button type="button" className="replenish-button reject" onClick={() => handleAction(detail, "CANCEL")} disabled={actionLoadingId === detail.id}>Batalkan</button>
                ) : null}
                {canSubmitDetail ? (
                  <button type="button" className="replenish-button primary" onClick={() => handleAction(detail, "SUBMIT")} disabled={actionLoadingId === detail.id}>Ajukan</button>
                ) : null}
                {canReviewDetail ? (
                  <>
                    <button type="button" className="replenish-button reject" onClick={() => handleAction(detail, "REJECT")} disabled={actionLoadingId === detail.id}>Tolak</button>
                    <button type="button" className="replenish-button primary" onClick={() => handleAction(detail, "APPROVE")} disabled={actionLoadingId === detail.id}>Setujui</button>
                  </>
                ) : null}
              </footer>
            ) : null}
          </section>
        </div>
      ) : null}

      {toast.open ? <div className={`replenish-toast ${toast.type}`}>{toast.message}</div> : null}
    </div>
  )
}
