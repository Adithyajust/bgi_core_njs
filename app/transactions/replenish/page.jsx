"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { ReplenishAutocomplete } from "@/components/replenish-autocomplete"
import { useAppBootstrap } from "@/components/app-bootstrap-context"
import { isReplenishKeyHandoverPrinter, isReplenishTeamApprover } from "@/modules/replenish/authorization"
import {
  hasReplenishReachedApproval,
  REPLENISH_MAKER_CANCELLABLE_STATUSES,
  REPLENISH_PAGU_OPTIONS,
} from "@/modules/replenish/constants"
import { calculatePointRequirements } from "@/modules/replenish/calculation"

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

function isApprovedWorkOrderStatus(value) {
  return hasReplenishReachedApproval(value)
}

function todayString() {
  const date = new Date()
  const timezoneOffset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10)
}

function emptyForm() {
  return {
    uker: null,
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

function replenishCompatibilityUrl(url) {
  const rawUrl = String(url || "")
  const [pathname, rawQuery = ""] = rawUrl.split("?", 2)
  const match = pathname.match(
    /^\/api\/transactions\/replenish\/(\d+)\/(key-handover(?:\/pdf)?|surat-tugas(?:\/pdf)?)\/?$/
  )
  if (!match) return null

  const [, workOrderId, resourcePath] = match
  const resource = resourcePath === "key-handover"
    ? "key-handover"
    : resourcePath === "key-handover/pdf"
      ? "key-handover-pdf"
      : resourcePath === "surat-tugas/pdf"
        ? "surat-tugas-pdf"
        : "surat-tugas"
  const params = new URLSearchParams(rawQuery)
  params.set("resource", resource)
  return `/api/transactions/replenish/${workOrderId}?${params.toString()}`
}

async function requestJson(url, options = {}) {
  const fetchOptions = {
    credentials: "include",
    cache: "no-store",
    ...options,
  }
  let response = await fetch(url, fetchOptions)
  let contentType = response.headers.get("content-type") || ""

  if (response.status === 404 && !contentType.includes("application/json")) {
    const compatibilityUrl = replenishCompatibilityUrl(url)
    if (compatibilityUrl) {
      response = await fetch(compatibilityUrl, fetchOptions)
      contentType = response.headers.get("content-type") || ""
    }
  }

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
  if (value === "CAMPURAN") return "Aktivitas per point"
  return ACTIVITY_OPTIONS.find((item) => item.value === value)?.label || value
}

function statusClass(status) {
  if (["DISETUJUI", "SELESAI", "DITUTUP"].includes(status)) return "success"
  if (["DITOLAK", "GAGAL", "DIBATALKAN"].includes(status)) return "danger"
  if (["MENUNGGU_PERSETUJUAN_TIM", "DARURAT"].includes(status)) return "warning"
  return "neutral"
}

const ASSIGNMENT_LETTER_BLOCKED_STATUSES = new Set(["DIBATALKAN"])
const KEY_SCAN_MIN_LENGTH = 6
const KEY_SCAN_IDLE_MS = 160

function canOpenAssignmentLetter(status) {
  const normalized = String(status || "").trim().toUpperCase()
  return Boolean(normalized) && !ASSIGNMENT_LETTER_BLOCKED_STATUSES.has(normalized)
}


function validateWorkOrderForm(form) {
  if (!form.uker?.value) return "Unit kerja wajib dipilih."
  if (!form.schedule_date) return "Tanggal kegiatan wajib diisi."
  if (!form.departure_time) return "Jam keberangkatan wajib diisi."
  if (!form.estimated_finish_time) return "Estimasi selesai wajib diisi."
  if (!form.vehicle?.value) return "Kendaraan operasional wajib dipilih."
  if (!form.custody?.value) return "Custody wajib dipilih dari master pegawai."
  if (!form.driver?.value) return "Pengemudi wajib dipilih dari master pegawai."
  if (String(form.custody.value) === String(form.driver.value)) {
    return "Custody dan Pengemudi harus orang yang berbeda."
  }
  if (!form.escort_name.trim()) return "Nama Petugas Pengawalan wajib diisi."
  if (form.points.length === 0) return "Minimal satu ATM/CRM harus dipilih."

  for (let index = 0; index < form.points.length; index += 1) {
    const point = form.points[index]
    if (!point.machine?.value) return `ATM/CRM pada urutan ${index + 1} tidak valid.`
    if (!point.activity_type) return `Jenis aktivitas pada urutan ${index + 1} wajib dipilih.`
    if (point.activity_type !== "PENGOSONGAN" && !point.pagu) {
      return `Pagu pada ATM/CRM urutan ${index + 1} wajib dipilih.`
    }
  }

  return ""
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
    points: (workOrder.points || []).map((point) => {
      const activityType = point.activity_type || workOrder.activity_type || "NORMAL"
      const isPengosongan = activityType === "PENGOSONGAN"
      const calculation = !isPengosongan && point.pagu
        ? calculatePointRequirements(point.pagu, point.denomination_value || point.denom)
        : null

      return {
        machine: {
          value: String(point.machine_id),
          label: `${point.tid || point.sn} · ${point.lokasi}${point.denom ? ` · Denom ${point.denom}` : ""}`,
          data: point,
        },
        activity_type: activityType,
        pagu: !isPengosongan && point.pagu ? String(point.pagu) : "",
        requested_amount:
          isPengosongan
            ? ""
            : point.requested_amount === null || point.requested_amount === undefined
            ? calculation?.requestedAmount
              ? String(calculation.requestedAmount)
              : ""
            : String(point.requested_amount),
        cassette_count:
          isPengosongan
            ? ""
            : point.required_cassettes === null || point.required_cassettes === undefined
            ? calculation?.cassetteCount
              ? String(calculation.cassetteCount)
              : ""
            : String(point.required_cassettes),
        notes: point.notes || "",
      }
    }),
    route_notes: workOrder.route_notes || "",
    notes: workOrder.notes || "",
  }
}

export default function ReplenishPage() {
  const router = useRouter()
  const { user, permissions } = useAppBootstrap()
  const toastTimer = useRef(null)
  const createIdempotencyKey = useRef(null)
  const keyScanInputRef = useRef(null)
  const keyScanTimerRef = useRef(null)
  const detailBodyRef = useRef(null)
  const keyHandoverPdfViewerRef = useRef(null)

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
  const [transactionCapabilities, setTransactionCapabilities] = useState(null)
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
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState("")

  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [keyHandover, setKeyHandover] = useState(null)
  const [keyHandoverLoading, setKeyHandoverLoading] = useState(false)
  const [keyHandoverError, setKeyHandoverError] = useState("")
  const [keyScanBarcode, setKeyScanBarcode] = useState("")
  const [keyScanBusy, setKeyScanBusy] = useState(false)
  const [keyPrintBusy, setKeyPrintBusy] = useState(false)
  const [keyHandoverPdf, setKeyHandoverPdf] = useState(null)
  const [keyHandoverPdfVisible, setKeyHandoverPdfVisible] = useState(false)
  const [assignmentPrintStatus, setAssignmentPrintStatus] = useState(null)
  const [assignmentPrintLoading, setAssignmentPrintLoading] = useState(false)
  const [actionLoadingId, setActionLoadingId] = useState(null)

  const [toast, setToast] = useState({ open: false, type: "success", message: "" })

  const isSuperAdmin = user?.roleCode === "SUPER_ADMIN"
  const transactionPermission = permissions?.["/transactions"] || null
  const approvalRole = isReplenishTeamApprover(user)
  const keyHandoverPrinterRole = isReplenishKeyHandoverPrinter(user)
  // Cetak Serah Terima Kunci mengikuti capability transaksi, bukan hanya nama role.
  // Ini menjaga role legacy/custom (User Admin / Manager Operasional) tetap bekerja
  // selama memang diberi hak create/update pada menu Transactions.
  const fallbackCanPrintKeyHandoverByAccess = Boolean(
    isSuperAdmin ||
    keyHandoverPrinterRole ||
    transactionPermission?.canCreate ||
    transactionPermission?.canUpdate
  )
  // Prioritaskan capability yang dihitung backend dari session, role aktual,
  // permission DB, dan scope. Fallback hanya dipakai sebelum response list tiba.
  const canPrintKeyHandoverByAccess = Boolean(
    typeof transactionCapabilities?.can_print_key_handover === "boolean"
      ? transactionCapabilities.can_print_key_handover
      : fallbackCanPrintKeyHandoverByAccess
  )
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

  // Manager Operasional tetap melihat seluruh status saat halaman dibuka agar
  // Work Order yang sudah DISETUJUI (dan aksi cetaknya) tidak tersembunyi.
  // Antrian approval tetap dapat dipilih secara eksplisit dari tombol filter.
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) resetCursor()
    })
    return () => {
      cancelled = true
    }
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
        setTransactionCapabilities(result.data?.capabilities || null)
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
    if (!modalOpen || isSuperAdmin || !scope?.uker_id || form.uker) return undefined

    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setForm((current) => {
        if (current.uker) return current
        return {
          ...current,
          uker: {
            value: String(scope.uker_id),
            label: `${scope.codeuker || ""} · ${scope.nama_uker || "Unit Kerja"}`,
            data: scope,
          },
        }
      })
    })

    return () => {
      cancelled = true
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

  useEffect(() => {
    if (!detailOpen || !detail?.id) return undefined
    const refreshPrerequisites = () => {
      void loadAssignmentPrintStatus(detail.id, { silent: true })
      void loadKeyHandover(detail.id, { silent: true })
    }
    window.addEventListener("focus", refreshPrerequisites)
    return () => window.removeEventListener("focus", refreshPrerequisites)
  }, [detail?.id, detailOpen])

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
    createIdempotencyKey.current = crypto.randomUUID()
    setEditingId(null)
    setForm(next)
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
      createIdempotencyKey.current = null
      setEditingId(id)
      setForm(mapDetailToForm(result.data.work_order))
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
    createIdempotencyKey.current = null
    setForm(emptyForm())
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
  }

  function addMachine(option) {
    if (!option) return

    if (form.points.some((point) => String(point.machine.value) === String(option.value))) {
      setModalError("ATM/CRM tersebut sudah ditambahkan ke dalam urutan rute.")
      return
    }

    if (form.points.length >= 50) {
      setModalError("Maksimal 50 point ATM/CRM dalam satu work order.")
      return
    }

    setModalError("")
    setForm((current) => ({
      ...current,
      points: [
        ...current.points,
        {
          machine: option,
          activity_type: "NORMAL",
          pagu: "",
          requested_amount: "",
          cassette_count: "",
          notes: "",
        },
      ],
    }))
  }

  function updatePoint(index, field, value) {
    setForm((current) => ({
      ...current,
      points: current.points.map((point, pointIndex) => {
        if (pointIndex !== index) return point

        if (field === "activity_type") {
          if (value === "PENGOSONGAN") {
            return {
              ...point,
              activity_type: value,
              pagu: "",
              requested_amount: "",
              cassette_count: "",
            }
          }

          return { ...point, activity_type: value }
        }

        if (field !== "pagu") return { ...point, [field]: value }

        const calculation = value
          ? calculatePointRequirements(
              value,
              point.machine?.data?.denomination_value || point.machine?.data?.denom
            )
          : null

        return {
          ...point,
          pagu: value,
          requested_amount:
            calculation && !calculation.error ? String(calculation.requestedAmount) : "",
          cassette_count:
            calculation && !calculation.error ? String(calculation.cassetteCount) : "",
        }
      }),
    }))
  }

  function removePoint(index) {
    setForm((current) => ({
      ...current,
      points: current.points.filter((_, pointIndex) => pointIndex !== index),
    }))
  }

  async function handleSave(saveIntent = "DRAFT") {
    if (saving) return

    const normalizedSaveIntent = saveIntent === "SUBMIT" ? "SUBMIT" : "DRAFT"
    const allowed = editingId ? canUpdate : canCreate
    if (!allowed) {
      setModalError(
        editingId
          ? "Role Anda belum memiliki izin Ubah pada menu Transaksi."
          : "Role Anda belum memiliki izin Tambah pada menu Transaksi."
      )
      return
    }

    const validationError = validateWorkOrderForm(form)
    if (validationError) {
      setModalError(validationError)
      return
    }

    setSaving(true)
    setModalError("")

    const payload = {
      uker_id: form.uker?.value || null,
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
        activity_type: point.activity_type,
        pagu: point.activity_type === "PENGOSONGAN" ? null : point.pagu,
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
          headers: {
            "Content-Type": "application/json",
            ...(editingId
              ? {}
              : {
                  "Idempotency-Key":
                    createIdempotencyKey.current ||
                    (createIdempotencyKey.current = crypto.randomUUID()),
                }),
          },
          body: JSON.stringify(payload),
        }
      )

      let finalResult = saveResult
      if (normalizedSaveIntent === "SUBMIT") {
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
      createIdempotencyKey.current = null
      setForm(emptyForm())
      showToast(
        "success",
        normalizedSaveIntent === "SUBMIT"
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

  async function loadKeyHandover(id, { silent = false } = {}) {
    if (!silent) {
      setKeyHandoverLoading(true)
      setKeyHandoverError("")
    }

    try {
      const result = await requestJson(`/api/transactions/replenish/${id}/key-handover`)
      const snapshot = result.data?.key_handover || null
      const storedPdf = result.data?.key_handover_pdf
      setKeyHandover(snapshot)
      setKeyHandoverPdf(storedPdf?.exists ? storedPdf : null)
      setKeyHandoverError("")
      return snapshot
    } catch (error) {
      setKeyHandover(null)
      setKeyHandoverError(error.message)
      return null
    } finally {
      if (!silent) setKeyHandoverLoading(false)
    }
  }

  async function loadAssignmentPrintStatus(id, { silent = false } = {}) {
    if (!silent) setAssignmentPrintLoading(true)
    try {
      const result = await requestJson(`/api/transactions/replenish/${id}/surat-tugas/pdf?status=1`)
      const status = result.data || null
      setAssignmentPrintStatus(status)
      return status
    } catch (error) {
      setAssignmentPrintStatus({ exists: false, printed: false, error: error.message })
      return null
    } finally {
      if (!silent) setAssignmentPrintLoading(false)
    }
  }

  async function openDetail(id) {
    if (keyScanTimerRef.current) {
      window.clearTimeout(keyScanTimerRef.current)
      keyScanTimerRef.current = null
    }
    setDetailOpen(true)
    setDetailLoading(true)
    setDetail(null)
    setKeyHandover(null)
    setKeyHandoverPdf(null)
    setKeyHandoverPdfVisible(false)
    setKeyHandoverError("")
    setKeyScanBarcode("")
    setAssignmentPrintStatus(null)
    try {
      const result = await requestJson(`/api/transactions/replenish/${id}`)
      setDetail(result.data.work_order)
      await Promise.all([loadKeyHandover(id), loadAssignmentPrintStatus(id)])
      window.setTimeout(() => keyScanInputRef.current?.focus({ preventScroll: true }), 80)
      return result.data.work_order
    } catch (error) {
      showToast("error", error.message)
      setDetailOpen(false)
      return null
    } finally {
      setDetailLoading(false)
    }
  }

  function closeDetail() {
    if (actionLoadingId || keyScanBusy || keyPrintBusy) return
    if (keyScanTimerRef.current) {
      window.clearTimeout(keyScanTimerRef.current)
      keyScanTimerRef.current = null
    }
    setDetailOpen(false)
    setDetail(null)
    setKeyHandover(null)
    setKeyHandoverPdf(null)
    setKeyHandoverPdfVisible(false)
    setKeyHandoverError("")
    setKeyScanBarcode("")
    setAssignmentPrintStatus(null)
  }

  function scheduleKeyScan(rawValue) {
    const barcode = String(rawValue || "").toUpperCase().replaceAll(/\s+/g, "")
    setKeyScanBarcode(barcode)
    setKeyHandoverError("")

    if (keyScanTimerRef.current) {
      window.clearTimeout(keyScanTimerRef.current)
      keyScanTimerRef.current = null
    }

    if (barcode.length < KEY_SCAN_MIN_LENGTH || keyScanBusy || keyPrintBusy) return

    keyScanTimerRef.current = window.setTimeout(() => {
      keyScanTimerRef.current = null
      void handleKeyScan(barcode)
    }, KEY_SCAN_IDLE_MS)
  }

  async function handleKeyScan(barcodeOverride = null) {
    if (!detail?.id || keyScanBusy) return
    if (keyScanTimerRef.current) {
      window.clearTimeout(keyScanTimerRef.current)
      keyScanTimerRef.current = null
    }

    const barcode = String(barcodeOverride || keyScanBarcode).trim().toUpperCase().replaceAll(/\s+/g, "")
    if (!barcode) {
      setKeyHandoverError("Scan barcode kunci terlebih dahulu.")
      keyScanInputRef.current?.focus({ preventScroll: true })
      return
    }

    const preservedScrollTop = detailBodyRef.current?.scrollTop ?? null
    setKeyScanBusy(true)
    setKeyHandoverError("")
    try {
      const result = await requestJson(`/api/transactions/replenish/${detail.id}/key-handover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SCAN", barcode }),
      })
      setKeyHandover(result.data?.key_handover || null)
      setKeyScanBarcode("")
      showToast("success", result.message)
    } catch (error) {
      setKeyScanBarcode("")
      setKeyHandoverError(error.message)
      showToast("error", error.message)
    } finally {
      setKeyScanBusy(false)
      window.requestAnimationFrame(() => {
        if (detailBodyRef.current && preservedScrollTop !== null) {
          detailBodyRef.current.scrollTop = preservedScrollTop
        }
        keyScanInputRef.current?.focus({ preventScroll: true })
      })
    }
  }

  async function resetKeyHandoverScan() {
    if (!detail?.id || keyScanBusy) return
    if (keyScanTimerRef.current) {
      window.clearTimeout(keyScanTimerRef.current)
      keyScanTimerRef.current = null
    }
    const confirmed = window.confirm(`Reset seluruh scan kunci ${detail.work_order_no}?`)
    if (!confirmed) return

    setKeyScanBusy(true)
    setKeyHandoverError("")
    try {
      const result = await requestJson(`/api/transactions/replenish/${detail.id}/key-handover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RESET" }),
      })
      setKeyHandover(result.data?.key_handover || null)
      setKeyScanBarcode("")
      showToast("success", result.message)
    } catch (error) {
      setKeyHandoverError(error.message)
      showToast("error", error.message)
    } finally {
      setKeyScanBusy(false)
      window.setTimeout(() => keyScanInputRef.current?.focus({ preventScroll: true }), 40)
    }
  }

  async function printKeyHandoverDocument(workOrderId) {
    if (!workOrderId || keyPrintBusy) return

    setKeyPrintBusy(true)
    setKeyHandoverError("")
    try {
      // Tombol pada tabel membuka Detail Work Order di halaman yang sama. Tombol
      // di dalam detail langsung memakai modal aktif tanpa membuat tab/popup baru.
      const currentDetailIsTarget = detailOpen && Number(detail?.id) === Number(workOrderId)
      if (!currentDetailIsTarget) {
        const openedDetail = await openDetail(workOrderId)
        if (!openedDetail) return
      }

      // Pola status-first mengikuti Surat Tugas. Jika file PDF valid sudah ada,
      // langsung baca dari private storage; PREPARE_PRINT hanya dijalankan saat
      // file belum tersedia atau metadata lama sudah tidak sesuai snapshot.
      const statusResult = await requestJson(
        `/api/transactions/replenish/${workOrderId}/key-handover`
      )
      let snapshot = statusResult.data?.key_handover
      let pdf = statusResult.data?.key_handover_pdf
      const reusedStoredPdf = Boolean(
        pdf?.exists &&
        pdf?.template_current === true &&
        pdf?.pdf_url &&
        pdf?.pdf_hash &&
        pdf?.document_hash
      )

      if (!reusedStoredPdf) {
        const prepareResult = await requestJson(`/api/transactions/replenish/${workOrderId}/key-handover`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "PREPARE_PRINT" }),
        })
        snapshot = prepareResult.data?.key_handover
        pdf = prepareResult.data?.key_handover_pdf
      }

      if (!snapshot?.summary?.can_print) {
        throw new Error("Dokumen belum dapat dicetak karena scan kunci belum lengkap.")
      }
      if (!pdf?.pdf_url || !pdf?.pdf_hash || !pdf?.document_hash) {
        throw new Error("PDF Serah Terima Kunci belum berhasil dibentuk oleh server.")
      }

      setKeyHandover(snapshot)
      setKeyHandoverPdf(pdf)
      setKeyHandoverPdfVisible(true)
      window.setTimeout(() => {
        keyHandoverPdfViewerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      }, 120)
      showToast(
        "success",
        reusedStoredPdf
          ? "File PDF Serah Terima Kunci tersimpan berhasil dibaca dan ditampilkan di form Detail Work Order."
          : "PDF Serah Terima Kunci berhasil dibentuk dan ditampilkan di form Detail Work Order. Cetak melalui toolbar PDF, lalu gunakan Konfirmasi Sudah Dicetak."
      )
    } catch (error) {
      setKeyHandoverError(error.message)
      showToast("error", error.message)
    } finally {
      setKeyPrintBusy(false)
    }
  }

  async function confirmKeyHandoverPrinted(workOrderId) {
    if (!workOrderId || keyPrintBusy) return
    if (!window.confirm("Konfirmasi bahwa PDF Serah Terima Kunci yang tersimpan sudah berhasil dicetak?")) return

    setKeyPrintBusy(true)
    setKeyHandoverError("")
    try {
      const printedResult = await requestJson(`/api/transactions/replenish/${workOrderId}/key-handover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "MARK_PRINTED" }),
      })
      setKeyHandover(printedResult.data?.key_handover || null)
      if (printedResult.data?.key_handover_pdf?.exists) {
        setKeyHandoverPdf(printedResult.data.key_handover_pdf)
      }
      showToast("success", printedResult.message)
    } catch (error) {
      setKeyHandoverError(error.message)
      showToast("error", error.message)
    } finally {
      setKeyPrintBusy(false)
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
      if (detail?.id === item.id) {
        if (!assignmentPrintStatus?.letter_ready) {
          showToast("error", "Selesaikan Surat Tugas terlebih dahulu sebelum Work Order diajukan.")
          return
        }
        if (!keyHandover?.summary?.all_scanned) {
          const total = Number(keyHandover?.summary?.total_keys || detail?.total_points || 0)
          const scanned = Number(keyHandover?.summary?.scanned_keys || 0)
          showToast("error", `Scan kunci belum lengkap: ${scanned} dari ${total} kunci terverifikasi.`)
          return
        }
      }
      const confirmed = window.confirm(`Ajukan ${item.work_order_no} untuk persetujuan?`)
      if (!confirmed) return
    }

    setActionLoadingId(item.id)
    try {
      const result = await requestJson(`/api/transactions/replenish/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      })
      showToast("success", result.message)
      setRefreshKey((value) => value + 1)
      if (detail?.id === item.id) {
        setDetail(result.data.work_order)
        if (["SUBMIT", "APPROVE"].includes(action)) {
          await Promise.all([
            loadKeyHandover(item.id, { silent: true }),
            loadAssignmentPrintStatus(item.id, { silent: true }),
          ])
        }
      }
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
  const canManageDetailKeys = Boolean(
    detail &&
    canManageOwnDraft &&
    ["DRAFT", "DITOLAK"].includes(detail.status) &&
    (detailIsOwner || isSuperAdmin)
  )
  const canSubmitDetail = Boolean(
    canManageDetailKeys &&
    assignmentPrintStatus?.letter_ready &&
    keyHandover?.summary?.all_scanned
  )
  // Pencetakan dokumen setelah approval mengikuti kepemilikan Work Order,
  // bukan permission maker generik. Ini disamakan dengan endpoint Surat Tugas:
  // Admin CRO pembuat Work Order (atau Super Admin) dapat mencetak setelah DISETUJUI.
  const canPrintApprovedDocuments = Boolean(
    detail &&
    isApprovedWorkOrderStatus(detail.status) &&
    (detailIsOwner || assignmentPrintStatus?.can_prepare || isSuperAdmin)
  )
  // Tombol Serah Terima Kunci tetap terlihat untuk user yang berhak.
  // Status DISETUJUI menentukan enabled/disabled, bukan visibility tombol.
  const canPrintApprovedKeyHandover = Boolean(
    detail &&
    (
      detailIsOwner ||
      canPrintKeyHandoverByAccess ||
      keyHandover?.capabilities?.can_print_key_handover
    )
  )
  // Tombol aktif segera setelah WO disetujui. Validasi snapshot scan tetap
  // dilakukan server saat PREPARE_PRINT, sehingga kegagalan GET status scan
  // atau perubahan mapping live tidak membuat tombol sah menjadi abu-abu.
  const keyHandoverDetailPrintReady = Boolean(
    detail && isApprovedWorkOrderStatus(detail.status)
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
          Terdapat <strong>{summary.draft}</strong> work order berstatus Draft. Buka <strong>Detail</strong>, selesaikan Surat Tugas, lalu scan seluruh kunci sebelum work order diajukan. Pencetakan Surat Tugas dan Serah Terima Kunci dilakukan setelah approval.
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
                const canPrintKeyHandoverFromList = Boolean(
                  typeof item.can_print_key_handover === "boolean"
                    ? item.can_print_key_handover
                    : (isOwner || canPrintKeyHandoverByAccess)
                )
                const keyHandoverPrintReady = isApprovedWorkOrderStatus(item.status)
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
                        {canOpenAssignmentLetter(item.status) ? (
                          <Link href={`/transactions/replenish/${item.id}/surat-tugas`} className="replenish-row-link">Surat Tugas</Link>
                        ) : null}
                        {canPrintKeyHandoverFromList ? (
                          <button
                            type="button"
                            onClick={() => void printKeyHandoverDocument(item.id)}
                            disabled={busy || keyPrintBusy || !keyHandoverPrintReady}
                            title={keyHandoverPrintReady
                              ? "Cetak Serah Terima Kunci"
                              : "Cetak Serah Terima Kunci tersedia setelah Work Order disetujui"}
                          >
                            Cetak Serah Terima Kunci
                          </button>
                        ) : null}
                        {canEdit ? <button type="button" onClick={() => openEditModal(item.id)} disabled={busy}>Ubah</button> : null}
                        {canSubmit ? <button type="button" onClick={() => openDetail(item.id)} disabled={busy}>Ajukan</button> : null}
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

            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                void handleSave("DRAFT")
              }}
            >
              {modalError ? <div className="replenish-alert error replenish-form-error" role="alert">{modalError}</div> : null}

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
                    selected={null}
                    clearOnSelect
                    onSelect={(option) => {
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
                            <span>Jenis aktivitas *</span>
                            <select
                              required
                              value={point.activity_type}
                              onChange={(event) => updatePoint(index, "activity_type", event.target.value)}
                            >
                              {ACTIVITY_OPTIONS.map((item) => (
                                <option key={item.value} value={item.value}>{item.label}</option>
                              ))}
                            </select>
                          </label>
                          {point.activity_type === "PENGOSONGAN" ? (
                            <label className="full">
                              <span>Keterangan</span>
                              <input
                                value={point.notes}
                                onChange={(event) => updatePoint(index, "notes", event.target.value)}
                                placeholder="Keterangan pengosongan ATM/CRM"
                              />
                            </label>
                          ) : (
                            <>
                              <label>
                                <span>Pagu / jumlah lembar *</span>
                                <select
                                  required
                                  value={point.pagu}
                                  onChange={(event) => updatePoint(index, "pagu", event.target.value)}
                                >
                                  <option value="">Pilih pagu</option>
                                  {REPLENISH_PAGU_OPTIONS.map((pagu) => (
                                    <option key={pagu} value={pagu}>{pagu.toLocaleString("id-ID")}</option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>Nominal kebutuhan</span>
                                <input
                                  readOnly
                                  value={point.requested_amount ? formatCurrency(point.requested_amount) : ""}
                                  placeholder="Otomatis: pagu × denom"
                                />
                              </label>
                              <label>
                                <span>Kebutuhan kaset</span>
                                <input
                                  readOnly
                                  value={point.cassette_count ? `${point.cassette_count} kaset` : ""}
                                  placeholder="Otomatis: pagu ÷ 2.000"
                                />
                              </label>
                              <label>
                                <span>Keterangan</span>
                                <input
                                  value={point.notes}
                                  onChange={(event) => updatePoint(index, "notes", event.target.value)}
                                  placeholder="Keterangan khusus lokasi"
                                />
                              </label>
                            </>
                          )}
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
                <button
                  type="button"
                  value="DRAFT"
                  className="replenish-button secondary"
                  disabled={saving}
                  onClick={() => void handleSave("DRAFT")}
                >
                  {saving ? "Menyimpan..." : editingId ? "Simpan Perubahan" : "Simpan Draft"}
                </button>
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
              <button type="button" onClick={closeDetail}>×</button>
            </header>

            <div className="replenish-detail-body" ref={detailBodyRef}>
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
                      Work order ini masih Draft. Admin CRO harus menyelesaikan Surat Tugas dan scan seluruh kunci, lalu mengajukannya. Tombol Setujui dan Tolak akan aktif setelah Admin CRO mengajukannya.
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
                          <div>
                            <strong>{point.tid || point.sn} · {point.lokasi}</strong>
                            <small>
                              {activityLabel(point.activity_type || detail.activity_type)}
                              {(point.activity_type || detail.activity_type) !== "PENGOSONGAN" ? (
                                <>
                                  {point.pagu ? ` · Pagu ${Number(point.pagu).toLocaleString("id-ID")} lembar` : " · Pagu data lama"}
                                  {point.denomination_value ? ` · Denom ${Number(point.denomination_value).toLocaleString("id-ID")}` : point.denom ? ` · Denom ${point.denom}` : ""}
                                  {point.required_cassettes ? ` · ${point.required_cassettes} kaset` : ""}
                                  {point.requested_amount !== null && point.requested_amount !== undefined
                                    ? ` · ${formatCurrency(point.requested_amount)}`
                                    : ""}
                                </>
                              ) : null}
                            </small>
                            {point.notes ? <small>Keterangan: {point.notes}</small> : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>

                  <div className="replenish-detail-section replenish-document-gate-section">
                    <div className="replenish-section-heading">
                      <div>
                        <h4>Kelengkapan Pengajuan</h4>
                        <p>Urutan Admin CRO: selesaikan Surat Tugas, scan seluruh kunci, lalu Ajukan. Surat Tugas dan Serah Terima Kunci baru dicetak setelah Work Order disetujui.</p>
                      </div>
                    </div>
                    <div className="replenish-document-gate-grid">
                      <article className={assignmentPrintStatus?.letter_ready || assignmentPrintStatus?.approved ? "success" : ""}>
                        <span>Surat Tugas</span>
                        <strong>
                          {assignmentPrintLoading
                            ? "Memeriksa..."
                            : assignmentPrintStatus?.approved
                              ? "Disetujui · Siap Dicetak"
                              : assignmentPrintStatus?.letter_ready
                                ? "Selesai Disiapkan"
                                : "Belum Diselesaikan"}
                        </strong>
                        <small>
                          {assignmentPrintStatus?.approved
                            ? (assignmentPrintStatus?.printed
                              ? `Sudah dicetak ${formatDateTime(assignmentPrintStatus.printed_at)}${assignmentPrintStatus.printed_by_name ? ` · ${assignmentPrintStatus.printed_by_name}` : ""}`
                              : "Approval selesai. Admin CRO dapat mencetak Surat Tugas.")
                            : assignmentPrintStatus?.letter_ready
                              ? "Persiapan Surat Tugas valid. Lanjutkan scan kunci."
                              : "Buka Surat Tugas untuk menyelesaikan dokumen persiapan."}
                        </small>
                      </article>
                      <article className={keyHandover?.summary?.all_scanned ? "success" : ""}>
                        <span>Scan Kunci</span>
                        <strong>{keyHandover?.summary?.scanned_keys || 0} / {keyHandover?.summary?.total_keys || 0} Terverifikasi</strong>
                        <small>
                          {keyHandover?.summary?.all_scanned
                            ? "Semua kunci sudah OUT dan siap menjadi syarat pengajuan."
                            : "Scan seluruh kunci sesuai ATM/CRM pada Work Order."}
                        </small>
                      </article>
                    </div>
                    {isApprovedWorkOrderStatus(detail.status) ? (
                      <div className="replenish-document-gate-grid">
                        <article className={assignmentPrintStatus?.printed ? "success" : ""}>
                          <span>Cetak Surat Tugas</span>
                          <strong>{assignmentPrintStatus?.printed ? "Sudah Dicetak" : "Belum Dicetak"}</strong>
                          <small>{assignmentPrintStatus?.printed_at ? formatDateTime(assignmentPrintStatus.printed_at) : "Cetak oleh Admin CRO setelah approval."}</small>
                        </article>
                        <article className={keyHandover?.summary?.printed ? "success" : ""}>
                          <span>Cetak Serah Terima Kunci</span>
                          <strong>{keyHandover?.summary?.printed ? "Sudah Dicetak" : "Belum Dicetak"}</strong>
                          <small>{keyHandover?.printed_at ? formatDateTime(keyHandover.printed_at) : "Setelah approval, masing-masing pihak memperoleh QR pada blok penyerah dan penerima."}</small>
                        </article>
                      </div>
                    ) : null}
                  </div>

                  <div className="replenish-detail-section replenish-key-handover-section">
                    <div className="replenish-section-heading">
                      <div>
                        <h4>Pengecekan &amp; Serah Terima Kunci</h4>
                        <p>Admin CRO melakukan scan barcode kunci Replenish setelah Surat Tugas selesai disiapkan. Setelah Work Order disetujui, PDF Serah Terima Kunci menampilkan QR terpisah pada blok penyerah dan penerima, lengkap dengan nama, jabatan, dan NIP.</p>
                      </div>
                      {keyHandover?.verified_at ? (
                        <span className="replenish-key-verified-badge">Terverifikasi</span>
                      ) : null}
                    </div>

                    {keyHandoverLoading ? (
                      <p className="replenish-empty-card">Memuat status kunci...</p>
                    ) : keyHandover ? (
                      <>
                        <div className="replenish-key-summary">
                          <article>
                            <span>Kunci Work Order</span>
                            <strong>{keyHandover.summary?.total_keys || 0}</strong>
                          </article>
                          <article>
                            <span>Mapping Kunci</span>
                            <strong>{keyHandover.summary?.mapped_keys || 0}</strong>
                          </article>
                          <article className={keyHandover.summary?.all_scanned ? "success" : ""}>
                            <span>Sudah Discan</span>
                            <strong>{keyHandover.summary?.scanned_keys || 0} / {keyHandover.summary?.total_keys || 0}</strong>
                          </article>
                          <article className={keyHandover.summary?.printed ? "success" : ""}>
                            <span>Dokumen</span>
                            <strong>{keyHandover.summary?.printed ? "Sudah Dicetak" : "Belum Dicetak"}</strong>
                          </article>
                        </div>

                        {keyHandover.summary?.missing_mapping > 0 ? (
                          <div className="replenish-alert error">
                            {keyHandover.summary.missing_mapping} ATM/CRM belum memiliki mapping kunci Replenish. Lengkapi mapping pada Master Kunci Mesin.
                          </div>
                        ) : null}
                        {keyHandover.summary?.unavailable_keys > 0 ? (
                          <div className="replenish-alert error">
                            {keyHandover.summary.unavailable_keys} kunci sedang tidak tersedia karena dipakai pada transaksi lain.
                          </div>
                        ) : null}
                        {keyHandover.summary?.can_submit ? (
                          <div className="replenish-alert success">
                            Seluruh kunci sudah terverifikasi dan berstatus OUT. Jika Surat Tugas sudah selesai disiapkan, Admin CRO dapat mengajukan Work Order ke Manager Operasional / Asisten Manager CRO.
                          </div>
                        ) : null}

                        {canManageDetailKeys ? (
                          <div className="replenish-key-scan-panel">
                            <label htmlFor="replenish-key-barcode">
                              <span>Barcode Kunci</span>
                              <div className="replenish-key-scan-row">
                                <input
                                  id="replenish-key-barcode"
                                  ref={keyScanInputRef}
                                  value={keyScanBarcode}
                                  onChange={(event) => scheduleKeyScan(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") event.preventDefault()
                                  }}
                                  autoComplete="off"
                                  spellCheck="false"
                                  placeholder="Scan barcode kunci — verifikasi otomatis"
                                  disabled={keyScanBusy || keyPrintBusy || !assignmentPrintStatus?.letter_ready}
                                />
                                <button
                                  type="button"
                                  className="replenish-button primary"
                                  onClick={() => void handleKeyScan()}
                                  disabled={keyScanBusy || keyPrintBusy || !assignmentPrintStatus?.letter_ready || !keyScanBarcode.trim()}
                                >
                                  {keyScanBusy ? "Memverifikasi..." : "Scan Kunci"}
                                </button>
                              </div>
                              <small>
                                {assignmentPrintStatus?.letter_ready
                                  ? "Barcode akan diverifikasi otomatis setelah scanner selesai membaca. Tidak perlu menekan Enter."
                                  : "Selesaikan Surat Tugas terlebih dahulu. Scanner akan aktif setelah dokumen persiapan valid."}
                              </small>
                              {keyHandoverError ? (
                                <div className="replenish-alert error replenish-key-scan-message" role="alert">
                                  {keyHandoverError}
                                </div>
                              ) : null}
                            </label>
                            <div className="replenish-key-scan-actions">
                              <button
                                type="button"
                                className="replenish-button secondary"
                                onClick={() => void resetKeyHandoverScan()}
                                disabled={keyScanBusy || keyPrintBusy || !(keyHandover.summary?.scanned_keys > 0)}
                              >
                                Reset Scan
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {canPrintApprovedKeyHandover ? (
                          <div className="replenish-key-scan-actions">
                            <button
                              type="button"
                              className="replenish-button secondary"
                              onClick={() => void printKeyHandoverDocument(detail.id)}
                              disabled={keyPrintBusy || !keyHandoverDetailPrintReady}
                              title={isApprovedWorkOrderStatus(detail.status)
                                ? "Cetak dokumen Serah Terima Kunci"
                                : "Cetak tersedia setelah Work Order disetujui"}
                            >
                              {keyPrintBusy
                                ? "Menyiapkan PDF..."
                                : keyHandover.summary?.printed
                                  ? "Buka Ulang PDF Serah Terima Kunci"
                                  : "Bentuk PDF & Cetak Serah Terima Kunci"}
                            </button>
                            {!keyHandover.summary?.printed && Number(keyHandoverPdf?.work_order_id) === Number(detail.id) ? (
                              <button
                                type="button"
                                className="replenish-button primary"
                                onClick={() => void confirmKeyHandoverPrinted(detail.id)}
                                disabled={keyPrintBusy}
                              >
                                Konfirmasi Sudah Dicetak
                              </button>
                            ) : null}
                          </div>
                        ) : null}

                        {keyHandoverPdfVisible &&
                        Number(keyHandoverPdf?.work_order_id) === Number(detail.id) &&
                        keyHandoverPdf?.pdf_url ? (
                          <section
                            ref={keyHandoverPdfViewerRef}
                            className="replenish-key-pdf-panel"
                            aria-label="Pratinjau PDF Serah Terima Kunci"
                          >
                            <header className="replenish-key-pdf-panel__header">
                              <div>
                                <span>PDF Serah Terima Kunci</span>
                                <strong>{keyHandoverPdf.file_name || `work-order-${detail.id}.pdf`}</strong>
                                <small>Cetak menggunakan ikon printer pada toolbar PDF di bawah.</small>
                              </div>
                              <button
                                type="button"
                                className="replenish-button secondary"
                                onClick={() => setKeyHandoverPdfVisible(false)}
                                disabled={keyPrintBusy}
                              >
                                Tutup Pratinjau
                              </button>
                            </header>
                            <iframe
                              key={keyHandoverPdf.pdf_hash}
                              src={`${keyHandoverPdf.pdf_url}#toolbar=1&navpanes=0&view=FitH`}
                              className="replenish-key-pdf-viewer"
                              title={`PDF Serah Terima Kunci ${detail.work_order_no || detail.id}`}
                            />
                          </section>
                        ) : null}

                        <div className="replenish-key-list">
                          {(keyHandover.items || []).map((item) => {
                            const unavailable = item.mapping_status !== "IN" && Number(item.current_work_order_id) !== Number(detail.id)
                            const statusLabel = !item.machine_key_mapping_id
                              ? "Mapping belum ada"
                              : unavailable
                                ? "Tidak tersedia"
                                : item.scanned
                                  ? "Sudah Discan"
                                  : "Menunggu Scan"
                            const statusClassName = item.scanned
                              ? "success"
                              : (!item.machine_key_mapping_id || unavailable)
                                ? "danger"
                                : "neutral"

                            return (
                              <article key={item.work_order_point_id} className={item.scanned ? "verified" : ""}>
                                <span className="replenish-key-sequence">{item.sequence_no}</span>
                                <div className="replenish-key-item-main">
                                  <strong>{item.tid || item.sn || `Mesin ${item.machine_id}`} · {item.lokasi || "-"}</strong>
                                  <small>
                                    SN {item.sn || "-"} · Matrix {item.position || "-"}
                                    {item.scanned_at ? ` · Scan ${formatDateTime(item.scanned_at)}` : ""}
                                  </small>
                                  {item.scanned && item.barcode_snapshot ? <code>{item.barcode_snapshot}</code> : null}
                                </div>
                                <span className={`replenish-key-state ${statusClassName}`}>{statusLabel}</span>
                              </article>
                            )
                          })}
                        </div>
                      </>
                    ) : keyHandoverError ? (
                      <div className="replenish-alert error" role="alert">{keyHandoverError}</div>
                    ) : (
                      <p className="replenish-empty-card">Status kunci belum tersedia.</p>
                    )}
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
                <button type="button" className="replenish-button secondary" onClick={closeDetail} disabled={actionLoadingId === detail.id || keyScanBusy || keyPrintBusy}>Tutup</button>
                {canOpenAssignmentLetter(detail.status) ? (
                  <Link href={`/transactions/replenish/${detail.id}/surat-tugas`} target="_blank" rel="noreferrer" className="replenish-button secondary">
                    {canManageDetailKeys
                      ? (assignmentPrintStatus?.letter_ready ? "Tinjau Surat Tugas" : "Selesaikan Surat Tugas")
                      : canPrintApprovedDocuments
                        ? (assignmentPrintStatus?.printed ? "Cetak Ulang Surat Tugas" : "Cetak Surat Tugas")
                        : "Lihat Surat Tugas"}
                  </Link>
                ) : null}
                {canPrintApprovedKeyHandover ? (
                  <button
                    type="button"
                    className="replenish-button secondary"
                    onClick={() => void printKeyHandoverDocument(detail.id)}
                    disabled={keyPrintBusy || !keyHandoverDetailPrintReady}
                    title={!isApprovedWorkOrderStatus(detail.status)
                      ? "Cetak Serah Terima Kunci tersedia setelah Work Order disetujui"
                      : "Cetak dokumen Serah Terima Kunci"}
                  >
                    {keyPrintBusy
                      ? "Menyiapkan PDF..."
                      : keyHandover?.summary?.printed
                        ? "Buka Ulang PDF Serah Terima Kunci"
                        : "Bentuk PDF & Cetak Serah Terima Kunci"}
                  </button>
                ) : null}
                {canCancelDetail ? (
                  <button type="button" className="replenish-button reject" onClick={() => handleAction(detail, "CANCEL")} disabled={actionLoadingId === detail.id || keyScanBusy || keyPrintBusy}>Batalkan</button>
                ) : null}
                {canManageDetailKeys ? (
                  <button
                    type="button"
                    className="replenish-button primary"
                    onClick={() => handleAction(detail, "SUBMIT")}
                    disabled={actionLoadingId === detail.id || keyScanBusy || keyPrintBusy || keyHandoverLoading || assignmentPrintLoading || !canSubmitDetail}
                    title={canSubmitDetail
                      ? "Ajukan Work Order ke Manager Operasional / Asisten Manager CRO"
                      : "Selesaikan Surat Tugas dan scan seluruh kunci terlebih dahulu"}
                  >
                    Ajukan ke Manager
                  </button>
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
