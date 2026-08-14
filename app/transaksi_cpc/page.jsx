"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { useAppBootstrap } from "@/components/app-bootstrap-context"
import {
  CPC_ACTION_LABELS,
  CPC_ACTIONS,
  CPC_MENU_HREF,
  CPC_PACKING_ASSIGNMENT_ACTIONS,
  CPC_PACKING_SHEETS_PER_CASSETTE,
  CPC_QUEUE_STATUSES,
  cpcActionForStatus,
  cpcStatusLabel,
} from "@/modules/cpc/constants"

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

function formatDate(value) {
  if (!value) return "-"
  const [year, month, day] = String(value).slice(0, 10).split("-")
  return year && month && day ? `${day}/${month}/${year}` : "-"
}

function formatDateTime(value) {
  if (!value) return "-"
  const normalized = String(value).replace(" ", "T")
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function titleCase(value) {
  return String(value || "-")
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function statusClass(status) {
  if (["KASET_SIAP", "SIAP_BERANGKAT"].includes(status)) return "success"
  if (["MENUNGGU_VALIDASI_KASET", "KASET_DALAM_PERSIAPAN", "MENUNGGU_APPROVAL_CPC"].includes(status)) return "warning"
  return "neutral"
}

function activityLabel(value) {
  if (value === "NORMAL") return "Replenish Normal"
  if (value === "PENGOSONGAN") return "Pengosongan"
  if (value === "PERDANA") return "Pengisian Perdana"
  if (value === "CAMPURAN") return "Aktivitas Campuran"
  return titleCase(value)
}

function packingAssignmentLabel(value) {
  if (value === "UNASSIGNED") return "Belum Diambil"
  if (value === "ASSIGNED") return "Sudah Ditugaskan"
  if (value === "IN_PROGRESS") return "Sedang Packing"
  if (value === "PACKING_COMPLETE") return "Packing Selesai"
  return titleCase(value)
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...options,
  })
  const contentType = response.headers.get("content-type") || ""
  if (!contentType.includes("application/json")) {
    throw new Error(`Endpoint CPC tidak mengembalikan JSON. Status ${response.status}.`)
  }
  const result = await response.json()
  if (!response.ok || !result.success) {
    const error = new Error(result.message || "Permintaan CPC gagal diproses.")
    error.status = response.status
    throw error
  }
  return result
}

const packingScanTimers = new WeakMap()

function clearPackingScanTimer(input) {
  if (!(input instanceof HTMLInputElement)) return
  const timerId = packingScanTimers.get(input)
  if (timerId) window.clearTimeout(timerId)
  packingScanTimers.delete(input)
}

export default function CpcTransactionPage() {
  const { user, permissions } = useAppBootstrap()
  const toastTimer = useRef(null)

  const [items, setItems] = useState([])
  const [summary, setSummary] = useState({
    total: 0,
    new_requests: 0,
    waiting_validation: 0,
    in_preparation: 0,
    waiting_approval: 0,
    ready: 0,
    handed_over: 0,
    total_requested_amount: 0,
    total_sheets: 0,
    total_cassettes: 0,
  })
  const [scope, setScope] = useState(null)
  const [activePackingJob, setActivePackingJob] = useState(null)
  const [spareCassettes, setSpareCassettes] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [refreshKey, setRefreshKey] = useState(0)

  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  const [cursorStack, setCursorStack] = useState([null])
  const [cursorIndex, setCursorIndex] = useState(0)
  const [pagination, setPagination] = useState({ has_more: false, next_cursor: null })

  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailCapabilities, setDetailCapabilities] = useState({
    can_approve_packing: false,
    can_manage_packing_assignments: false,
    can_claim_packing_work_order: false,
    can_edit_packing: false,
    packing_owner_is_me: false,
    active_packing_work_order_id: null,
    active_packing_work_order_no: null,
  })
  const [packingOperators, setPackingOperators] = useState([])
  const [packingFilter, setPackingFilter] = useState("ALL")
  const [packingScanPointId, setPackingScanPointId] = useState("")
  const [packingItems, setPackingItems] = useState([])
  const [packingTidAssets, setPackingTidAssets] = useState([])
  const [spareScanDrafts, setSpareScanDrafts] = useState({})
  const [spareScanErrors, setSpareScanErrors] = useState({})
  const [spareAutocompleteOpenItemId, setSpareAutocompleteOpenItemId] = useState(null)
  const [packingSaving, setPackingSaving] = useState(false)
  const [packingDirty, setPackingDirty] = useState(false)
  const [packingDirtyPointIds, setPackingDirtyPointIds] = useState([])
  const [assignmentLoadingPointId, setAssignmentLoadingPointId] = useState(null)
  const [assignmentSelections, setAssignmentSelections] = useState({})
  const [handoverItems, setHandoverItems] = useState([])
  const [handoverSaving, setHandoverSaving] = useState(false)
  const [handoverDirty, setHandoverDirty] = useState(false)
  const [handoverNotes, setHandoverNotes] = useState("")
  const [custodyNip, setCustodyNip] = useState("")
  const [actionNotes, setActionNotes] = useState("")
  const [actionLoading, setActionLoading] = useState(false)
  const [rowActionId, setRowActionId] = useState(null)
  const [toast, setToast] = useState({ open: false, type: "success", message: "" })

  const isSuperAdmin = user?.roleCode === "SUPER_ADMIN"
  const permission = permissions?.[CPC_MENU_HREF] || null
  const canUpdate = isSuperAdmin || Boolean(permission?.canUpdate)

  const currentCursor = cursorStack[cursorIndex] || null

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
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) resetCursor()
    })
    return () => {
      cancelled = true
    }
  }, [debouncedSearch, statusFilter, dateFrom, dateTo])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError("")
      try {
        const params = new URLSearchParams({ page_size: "10" })
        if (currentCursor) params.set("after_id", String(currentCursor))
        if (debouncedSearch) params.set("search", debouncedSearch)
        if (statusFilter) params.set("status", statusFilter)
        if (dateFrom) params.set("date_from", dateFrom)
        if (dateTo) params.set("date_to", dateTo)

        const result = await requestJson(`/api/transactions/cpc?${params.toString()}`)
        if (cancelled) return
        setItems(result.data.requests || [])
        setSummary(result.data.summary || {})
        setScope(result.data.scope || null)
        setActivePackingJob(result.data.active_packing_job || null)
        setPagination(result.data.pagination || { has_more: false, next_cursor: null })
      } catch (error) {
        if (cancelled) return
        setItems([])
        setActivePackingJob(null)
        setLoadError(error.message || "Gagal memuat permintaan CPC.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [currentCursor, debouncedSearch, statusFilter, dateFrom, dateTo, refreshKey])

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
  }, [])

  const detailTotals = useMemo(() => detail?.cpc_requirements || {
    total_sheets: 0,
    total_cassettes: 0,
    cash_points: 0,
    total_requested_amount: 0,
  }, [detail])

  const packingSummary = detail?.cpc_packing?.summary || {
    expected_cassettes: 0,
    completed_cassettes: 0,
    sealed_cassettes: 0,
    expected_reject_cassettes: 0,
    completed_reject_cassettes: 0,
    expected_reject_cassette_seals: 0,
    completed_reject_cassette_seals: 0,
    expected_bag_seals: 0,
    completed_bag_seals: 0,
    expected_tids: 0,
    completed_tids: 0,
    unassigned_tids: 0,
    assigned_tids: 0,
    in_progress_tids: 0,
    packing_complete_tids: 0,
    per_tid_enabled: false,
    all_complete: false,
  }

  const duplicatePackingCodes = useMemo(() => {
    const seen = new Set()
    const duplicates = new Set()
    const register = (rawValue) => {
      const value = String(rawValue || "").trim().toUpperCase()
      if (!value) return
      if (seen.has(value)) duplicates.add(value)
      seen.add(value)
    }

    for (const item of packingItems) {
      register(item.cassette_serial)
      register(item.seal_no)
    }
    for (const asset of packingTidAssets) {
      register(asset.reject_cassette_serial)
      register(asset.reject_cassette_seal_no)
      register(asset.departure_bag_seal_no)
      register(asset.return_bag_seal_no)
    }
    return duplicates
  }, [packingItems, packingTidAssets])

  const packingGroups = useMemo(() => {
    const cashByPoint = new Map()
    for (const item of packingItems) {
      const pointId = Number(item.work_order_point_id)
      if (!cashByPoint.has(pointId)) cashByPoint.set(pointId, [])
      cashByPoint.get(pointId).push(item)
    }

    const groups = packingTidAssets.map((asset) => ({
      pointId: Number(asset.work_order_point_id),
      asset,
      items: cashByPoint.get(Number(asset.work_order_point_id)) || [],
    }))

    if (groups.length > 0) return groups

    return [...cashByPoint.entries()].map(([pointId, items]) => ({
      pointId,
      asset: null,
      items,
    }))
  }, [packingItems, packingTidAssets])

  const currentUserId = Number(user?.id || 0)
  const packingOwnerUserId = Number(detail?.cpc_packing?.batch?.packing_owner_user_id || 0) || null
  const packingOwnerName = detail?.cpc_packing?.batch?.packing_owner_name || null
  const packingOwnerIsMe = Boolean(packingOwnerUserId && packingOwnerUserId === currentUserId)
  const packingOwnedByOther = Boolean(packingOwnerUserId && packingOwnerUserId !== currentUserId)
  const legacyMyPackingGroups = packingGroups.filter((group) => Number(group.asset?.assigned_to || 0) === currentUserId)
  // Exclusive Work Order ownership adalah sumber kebenaran utama. Setelah satu WO
  // dikunci ke operator, seluruh TID di dalam WO tersebut adalah area packing operator
  // itu, meskipun snapshot assignment per-TID yang sedang tampil masih legacy/stale.
  const myPackingGroups = packingOwnerIsMe ? packingGroups : legacyMyPackingGroups
  const operatorPackingGroups = myPackingGroups
  // Dropdown scan hanya menampilkan TID yang belum dikonfirmasi lengkap oleh server.
  // TID yang baru lengkap di browser tetap tersedia sampai Simpan Hasil Scan berhasil.
  const pendingPackingScanGroups = operatorPackingGroups.filter((group) =>
    String(group.asset?.assignment_status || "").trim().toUpperCase() !== "PACKING_COMPLETE"
  )
  const unassignedPackingGroups = packingOwnerUserId
    ? []
    : packingGroups.filter((group) => !Number(group.asset?.assigned_to || 0))
  const visiblePackingGroups = packingFilter === "MINE"
    ? myPackingGroups
    : packingFilter === "UNASSIGNED"
      ? unassignedPackingGroups
      : packingGroups

  const localPackingComplete = packingGroups.length > 0 && packingGroups.every((group) => {
    const cashComplete = group.items.every((item) =>
      String(item.cassette_serial || "").trim() && String(item.seal_no || "").trim()
    )
    if (!group.asset) return false
    return cashComplete
      && String(group.asset.reject_cassette_serial || "").trim()
      && String(group.asset.reject_cassette_seal_no || "").trim()
      && String(group.asset.departure_bag_seal_no || "").trim()
      && String(group.asset.return_bag_seal_no || "").trim()
  }) && duplicatePackingCodes.size === 0

  const requestedPackingScanPointId = Number(packingScanPointId || 0)
  const packingScanGroup = pendingPackingScanGroups.find((group) => Number(group.pointId) === requestedPackingScanPointId)
    || pendingPackingScanGroups[0]
    || null

  const packingScanRequiredFields = packingScanGroup
    ? packingScanGroup.items.length + (packingScanGroup.asset ? 4 : 0)
    : 0
  const packingScanCompletedFields = packingScanGroup
    ? packingScanGroup.items.reduce((count, item) => count
      + (item.spare_cassette_id || (
        String(item.cassette_serial || "").trim() && String(item.seal_no || "").trim()
      ) ? 1 : 0), 0)
      + (packingScanGroup.asset
        ? (String(packingScanGroup.asset.reject_cassette_serial || "").trim() ? 1 : 0)
          + (String(packingScanGroup.asset.reject_cassette_seal_no || "").trim() ? 1 : 0)
          + (String(packingScanGroup.asset.departure_bag_seal_no || "").trim() ? 1 : 0)
          + (String(packingScanGroup.asset.return_bag_seal_no || "").trim() ? 1 : 0)
        : 0)
    : 0
  const packingScanGroupComplete = Boolean(
    packingScanGroup
      && packingScanRequiredFields > 0
      && packingScanCompletedFields === packingScanRequiredFields
      && packingScanGroup.items.every((item) => {
        const serial = String(item.cassette_serial || "").trim().toUpperCase()
        const seal = String(item.seal_no || "").trim().toUpperCase()
        return serial && seal && !duplicatePackingCodes.has(serial) && !duplicatePackingCodes.has(seal)
      })
      && Boolean(packingScanGroup.asset)
      && (
        !duplicatePackingCodes.has(String(packingScanGroup.asset.reject_cassette_serial || "").trim().toUpperCase())
        && Boolean(String(packingScanGroup.asset.reject_cassette_seal_no || "").trim())
        && !duplicatePackingCodes.has(String(packingScanGroup.asset.reject_cassette_seal_no || "").trim().toUpperCase())
        && !duplicatePackingCodes.has(String(packingScanGroup.asset.departure_bag_seal_no || "").trim().toUpperCase())
        && !duplicatePackingCodes.has(String(packingScanGroup.asset.return_bag_seal_no || "").trim().toUpperCase())
      )
  )

  const registeredPackingSeals = packingItems.filter((item) => String(item.seal_no || "").trim()).length
    + packingTidAssets.reduce((count, asset) => count
      + (String(asset.reject_cassette_seal_no || "").trim() ? 1 : 0)
      + (String(asset.departure_bag_seal_no || "").trim() ? 1 : 0)
      + (String(asset.return_bag_seal_no || "").trim() ? 1 : 0), 0)
  const expectedPackingSeals = Number(packingSummary.expected_cassettes || detailTotals.total_cassettes || 0)
    + Number(packingSummary.expected_reject_cassette_seals || packingGroups.length || 0)
    + Number(packingSummary.expected_bag_seals || 0)

  const custodyMember = useMemo(() =>
    (detail?.team || []).find((member) => String(member.member_role || "").toUpperCase() === "CUSTODY") || null,
  [detail])

  const localHandoverVerified = handoverItems.length > 0 && handoverItems.every((item) => {
    const expected = String(item.expected_seal_no || "").trim().toUpperCase()
    const scanned = String(item.scanned_seal_no || "").trim().toUpperCase()
    return expected && scanned && expected === scanned
  })

  const handoverVerifiedCount = handoverItems.filter((item) => {
    const expected = String(item.expected_seal_no || "").trim().toUpperCase()
    const scanned = String(item.scanned_seal_no || "").trim().toUpperCase()
    return expected && scanned && expected === scanned
  }).length

  function applyDetailResult(result) {
    const request = result?.data?.request || null
    setDetail(request)
    setDetailCapabilities(result?.data?.capabilities || {
      can_approve_packing: false,
      can_manage_packing_assignments: false,
      can_claim_packing_work_order: false,
      can_edit_packing: false,
      packing_owner_is_me: false,
      active_packing_work_order_id: null,
      active_packing_work_order_no: null,
    })
    setPackingOperators(result?.data?.packing_operators || [])
    if (Array.isArray(result?.data?.spare_cassettes)) {
      setSpareCassettes(result.data.spare_cassettes)
    }
    const packing = request?.cpc_packing?.items || []
    setPackingItems(packing.map((item) => ({
      ...item,
      spare_cassette_id: item.spare_cassette_id || "",
      cassette_serial: item.cassette_serial || "",
      seal_no: item.seal_no || "",
    })))
    setSpareScanDrafts(Object.fromEntries(
      packing.map((item) => [Number(item.id), String(item.cassette_serial || "").trim().toUpperCase()])
    ))
    setSpareScanErrors({})
    setSpareAutocompleteOpenItemId(null)
    const packingAssets = request?.cpc_packing?.tid_assets || []
    setPackingTidAssets(packingAssets.map((item) => ({
      ...item,
      reject_cassette_serial: item.reject_cassette_serial || "",
      reject_cassette_seal_no: item.reject_cassette_seal_no || "",
      departure_bag_seal_no: item.departure_bag_seal_no || "",
      return_bag_seal_no: item.return_bag_seal_no || "",
    })))
    setAssignmentSelections(Object.fromEntries(
      packingAssets.map((item) => [Number(item.work_order_point_id), item.assigned_to ? String(item.assigned_to) : ""])
    ))
    const persistedHandover = request?.cpc_handover?.items || []
    setHandoverItems((persistedHandover.length > 0 ? persistedHandover : packing.map((item) => ({
      packing_cassette_id: item.id,
      sequence_no: item.sequence_no,
      tid: item.tid,
      sn: item.sn,
      lokasi: item.lokasi,
      cassette_no: item.cassette_no,
      cassette_serial: item.cassette_serial,
      denomination_value: item.denomination_value,
      sheets_count: item.sheets_count,
      amount: item.amount,
      expected_seal_no: item.seal_no,
      scanned_seal_no: "",
    }))).map((item) => ({
      ...item,
      scanned_seal_no: item.scanned_seal_no || "",
    })))
    setHandoverNotes(request?.cpc_handover?.handover?.handover_notes || "")
    setCustodyNip("")
    setPackingDirty(false)
    setPackingDirtyPointIds([])
    setHandoverDirty(false)
  }

  function nextPage() {
    if (!pagination.has_more || !pagination.next_cursor) return
    const nextIndex = cursorIndex + 1
    setCursorStack((current) => {
      const copy = current.slice(0, nextIndex)
      copy[nextIndex] = pagination.next_cursor
      return copy
    })
    setCursorIndex(nextIndex)
  }

  function previousPage() {
    if (cursorIndex === 0) return
    setCursorIndex((value) => Math.max(0, value - 1))
  }

  async function openDetail(id) {
    setDetailOpen(true)
    setDetail(null)
    setDetailCapabilities({
      can_approve_packing: false,
      can_manage_packing_assignments: false,
      can_claim_packing_work_order: false,
      can_edit_packing: false,
      packing_owner_is_me: false,
      active_packing_work_order_id: null,
      active_packing_work_order_no: null,
    })
    setPackingOperators([])
    setPackingFilter("ALL")
    setPackingScanPointId("")
    setPackingItems([])
    setPackingTidAssets([])
    setSpareScanDrafts({})
    setSpareScanErrors({})
    setSpareAutocompleteOpenItemId(null)
    setHandoverItems([])
    setHandoverNotes("")
    setCustodyNip("")
    setActionNotes("")
    setDetailLoading(true)
    try {
      const result = await requestJson(`/api/transactions/cpc/${id}`)
      applyDetailResult(result)
    } catch (error) {
      showToast("error", error.message || "Gagal membuka detail permintaan CPC.")
      setDetailOpen(false)
    } finally {
      setDetailLoading(false)
    }
  }

  function closeDetail() {
    if (actionLoading) return
    setDetailOpen(false)
    setDetail(null)
    setDetailCapabilities({
      can_approve_packing: false,
      can_manage_packing_assignments: false,
      can_claim_packing_work_order: false,
      can_edit_packing: false,
      packing_owner_is_me: false,
      active_packing_work_order_id: null,
      active_packing_work_order_no: null,
    })
    setPackingOperators([])
    setPackingFilter("ALL")
    setPackingScanPointId("")
    setPackingItems([])
    setPackingTidAssets([])
    setSpareScanDrafts({})
    setSpareScanErrors({})
    setSpareAutocompleteOpenItemId(null)
    setHandoverItems([])
    setPackingDirty(false)
    setPackingDirtyPointIds([])
    setAssignmentLoadingPointId(null)
    setAssignmentSelections({})
    setHandoverDirty(false)
    setHandoverNotes("")
    setCustodyNip("")
    setActionNotes("")
  }

  async function processAction(target, actionOverride = null) {
    if (!target?.id || !canUpdate) return
    const action = actionOverride || cpcActionForStatus(target.status)
    if (!action) return

    const actionLabel = CPC_ACTION_LABELS[action] || "Proses"
    if (!window.confirm(`${actionLabel} untuk ${target.work_order_no}?`)) return

    const fromDetail = Number(detail?.id) === Number(target.id)
    if (fromDetail) setActionLoading(true)
    else setRowActionId(target.id)

    try {
      const result = await requestJson(`/api/transactions/cpc/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          notes: fromDetail
            ? (action === CPC_ACTIONS.COMPLETE_HANDOVER ? handoverNotes : actionNotes)
            : "",
          custody_nip: action === CPC_ACTIONS.COMPLETE_HANDOVER ? custodyNip : undefined,
        }),
      })

      showToast("success", result.message || `${target.work_order_no} berhasil diproses.`)
      if (fromDetail) {
        applyDetailResult(result)
        setActionNotes("")
      } else if (action === CPC_ACTIONS.RECEIVE_REQUEST) {
        setDetailOpen(true)
        setDetailLoading(false)
        applyDetailResult(result)
        setActionNotes("")
      }
      setRefreshKey((value) => value + 1)
    } catch (error) {
      showToast("error", error.message || "Gagal memproses permintaan CPC.")
      if (error.status === 409 && fromDetail) {
        try {
          const refreshed = await requestJson(`/api/transactions/cpc/${target.id}`)
          applyDetailResult(refreshed)
        } catch {
          // Detail akan diperbarui melalui refresh daftar.
        }
      }
    } finally {
      if (fromDetail) setActionLoading(false)
      else setRowActionId(null)
    }
  }

  function markPackingPointDirty(pointId) {
    const normalizedPointId = Number(pointId)
    if (!normalizedPointId) return
    setPackingDirty(true)
    setPackingDirtyPointIds((current) =>
      current.includes(normalizedPointId) ? current : [...current, normalizedPointId]
    )
  }

  function availableSpareCassettesForPackingItem(item) {
    const currentSpareId = Number(item?.spare_cassette_id || 0)
    const selectedByOtherItems = new Set(
      packingItems
        .filter((candidate) => Number(candidate.id) !== Number(item?.id))
        .map((candidate) => Number(candidate.spare_cassette_id || 0))
        .filter(Boolean)
    )

    return spareCassettes.filter((spare) => {
      const spareId = Number(spare.id)
      const denominationMatches = Number(spare.denomination_value) === Number(item?.denomination_value)
      const selectableStatus = spare.status === "READY" || spareId === currentSpareId
      return denominationMatches && selectableStatus && !selectedByOtherItems.has(spareId)
    })
  }

  function autocompleteSpareCassettesForPackingItem(item, rawQuery) {
    const query = normalizeSpareScanCode(rawQuery)
    return availableSpareCassettesForPackingItem(item).filter((spare) => {
      if (!query) return true
      return normalizeSpareScanCode(spare.cassette_serial).includes(query)
        || normalizeSpareScanCode(spare.rubber_seal_no).includes(query)
        || normalizeSpareScanCode(spare.prepared_by_name).includes(query)
    })
  }

  function assignPackingSpareCassette(index, selected) {
    const currentItem = packingItems[index]
    if (!currentItem) return false
    if (selected && Number(selected.denomination_value) !== Number(currentItem?.denomination_value)) {
      return false
    }

    const currentSpareId = Number(currentItem.spare_cassette_id || 0)
    const nextSpareId = Number(selected?.id || 0)
    if (currentSpareId === nextSpareId) return true

    const pointId = Number(currentItem?.work_order_point_id || 0)
    setPackingItems((current) => current.map((item, itemIndex) =>
      itemIndex === index
        ? {
            ...item,
            spare_cassette_id: selected?.id || "",
            cassette_serial: selected?.cassette_serial || "",
            seal_no: selected?.rubber_seal_no || "",
          }
        : item
    ))
    markPackingPointDirty(pointId)
    return true
  }

  function normalizeSpareScanCode(value) {
    return String(value || "").trim().toUpperCase().replaceAll(/\s+/g, "").slice(0, 100)
  }

  function spareMatchesScanCode(spare, scanCode) {
    return normalizeSpareScanCode(spare?.cassette_serial) === scanCode
      || normalizeSpareScanCode(spare?.rubber_seal_no) === scanCode
  }

  function setSpareScanError(itemId, message = "") {
    setSpareScanErrors((current) => ({ ...current, [Number(itemId)]: message }))
  }

  function commitPackingSpareScan(index, rawCode, { showError = true } = {}) {
    const currentItem = packingItems[index]
    if (!currentItem) return false

    const scanCode = normalizeSpareScanCode(rawCode)
    const currentSpare = spareCassettes.find((spare) =>
      Number(spare.id) === Number(currentItem.spare_cassette_id || 0)
    )
    const rejectScan = (message) => {
      if (currentSpare && !spareMatchesScanCode(currentSpare, scanCode)) {
        assignPackingSpareCassette(index, null)
      }
      if (showError) setSpareScanError(currentItem.id, message)
      return false
    }

    if (!scanCode) {
      return rejectScan("Scan label kaset atau nomor segel terlebih dahulu.")
    }

    const matches = spareCassettes.filter((spare) => spareMatchesScanCode(spare, scanCode))
    if (matches.length === 0) {
      return rejectScan("Label atau segel tidak ditemukan pada persediaan Spare Kaset.")
    }
    if (matches.length > 1) {
      return rejectScan("Kode scan cocok dengan lebih dari satu kaset. Periksa label dan segelnya.")
    }

    const selected = matches[0]
    if (Number(selected.denomination_value) !== Number(currentItem.denomination_value)) {
      return rejectScan(
        `Denom ${formatCurrency(selected.denomination_value)} tidak sesuai kebutuhan ${formatCurrency(currentItem.denomination_value)}.`
      )
    }

    const availableIds = new Set(availableSpareCassettesForPackingItem(currentItem).map((spare) => Number(spare.id)))
    if (!availableIds.has(Number(selected.id))) {
      const selectedElsewhere = packingItems.some((item) =>
        Number(item.id) !== Number(currentItem.id)
        && Number(item.spare_cassette_id || 0) === Number(selected.id)
      )
      return rejectScan(
        selectedElsewhere
          ? "Kaset ini sudah dipakai pada slot kaset lain di form."
          : "Kaset belum READY atau sedang dipakai Work Order lain."
      )
    }

    if (!normalizeSpareScanCode(selected.rubber_seal_no)) {
      return rejectScan("Kaset belum memiliki segel karet dan belum dapat dipakai.")
    }

    assignPackingSpareCassette(index, selected)
    setSpareScanDrafts((current) => ({ ...current, [Number(currentItem.id)]: scanCode }))
    setSpareScanError(currentItem.id)
    setSpareAutocompleteOpenItemId(null)
    return true
  }

  function selectPackingSpareFromAutocomplete(index, itemId, spare, scanKey = "") {
    if (!assignPackingSpareCassette(index, spare)) return
    setSpareScanDrafts((current) => ({
      ...current,
      [Number(itemId)]: normalizeSpareScanCode(spare.cassette_serial),
    }))
    setSpareScanError(itemId)
    setSpareAutocompleteOpenItemId(null)
    if (scanKey) window.setTimeout(() => focusNextPackingScan(scanKey), 0)
  }

  function schedulePackingSpareScan(index, itemId, rawCode, scanKey = "", input) {
    const scanCode = normalizeSpareScanCode(rawCode)
    if (!(input instanceof HTMLInputElement)) return
    clearPackingScanTimer(input)
    if (!scanCode) return

    const timerId = window.setTimeout(() => {
      packingScanTimers.delete(input)
      const active = document.activeElement
      if (active !== input) return
      if (active.dataset.spareScanItemId !== String(itemId)) return
      if (normalizeSpareScanCode(active.value) !== scanCode) return
      if (!spareCassettes.some((spare) => spareMatchesScanCode(spare, scanCode))) return
      if (commitPackingSpareScan(index, scanCode) && scanKey) focusNextPackingScan(scanKey)
    }, 220)
    packingScanTimers.set(input, timerId)
  }

  function handlePackingSpareScanChange(index, itemId, event, scanKey = "") {
    const input = event.currentTarget
    const rawCode = input.value
    const scanCode = normalizeSpareScanCode(rawCode)
    const currentItem = packingItems[index]
    const currentSpare = spareCassettes.find((spare) =>
      Number(spare.id) === Number(currentItem?.spare_cassette_id || 0)
    )
    setSpareScanDrafts((current) => ({ ...current, [Number(itemId)]: scanCode }))
    setSpareScanError(itemId)
    setSpareAutocompleteOpenItemId(Number(itemId))
    if (!scanCode && currentSpare) assignPackingSpareCassette(index, null)
    schedulePackingSpareScan(index, itemId, scanCode, scanKey, input)
  }

  function handlePackingSpareScanEnter(event, index, itemId, scanKey = "") {
    if (event.key === "Escape") {
      setSpareAutocompleteOpenItemId(null)
      return
    }
    if (event.key !== "Enter") return
    event.preventDefault()
    clearPackingScanTimer(event.currentTarget)
    const scanCode = normalizeSpareScanCode(event.currentTarget.value)
    const hasExactMatch = spareCassettes.some((spare) => spareMatchesScanCode(spare, scanCode))
    if (hasExactMatch) {
      if (commitPackingSpareScan(index, scanCode) && scanKey) focusNextPackingScan(scanKey)
      return
    }

    const currentItem = packingItems[index]
    const autocompleteMatches = autocompleteSpareCassettesForPackingItem(currentItem, scanCode)
    if (autocompleteMatches.length === 1) {
      selectPackingSpareFromAutocomplete(index, itemId, autocompleteMatches[0], scanKey)
    } else if (autocompleteMatches.length > 1) {
      setSpareScanError(itemId, "Pilih salah satu hasil autocomplete kaset yang tersedia.")
      setSpareAutocompleteOpenItemId(Number(itemId))
    } else if (commitPackingSpareScan(index, scanCode) && scanKey) {
      focusNextPackingScan(scanKey)
    }
  }

  function updatePackingTidAsset(assetId, field, value) {
    const normalized = String(value || "").toUpperCase().slice(0, 100)
    const target = packingTidAssets.find((item) => Number(item.id) === Number(assetId))
    setPackingTidAssets((current) => current.map((item) =>
      Number(item.id) === Number(assetId) ? { ...item, [field]: normalized } : item
    ))
    markPackingPointDirty(target?.work_order_point_id)
  }

  function focusNextPackingScan(currentKey) {
    const fields = Array.from(document.querySelectorAll('[data-cpc-quick-scan="true"]'))
      .filter((element) => element instanceof HTMLInputElement && !element.disabled)
    const index = fields.findIndex((element) => element.dataset.scanKey === currentKey)
    const next = index >= 0 ? fields[index + 1] : null
    if (next instanceof HTMLInputElement) {
      next.focus()
      next.select()
    }
  }

  function schedulePackingScanAdvance(scanKey, rawValue, input) {
    const normalizedValue = String(rawValue || "").trim().toUpperCase()
    if (!(input instanceof HTMLInputElement)) return
    clearPackingScanTimer(input)
    if (!normalizedValue) return

    // Barcode scanner keyboard-wedge mengirim karakter sangat cepat. Setelah tidak ada
    // input baru selama sesaat, anggap satu scan selesai dan pindahkan fokus otomatis.
    const timerId = window.setTimeout(() => {
      packingScanTimers.delete(input)
      const active = document.activeElement
      if (active !== input) return
      if (active.dataset.scanKey !== scanKey) return
      if (String(active.value || "").trim().toUpperCase() !== normalizedValue) return
      focusNextPackingScan(scanKey)
    }, 220)
    packingScanTimers.set(input, timerId)
  }

  function handlePackingAssetScanChange(assetId, field, event, scanKey) {
    const input = event.currentTarget
    const rawValue = input.value
    updatePackingTidAsset(assetId, field, rawValue)
    schedulePackingScanAdvance(scanKey, rawValue, input)
  }

  function handlePackingScanEnter(event, scanKey) {
    // Tetap mendukung scanner yang dikonfigurasi mengirim suffix Enter, tetapi operator
    // tidak perlu menekan Enter secara manual karena auto-advance berjalan via timer.
    if (event.key !== "Enter") return
    event.preventDefault()
    clearPackingScanTimer(event.currentTarget)
    focusNextPackingScan(scanKey)
  }

  async function refreshPackingDetail() {
    if (!detail?.id || packingDirty || assignmentLoadingPointId) return
    setDetailLoading(true)
    try {
      const result = await requestJson(`/api/transactions/cpc/${detail.id}`)
      applyDetailResult(result)
      showToast("success", "Status packing berhasil dimuat ulang.")
    } catch (error) {
      showToast("error", error.message || "Gagal memuat ulang packing.")
    } finally {
      setDetailLoading(false)
    }
  }

  async function processPackingAssignment(pointId, action, targetUserId = null) {
    if (!detail?.id || detail.status !== "KASET_DALAM_PERSIAPAN" || !canUpdate) return
    if (packingDirty) {
      showToast("error", "Simpan perubahan packing terlebih dahulu sebelum mengubah assignment TID.")
      return
    }

    const point = packingGroups.find((group) => Number(group.pointId) === Number(pointId))
    if (!point) return
    const actionText = action === CPC_PACKING_ASSIGNMENT_ACTIONS.CLAIM
      ? `Ambil seluruh job ${detail.work_order_no}? Semua TID akan dikunci ke akun Anda.`
      : action === CPC_PACKING_ASSIGNMENT_ACTIONS.RELEASE
        ? `Kembalikan seluruh job ${detail.work_order_no} ke antrean?`
        : `Alihkan seluruh job ${detail.work_order_no} ke petugas yang dipilih?`
    if (!window.confirm(actionText)) return

    setAssignmentLoadingPointId(Number(pointId))
    try {
      const result = await requestJson(`/api/transactions/cpc/${detail.id}/packing/assignment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          work_order_point_id: Number(pointId),
          target_user_id: targetUserId ? Number(targetUserId) : undefined,
        }),
      })
      applyDetailResult(result)
      showToast("success", result.message || "Assignment packing berhasil diperbarui.")
      setRefreshKey((value) => value + 1)
    } catch (error) {
      showToast("error", error.message || "Gagal memperbarui assignment packing.")
      if (error.status === 409) {
        try {
          const refreshed = await requestJson(`/api/transactions/cpc/${detail.id}`)
          applyDetailResult(refreshed)
        } catch {
          // Detail tetap menggunakan snapshot terakhir bila refresh gagal.
        }
      }
    } finally {
      setAssignmentLoadingPointId(null)
    }
  }

  async function savePacking({ quiet = false } = {}) {
    if (!detail?.id || detail.status !== "KASET_DALAM_PERSIAPAN" || !canUpdate) return null
    if (duplicatePackingCodes.size > 0) {
      showToast(
        "error",
        `Kode packing tidak boleh sama: ${[...duplicatePackingCodes].join(", ")}. Pastikan kaset uang, segel kaset, kaset reject, segel reject, Segel BAG Berangkat, dan Segel BAG Kembali menggunakan kode berbeda.`
      )
      return null
    }

    const dirtyPointSet = new Set(packingDirtyPointIds.map(Number).filter(Boolean))
    const operatorPointSet = new Set(operatorPackingGroups.map((group) => Number(group.pointId)).filter(Boolean))
    const validDirtyPointSet = new Set([...dirtyPointSet].filter((pointId) => operatorPointSet.has(pointId)))
    // Dalam mode exclusive Work Order, owner berhak menyimpan snapshot packing pada WO
    // yang dia pegang. Bila marker dirty per-TID tidak valid/stale, fallback aman adalah
    // snapshot seluruh WO milik owner karena user lain tidak dapat mengedit WO yang sama.
    const candidateGroups = packingOwnerIsMe
      ? operatorPackingGroups
      : operatorPackingGroups.filter((group) => validDirtyPointSet.has(Number(group.pointId)))
    const selectedGroups = validDirtyPointSet.size > 0
      ? candidateGroups.filter((group) => validDirtyPointSet.has(Number(group.pointId)))
      : candidateGroups
    const selectedAssets = selectedGroups.map((group) => group.asset || {
      id: null,
      work_order_point_id: group.pointId,
      reject_cassette_serial: "",
      reject_cassette_seal_no: "",
      departure_bag_seal_no: "",
      return_bag_seal_no: "",
    })
    const selectedPointIds = new Set(selectedGroups.map((group) => Number(group.pointId)).filter(Boolean))
    const selectedItems = packingItems.filter((item) => selectedPointIds.has(Number(item.work_order_point_id)))

    if (selectedGroups.length === 0) {
      showToast("error", "Tidak ada data packing pada Work Order aktif Anda untuk disimpan.")
      return null
    }

    setPackingSaving(true)
    try {
      const result = await requestJson(`/api/transactions/cpc/${detail.id}/packing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: actionNotes,
          items: selectedItems.map((item) => ({
            id: item.id,
            spare_cassette_id: item.spare_cassette_id || null,
            cassette_serial: item.cassette_serial,
            seal_no: item.seal_no,
          })),
          tid_assets: selectedAssets.map((item) => ({
            id: item.id,
            work_order_point_id: item.work_order_point_id,
            reject_cassette_serial: item.reject_cassette_serial,
            reject_cassette_seal_no: item.reject_cassette_seal_no,
            departure_bag_seal_no: item.departure_bag_seal_no,
            return_bag_seal_no: item.return_bag_seal_no,
          })),
        }),
      })
      applyDetailResult(result)
      setPackingScanPointId("")
      if (!quiet) showToast("success", result.message || "Packing kaset berhasil disimpan.")
      setRefreshKey((value) => value + 1)
      return result
    } catch (error) {
      showToast("error", error.message || "Gagal menyimpan packing kaset.")
      if ([403, 409].includes(error.status)) {
        try {
          const refreshed = await requestJson(`/api/transactions/cpc/${detail.id}`)
          applyDetailResult(refreshed)
        } catch {
          // Pertahankan pesan error utama bila refresh gagal.
        }
      }
      return null
    } finally {
      setPackingSaving(false)
    }
  }

  async function finishPackingAndSubmit() {
    if (!detail?.id || detail.status !== "KASET_DALAM_PERSIAPAN" || !canUpdate) return
    if (!detailCapabilities.can_edit_packing) {
      showToast("error", "Job packing ini bukan assignment aktif Anda.")
      return
    }
    if (duplicatePackingCodes.size > 0) {
      showToast("error", "Perbaiki kode kaset atau segel yang dipakai pada lebih dari satu field packing sebelum menyelesaikan job.")
      return
    }
    if (!localPackingComplete) {
      showToast("error", "Scan belum lengkap. Lengkapi seluruh pasangan kaset + segel kaset, Kaset Reject + Segel Kaset Reject, Segel BAG Berangkat, dan Segel BAG Kembali pada semua TID.")
      return
    }

    if (packingDirty) {
      const saved = await savePacking({ quiet: true })
      if (!saved) return
      if (!saved?.data?.request?.cpc_packing?.summary?.all_complete) {
        showToast("error", "Data scan sudah tersimpan, tetapi server masih mendeteksi packing belum lengkap. Muat ulang dan periksa TID yang belum lengkap.")
        return
      }
    } else if (!packingSummary.all_complete) {
      showToast("error", "Simpan hasil scan terlebih dahulu agar server memverifikasi packing lengkap.")
      return
    }

    await processAction(detail, CPC_ACTIONS.SUBMIT_APPROVAL)
  }

  function updateHandoverItem(index, value) {
    const normalized = String(value || "").toUpperCase().slice(0, 100)
    setHandoverItems((current) => current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, scanned_seal_no: normalized } : item
    ))
    setHandoverDirty(true)
  }

  function focusNextHandoverSeal(index) {
    const next = document.querySelector(`[data-cpc-handover-index="${index + 1}"]`)
    if (next instanceof HTMLInputElement) {
      next.focus()
      next.select()
    }
  }

  async function saveHandover() {
    if (!detail?.id || detail.status !== "KASET_SIAP" || !canUpdate) return
    const mismatch = handoverItems.find((item) => {
      const scanned = String(item.scanned_seal_no || "").trim().toUpperCase()
      const expected = String(item.expected_seal_no || "").trim().toUpperCase()
      return scanned && scanned !== expected
    })
    if (mismatch) {
      showToast("error", `Segel ${mismatch.scanned_seal_no} tidak sesuai dengan Kaset ${mismatch.cassette_no}.`)
      return
    }

    setHandoverSaving(true)
    try {
      const result = await requestJson(`/api/transactions/cpc/${detail.id}/handover`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: handoverNotes,
          items: handoverItems.map((item) => ({
            packing_cassette_id: item.packing_cassette_id,
            scanned_seal_no: item.scanned_seal_no,
          })),
        }),
      })
      applyDetailResult(result)
      showToast("success", result.message || "Verifikasi serah terima kaset berhasil disimpan.")
      setRefreshKey((value) => value + 1)
    } catch (error) {
      showToast("error", error.message || "Gagal menyimpan verifikasi serah terima kaset.")
    } finally {
      setHandoverSaving(false)
    }
  }

  function printBlotter() {
    if (!detail?.id || !["KASET_SIAP", "SIAP_BERANGKAT"].includes(detail.status)) return
    window.open(`/api/transactions/cpc/${detail.id}/blotter`, "_blank", "noopener,noreferrer")
  }

  return (
    <div className="simple-page replenish-page cpc-page">
      <section className="page-heading-card replenish-heading">
        <div>
          <p className="eyebrow">CPC Operations · Tahap 8</p>
          <h2>Permintaan Kaset &amp; Lembar Uang</h2>
          <p>
            Antrian ini mengambil Work Order Replenish yang sudah disetujui. Saat petugas CPC memilih
            Terima Permintaan, sistem langsung membentuk form packing per TID. Kaset uang tetap mengikuti kebutuhan Work Order
            dengan 2.000 lembar per kaset. Setiap TID juga menyiapkan satu kaset reject bernilai Rp0 beserta segel kaset reject, satu segel bag berangkat,
            dan satu segel bag kembali. Setelah seluruh komponen TID dan nomor seal lengkap, packing diajukan ke Asisten Manager CPC.
            Blotter baru dapat dicetak setelah approval. Setelah itu, segel kaset diverifikasi ulang saat kaset diserahkan kepada Custody yang ditugaskan.
          </p>
        </div>
        <div className="replenish-heading-actions">
          <button type="button" className="replenish-button secondary" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}>
            Muat Ulang
          </button>
        </div>
      </section>

      {!canUpdate ? (
        <div className="replenish-alert warning">
          Role Anda memiliki akses lihat ke menu CPC, tetapi belum memiliki permission Ubah. Tombol proses CPC dinonaktifkan.
        </div>
      ) : null}

      <section className="replenish-summary-grid cpc-summary-grid">
        <article><span>Permintaan Baru</span><strong>{summary.new_requests || 0}</strong></article>
        <article><span>Menunggu Validasi</span><strong>{summary.waiting_validation || 0}</strong></article>
        <article><span>Packing Kaset</span><strong>{summary.in_preparation || 0}</strong></article>
        <article><span>Menunggu Approval CPC</span><strong>{summary.waiting_approval || 0}</strong></article>
        <article><span>Kaset Siap</span><strong>{summary.ready || 0}</strong></article>
        <article><span>Diserahkan ke Custody</span><strong>{summary.handed_over || 0}</strong></article>
        <article>
          <span>Total Kebutuhan Aktif</span>
          <strong>{formatNumber(summary.total_cassettes)} kaset</strong>
          <small>{formatNumber(summary.total_sheets)} lembar · {formatCurrency(summary.total_requested_amount)}</small>
        </article>
      </section>

      <section className="panel replenish-filter-panel">
        <div className="replenish-filter-grid cpc-filter-grid">
          <label>
            <span>Cari WO / TID / SN / lokasi</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="RPL-, TID, SN, lokasi, atau unit kerja" />
          </label>
          <label>
            <span>Status CPC</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">Semua status CPC</option>
              {CPC_QUEUE_STATUSES.map((status) => <option key={status} value={status}>{cpcStatusLabel(status)}</option>)}
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
        </div>
        {!scope?.is_super_admin && scope?.codeuker ? (
          <p className="cpc-scope-note">Scope CPC: <strong>{scope.codeuker} · {scope.nama_uker}</strong></p>
        ) : scope?.is_super_admin ? (
          <p className="cpc-scope-note">Super Admin melihat seluruh unit kerja.</p>
        ) : null}
      </section>

      <section className="panel replenish-table-panel cpc-table-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">CPC Queue</p>
            <h3>Daftar permintaan kaset dan lembar uang</h3>
          </div>
          <span className="cpc-queue-count">{formatNumber(summary.total || 0)} permintaan aktif</span>
        </div>

        {loadError ? <div className="replenish-alert error">{loadError}</div> : null}
        {activePackingJob ? (
          <div className="replenish-alert warning">
            Anda sedang mengerjakan <strong>{activePackingJob.work_order_no}</strong>. Selesaikan packing dan ajukan ke Asisten Manager CPC sebelum mengambil Work Order lain.
          </div>
        ) : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Work Order</th>
                <th>Jadwal</th>
                <th>Unit Kerja</th>
                <th>Kebutuhan CPC</th>
                <th>Nominal</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7" className="replenish-empty">Memuat antrian CPC...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan="7" className="replenish-empty">Belum ada Work Order yang masuk tahapan permintaan kaset.</td></tr>
              ) : items.map((item) => {
                const action = item.status === "KASET_DALAM_PERSIAPAN" ? null : cpcActionForStatus(item.status)
                const busy = rowActionId === item.id
                const blockedByMyActivePackingJob = Boolean(
                  activePackingJob?.work_order_id
                  && Number(activePackingJob.work_order_id) !== Number(item.id)
                  && [CPC_ACTIONS.RECEIVE_REQUEST, CPC_ACTIONS.START_PREPARATION].includes(action)
                )
                return (
                  <tr key={item.id}>
                    <td>
                      <button type="button" className="replenish-link-button" onClick={() => void openDetail(item.id)}>
                        {item.work_order_no}
                      </button>
                      <small>{activityLabel(item.activity_type)} · {item.total_points} ATM/CRM</small>
                    </td>
                    <td>
                      <strong>{formatDate(item.schedule_date)}</strong>
                      <small>{item.departure_time}–{item.estimated_finish_time}</small>
                    </td>
                    <td>
                      <strong>{item.codeuker} · {item.nama_uker}</strong>
                      <small>Custody: {item.custody_name || "-"}</small>
                    </td>
                    <td>
                      <strong>{formatNumber(item.total_cassettes)} kaset</strong>
                      <small>{formatNumber(item.total_sheets)} lembar · {item.cash_points} point berisi uang</small>
                    </td>
                    <td>
                      <strong>{formatCurrency(item.total_requested_amount)}</strong>
                      <small>Disetujui {formatDateTime(item.approved_at)}</small>
                    </td>
                    <td>
                      <span className={`replenish-status ${statusClass(item.status)}`}>{cpcStatusLabel(item.status)}</span>
                    </td>
                    <td>
                      <div className="replenish-row-actions">
                        <button type="button" onClick={() => void openDetail(item.id)} disabled={busy}>Detail</button>
                        {action && canUpdate ? (
                          <button
                            type="button"
                            className="approve"
                            onClick={() => void processAction(item, action)}
                            disabled={busy || blockedByMyActivePackingJob}
                            title={blockedByMyActivePackingJob
                              ? `Selesaikan ${activePackingJob?.work_order_no || "job CPC aktif"} terlebih dahulu.`
                              : undefined}
                          >
                            {busy ? "Memproses..." : CPC_ACTION_LABELS[action]}
                          </button>
                        ) : null}
                        {!action && item.status === "KASET_DALAM_PERSIAPAN" ? (
                          <span className="cpc-packing-note">
                            {item.packing_owner_user_id && Number(item.packing_owner_user_id) !== currentUserId
                              ? `Dikerjakan ${item.packing_owner_name || "petugas CPC lain"}`
                              : item.packing_owner_user_id
                                ? "Job Anda · Buka packing"
                                : "Job belum diambil"}
                          </span>
                        ) : null}
                        {!action && item.status === "MENUNGGU_APPROVAL_CPC" ? <span className="cpc-approval-note">Menunggu approval</span> : null}
                        {!action && item.status === "KASET_SIAP" ? <span className="cpc-ready-note">Blotter &amp; serah terima</span> : null}
                        {!action && item.status === "SIAP_BERANGKAT" ? <span className="cpc-ready-note">Sudah ke Custody</span> : null}
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

      {detailOpen ? (
        <div className="replenish-modal-backdrop" role="presentation">
          <section className="replenish-modal detail cpc-detail-modal" role="dialog" aria-modal="true" aria-label="Detail permintaan kaset CPC">
            <header>
              <div>
                <p className="eyebrow">Permintaan CPC</p>
                <h3>{detail?.work_order_no || "Memuat detail..."}</h3>
              </div>
              <button type="button" onClick={closeDetail} disabled={actionLoading}>×</button>
            </header>

            <div className="replenish-detail-body">
              {detailCapabilities.active_packing_work_order_id
                && Number(detailCapabilities.active_packing_work_order_id) !== Number(detail?.id) ? (
                <div className="replenish-alert warning">
                  Anda masih mengerjakan <strong>{detailCapabilities.active_packing_work_order_no}</strong>. Work Order ini hanya dapat dilihat sampai job aktif tersebut selesai dan diajukan.
                </div>
              ) : null}
              {detailLoading ? (
                <p className="replenish-empty-card">Memuat detail kebutuhan kaset dan lembar uang...</p>
              ) : detail ? (
                <>
                  <section className="replenish-detail-section">
                    <div className="replenish-section-heading">
                      <div>
                        <h4>Ringkasan Permintaan</h4>
                        <p>Nilai berasal dari Work Order Replenish yang sudah disetujui dan tidak diedit dari menu CPC.</p>
                      </div>
                      <span className={`replenish-status ${statusClass(detail.status)}`}>{cpcStatusLabel(detail.status)}</span>
                    </div>
                    <div className="replenish-detail-grid cpc-detail-grid">
                      <article><span>Unit Kerja</span><strong>{detail.codeuker} · {detail.nama_uker}</strong></article>
                      <article><span>Jadwal</span><strong>{formatDate(detail.schedule_date)} · {detail.departure_time}</strong></article>
                      <article><span>Aktivitas</span><strong>{activityLabel(detail.activity_type)}</strong></article>
                      <article><span>Total Point</span><strong>{detail.total_points} ATM/CRM</strong></article>
                      <article><span>Total Kaset</span><strong>{formatNumber(detailTotals.total_cassettes)} kaset</strong></article>
                      <article><span>Total Lembar</span><strong>{formatNumber(detailTotals.total_sheets)} lembar</strong></article>
                      <article><span>Total Nominal</span><strong>{formatCurrency(detailTotals.total_requested_amount)}</strong></article>
                      <article><span>Disetujui Oleh</span><strong>{detail.approved_by_name || "-"}</strong></article>
                      <article><span>Waktu Approval</span><strong>{formatDateTime(detail.approved_at)}</strong></article>
                    </div>
                  </section>

                  {["KASET_DALAM_PERSIAPAN", "MENUNGGU_APPROVAL_CPC", "KASET_SIAP", "SIAP_BERANGKAT"].includes(detail.status) ? (
                    <section className="replenish-detail-section cpc-packing-section">
                      <div className="replenish-section-heading">
                        <div>
                          <h4>Packing Kaset &amp; Scan Segel per TID</h4>
                          <p>Setiap TID menyiapkan kaset uang sesuai Work Order, 1 kaset reject bernilai Rp0 beserta segel kaset reject, 1 segel BAG berangkat, dan 1 segel BAG kembali. Setiap kaset berisi tepat {formatNumber(CPC_PACKING_SHEETS_PER_CASSETTE)} lembar untuk kaset uang existing.</p>
                        </div>
                        <div className="cpc-packing-progress">
                          <strong>{formatNumber(packingSummary.completed_tids || 0)}/{formatNumber(packingSummary.expected_tids || packingGroups.length)} TID lengkap</strong>
                          <small>{formatNumber(registeredPackingSeals)} dari {formatNumber(expectedPackingSeals)} segel terdaftar</small>
                        </div>
                      </div>

                      {detail.status === "KASET_DALAM_PERSIAPAN" ? (
                        packingOwnerUserId ? (
                          <div className={`replenish-alert ${packingOwnedByOther ? "warning" : "success"}`}>
                            {packingOwnedByOther
                              ? <>Job packing <strong>{detail.work_order_no}</strong> sedang dikerjakan <strong>{packingOwnerName || "petugas CPC lain"}</strong>. Anda hanya dapat melihat; pilih Work Order lain untuk melakukan scan packing.</>
                              : <>Job packing <strong>{detail.work_order_no}</strong> terkunci ke akun Anda. Seluruh TID pada Work Order ini hanya dapat dipacking oleh Anda sampai job dialihkan supervisor atau diajukan approval.</>}
                          </div>
                        ) : (
                          <div className="replenish-alert warning">
                            Job packing belum memiliki operator. Petugas CPC pertama yang mengambil job akan mengunci seluruh TID pada Work Order ini.
                          </div>
                        )
                      ) : null}

                      {detail.status === "KASET_DALAM_PERSIAPAN"
                        && canUpdate
                        && !packingOwnerUserId
                        && detailCapabilities.can_claim_packing_work_order
                        && packingGroups.length > 0 ? (
                        <div className="cpc-quick-scan-entry">
                          <div>
                            <strong>Add Spare Kaset belum dimulai</strong>
                            <p>Ambil Work Order ini terlebih dahulu. Setelah job terkunci, scan label atau segel spare kaset READY dengan denom sesuai kebutuhan TID.</p>
                          </div>
                          <button
                            type="button"
                            className="replenish-button approve"
                            onClick={() => void processPackingAssignment(packingGroups[0].pointId, CPC_PACKING_ASSIGNMENT_ACTIONS.CLAIM)}
                            disabled={Boolean(assignmentLoadingPointId) || packingSaving || actionLoading}
                          >
                            {assignmentLoadingPointId ? "Mengambil Job..." : "Mulai Add Spare Kaset"}
                          </button>
                        </div>
                      ) : null}

                      {detail.status === "KASET_DALAM_PERSIAPAN" && canUpdate && detailCapabilities.can_edit_packing && operatorPackingGroups.length > 0 ? (
                        <div className="cpc-quick-scan-panel">
                          <div className="cpc-quick-scan-header">
                            <div>
                              <span className="cpc-quick-scan-eyebrow">FORM SCAN PACKING CPC</span>
                              <h5>Scan Spare Kaset Sesuai Denom</h5>
                              <p>Klik kolom untuk memilih lewat autocomplete atau scan label/nomor segel kaset berstatus READY. Sistem mencocokkan denom, lalu membaca serial, 2.000 lembar, segel karet, dan petugas persiapan secara otomatis.</p>
                            </div>
                            <div className={`cpc-quick-scan-progress ${packingScanGroupComplete ? "complete" : "pending"}`}>
                              <strong>{formatNumber(packingScanCompletedFields)}/{formatNumber(packingScanRequiredFields)}</strong>
                              <small>{packingScanGroupComplete ? "TID siap disimpan" : "scan terisi"}</small>
                            </div>
                          </div>

                          <div className="cpc-quick-scan-toolbar">
                            <label>
                              <span>Pilih TID yang discan</span>
                              <select
                                value={packingScanGroup ? String(packingScanGroup.pointId) : ""}
                                onChange={(event) => setPackingScanPointId(event.target.value)}
                                disabled={packingSaving || actionLoading || pendingPackingScanGroups.length === 0}
                              >
                                {pendingPackingScanGroups.length === 0 ? (
                                  <option value="">Semua TID sudah selesai disimpan</option>
                                ) : (
                                  pendingPackingScanGroups.map((group) => {
                                    const identity = group.asset || group.items[0] || {}
                                    return (
                                      <option key={group.pointId} value={group.pointId}>
                                        {identity.tid || identity.sn || `Point ${group.pointId}`} · {identity.lokasi || "Lokasi tidak tersedia"}
                                      </option>
                                    )
                                  })
                                )}
                              </select>
                            </label>
                            <div className="cpc-quick-scan-status">
                              <span>Work Order</span>
                              <strong>{detail.work_order_no}</strong>
                              <small>Terkunci ke {packingOwnerName || user?.fullName || user?.username || "akun Anda"}</small>
                            </div>
                          </div>

                          {packingScanGroup ? (
                            <div className="cpc-quick-scan-form">
                              <div className="cpc-quick-scan-section-title">
                                <strong>Spare Kaset Uang</strong>
                                <small>Scan langsung atau ketik untuk mencari kaset READY sesuai denom mesin</small>
                              </div>

                              <div className="cpc-quick-scan-cassettes">
                                {packingScanGroup.items.map((item, scanIndex) => {
                                  const itemIndex = packingItems.findIndex((candidate) => Number(candidate.id) === Number(item.id))
                                  const serialValue = String(item.cassette_serial || "").trim().toUpperCase()
                                  const sealValue = String(item.seal_no || "").trim().toUpperCase()
                                  const duplicateSerial = Boolean(serialValue && duplicatePackingCodes.has(serialValue))
                                  const duplicateSeal = Boolean(sealValue && duplicatePackingCodes.has(sealValue))
                                  const previousComplete = packingScanGroup.items.slice(0, scanIndex).every((previous) =>
                                    String(previous.cassette_serial || "").trim() && String(previous.seal_no || "").trim()
                                  )
                                  const selectedSpare = spareCassettes.find((spare) => Number(spare.id) === Number(item.spare_cassette_id))
                                  const complete = serialValue && sealValue && !duplicateSerial && !duplicateSeal
                                  const spareScanKey = `spare-${item.id}`
                                  const autocompleteSpares = autocompleteSpareCassettesForPackingItem(
                                    item,
                                    spareScanDrafts[Number(item.id)] || ""
                                  )
                                  const autocompleteOpen = spareAutocompleteOpenItemId === Number(item.id)
                                  const autocompleteListId = `spare-autocomplete-${item.id}`
                                  return (
                                    <article key={item.id} className={`cpc-quick-scan-cassette ${complete ? "complete" : "pending"}`}>
                                      <div className="cpc-quick-scan-cassette-title">
                                        <div>
                                          <span>Kaset Uang {item.cassette_no}</span>
                                          <strong>{formatCurrency(item.denomination_value)} · {formatNumber(item.sheets_count)} lembar</strong>
                                        </div>
                                        <span className={`cpc-pack-state ${complete ? "complete" : "pending"}`}>{complete ? "Lengkap" : "Belum lengkap"}</span>
                                      </div>
                                      <div className="cpc-quick-spare-fields">
                                        <div className="cpc-spare-autocomplete">
                                          <label>
                                            <span>Scan / cari kaset denom {formatCurrency(item.denomination_value)}</span>
                                            <input
                                              className={`cpc-packing-input cpc-spare-scan cpc-scan-primary ${spareScanErrors[Number(item.id)] ? "error" : ""}`}
                                              role="combobox"
                                              aria-autocomplete="list"
                                              aria-expanded={autocompleteOpen}
                                              aria-controls={autocompleteListId}
                                              data-cpc-quick-scan="true"
                                              data-scan-key={spareScanKey}
                                              data-spare-scan-item-id={item.id}
                                              value={spareScanDrafts[Number(item.id)] || ""}
                                              onFocus={(event) => {
                                                setSpareAutocompleteOpenItemId(Number(item.id))
                                                event.currentTarget.select()
                                              }}
                                              onChange={(event) => handlePackingSpareScanChange(itemIndex, item.id, event, spareScanKey)}
                                              onKeyDown={(event) => handlePackingSpareScanEnter(event, itemIndex, item.id, spareScanKey)}
                                              onBlur={(event) => {
                                                setSpareAutocompleteOpenItemId((current) => current === Number(item.id) ? null : current)
                                                if (event.currentTarget.value) commitPackingSpareScan(itemIndex, event.currentTarget.value)
                                              }}
                                              placeholder="SCAN / KETIK LABEL ATAU SEGEL"
                                              disabled={packingSaving || actionLoading || !previousComplete}
                                              autoComplete="off"
                                              inputMode="text"
                                            />
                                            {spareScanErrors[Number(item.id)] ? (
                                              <small className="cpc-field-error">{spareScanErrors[Number(item.id)]}</small>
                                            ) : null}
                                          </label>
                                          {autocompleteOpen ? (
                                            <div
                                              id={autocompleteListId}
                                              className="cpc-spare-autocomplete-menu"
                                              role="listbox"
                                              aria-label={`Pilihan spare kaset denom ${formatCurrency(item.denomination_value)}`}
                                            >
                                              <div className="cpc-spare-autocomplete-heading">
                                                <div>
                                                  <strong>Pilihan Spare Kaset</strong>
                                                  <small>Ketik label, segel, atau nama petugas</small>
                                                </div>
                                                <span>{formatNumber(autocompleteSpares.length)} kaset</span>
                                              </div>
                                              {autocompleteSpares.length > 0 ? autocompleteSpares.map((spare) => {
                                                const isSelected = Number(spare.id) === Number(item.spare_cassette_id)
                                                return (
                                                  <button
                                                    key={spare.id}
                                                    type="button"
                                                    role="option"
                                                    aria-selected={isSelected}
                                                    className={isSelected ? "selected" : ""}
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    onClick={() => selectPackingSpareFromAutocomplete(itemIndex, item.id, spare, spareScanKey)}
                                                  >
                                                    <div>
                                                      <strong>{spare.cassette_serial}</strong>
                                                      <span>{isSelected ? "Terpilih" : "READY"}</span>
                                                    </div>
                                                    <code>Segel {spare.rubber_seal_no}</code>
                                                    <small>
                                                      {formatNumber(spare.sheets_count)} lembar · disiapkan {spare.prepared_by_name || "Petugas CPC"}
                                                    </small>
                                                  </button>
                                                )
                                              }) : (
                                                <p>Tidak ada Spare Kaset READY yang cocok dan sesuai denom mesin.</p>
                                              )}
                                            </div>
                                          ) : null}
                                        </div>
                                        <div className="cpc-selected-spare-meta">
                                          <span>Kaset terpilih</span>
                                          <strong>{selectedSpare?.cassette_serial || item.cassette_serial || "Belum dipilih"}</strong>
                                          <small>
                                            {selectedSpare
                                              ? `Segel ${selectedSpare.rubber_seal_no} · ${formatNumber(selectedSpare.sheets_count)} lembar · disiapkan ${selectedSpare.prepared_by_name || "Petugas CPC"}`
                                              : "Serial dan segel diambil dari persediaan spare kaset."}
                                          </small>
                                        </div>
                                      </div>
                                    </article>
                                  )
                                })}
                              </div>

                              {packingScanGroup.asset ? (() => {
                                const asset = packingScanGroup.asset
                                const rejectSerial = String(asset.reject_cassette_serial || "").trim().toUpperCase()
                                const rejectSeal = String(asset.reject_cassette_seal_no || "").trim().toUpperCase()
                                const departureSeal = String(asset.departure_bag_seal_no || "").trim().toUpperCase()
                                const returnSeal = String(asset.return_bag_seal_no || "").trim().toUpperCase()
                                const cashSequenceComplete = packingScanGroup.items.every((cashItem) =>
                                  String(cashItem.cassette_serial || "").trim() && String(cashItem.seal_no || "").trim()
                                )
                                const rejectKey = `asset-${asset.id}-reject`
                                const rejectSealKey = `asset-${asset.id}-reject-seal`
                                const departureKey = `asset-${asset.id}-departure`
                                const returnKey = `asset-${asset.id}-return`
                                return (
                                  <>
                                    <div className="cpc-quick-scan-section-title secondary">
                                      <strong>Kaset Reject &amp; Segel BAG</strong>
                                      <small>Setelah seluruh kaset uang selesai: Kaset Reject → Segel Kaset Reject → Segel BAG Berangkat → Segel BAG Kembali. Tidak perlu menekan Enter.</small>
                                    </div>
                                    <div className="cpc-quick-scan-assets">
                                      <label>
                                        <span>Scan Kaset Reject</span>
                                        <input
                                          className={`cpc-packing-input cpc-scan-primary ${duplicatePackingCodes.has(rejectSerial) ? "error" : ""}`}
                                          data-cpc-quick-scan="true"
                                          data-scan-key={rejectKey}
                                          value={asset.reject_cassette_serial || ""}
                                          onChange={(event) => handlePackingAssetScanChange(asset.id, "reject_cassette_serial", event, rejectKey)}
                                          onKeyDown={(event) => handlePackingScanEnter(event, rejectKey)}
                                          placeholder="SCAN KASET REJECT"
                                          disabled={packingSaving || actionLoading || !cashSequenceComplete}
                                          autoComplete="off"
                                          inputMode="text"
                                        />
                                        {duplicatePackingCodes.has(rejectSerial) ? <small className="cpc-field-error">Kode kaset reject sudah digunakan pada field packing lain</small> : null}
                                      </label>
                                      <label>
                                        <span>Scan Segel Kaset Reject</span>
                                        <input
                                          className={`cpc-packing-input cpc-seal-input cpc-scan-primary ${duplicatePackingCodes.has(rejectSeal) ? "error" : ""}`}
                                          data-cpc-quick-scan="true"
                                          data-scan-key={rejectSealKey}
                                          value={asset.reject_cassette_seal_no || ""}
                                          onChange={(event) => handlePackingAssetScanChange(asset.id, "reject_cassette_seal_no", event, rejectSealKey)}
                                          onKeyDown={(event) => handlePackingScanEnter(event, rejectSealKey)}
                                          placeholder="SCAN SEGEL KASET REJECT"
                                          disabled={packingSaving || actionLoading || !rejectSerial}
                                          autoComplete="off"
                                          inputMode="text"
                                        />
                                        {duplicatePackingCodes.has(rejectSeal) ? <small className="cpc-field-error">Kode segel reject sudah digunakan pada field packing lain</small> : null}
                                      </label>
                                      <label>
                                        <span>Scan Segel BAG Berangkat</span>
                                        <input
                                          className={`cpc-packing-input cpc-seal-input cpc-scan-primary ${duplicatePackingCodes.has(departureSeal) ? "error" : ""}`}
                                          data-cpc-quick-scan="true"
                                          data-scan-key={departureKey}
                                          value={asset.departure_bag_seal_no || ""}
                                          onChange={(event) => handlePackingAssetScanChange(asset.id, "departure_bag_seal_no", event, departureKey)}
                                          onKeyDown={(event) => handlePackingScanEnter(event, departureKey)}
                                          placeholder="SCAN SEGEL BAG BERANGKAT"
                                          disabled={packingSaving || actionLoading || !rejectSerial || !rejectSeal}
                                          autoComplete="off"
                                          inputMode="text"
                                        />
                                        {duplicatePackingCodes.has(departureSeal) ? <small className="cpc-field-error">Kode Segel BAG Berangkat sudah digunakan pada field packing lain</small> : null}
                                      </label>
                                      <label>
                                        <span>Scan Segel BAG Kembali</span>
                                        <input
                                          className={`cpc-packing-input cpc-seal-input cpc-scan-primary ${duplicatePackingCodes.has(returnSeal) ? "error" : ""}`}
                                          data-cpc-quick-scan="true"
                                          data-scan-key={returnKey}
                                          value={asset.return_bag_seal_no || ""}
                                          onChange={(event) => handlePackingAssetScanChange(asset.id, "return_bag_seal_no", event, returnKey)}
                                          onKeyDown={(event) => handlePackingScanEnter(event, returnKey)}
                                          placeholder="SCAN SEGEL BAG KEMBALI"
                                          disabled={packingSaving || actionLoading || !departureSeal}
                                          autoComplete="off"
                                          inputMode="text"
                                        />
                                        {duplicatePackingCodes.has(returnSeal) ? <small className="cpc-field-error">Kode Segel BAG Kembali sudah digunakan pada field packing lain</small> : null}
                                      </label>
                                    </div>
                                  </>
                                )
                              })() : null}

                              <div className="cpc-quick-scan-actions">
                                <div>
                                  <strong>{packingScanGroupComplete ? "TID ini lengkap" : "Lanjutkan scan sampai semua field lengkap"}</strong>
                                  <small>Data baru dianggap final setelah disimpan ke server.</small>
                                </div>
                                <button
                                  type="button"
                                  className="replenish-button secondary"
                                  onClick={() => void savePacking()}
                                  disabled={packingSaving || actionLoading || !packingDirty || duplicatePackingCodes.size > 0}
                                >
                                  {packingSaving ? "Menyimpan..." : "Simpan Hasil Scan"}
                                </button>
                                <button
                                  type="button"
                                  className="replenish-button primary"
                                  onClick={() => void finishPackingAndSubmit()}
                                  disabled={packingSaving || actionLoading || !localPackingComplete || duplicatePackingCodes.size > 0}
                                  title={!localPackingComplete ? "Lengkapi scan seluruh TID terlebih dahulu." : "Simpan scan yang belum tersimpan lalu ajukan job ke Asisten Manager CPC."}
                                >
                                  {actionLoading ? "Mengajukan..." : "Selesaikan Packing & Ajukan"}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="replenish-empty-card">
                              {pendingPackingScanGroups.length === 0
                                ? "Semua TID sudah lengkap dan tersimpan. Lanjutkan pengajuan ke Asisten Manager CPC."
                                : "Tidak ada TID assignment Anda untuk discan."}
                            </p>
                          )}
                        </div>
                      ) : null}

                      <div className="cpc-packing-scan-summary">
                        <article>
                          <span>TID Harus Dipacking</span>
                          <strong>{formatNumber(packingSummary.expected_tids || packingGroups.length)} TID</strong>
                          <small>Setiap TID memiliki satu paket packing</small>
                        </article>
                        <article>
                          <span>Kaset Harus Disiapkan</span>
                          <strong>{formatNumber((packingSummary.expected_cassettes || detailTotals.total_cassettes) + (packingSummary.expected_reject_cassettes || 0))} kaset</strong>
                          <small>Kaset uang + 1 kaset reject Rp0 per TID</small>
                        </article>
                        <article>
                          <span>Seal Harus Discan</span>
                          <strong>{formatNumber(expectedPackingSeals)} seal</strong>
                          <small>Segel kaset uang + segel kaset reject + BAG berangkat + BAG kembali</small>
                        </article>
                        <article>
                          <span>Sisa Scan Seal</span>
                          <strong>{formatNumber(Math.max(0, expectedPackingSeals - registeredPackingSeals))} seal</strong>
                          <small>Harus 0 sebelum diajukan approval</small>
                        </article>
                      </div>

                      {detail.cpc_packing?.batch?.status === "DITOLAK" ? (
                        <div className="replenish-alert warning cpc-packing-rejected">
                          Packing dikembalikan oleh <strong>{detail.cpc_packing.batch.rejected_by_name || "Asisten Manager CPC"}</strong>.
                          {detail.cpc_packing.batch.approval_notes ? ` Catatan: ${detail.cpc_packing.batch.approval_notes}` : ""}
                        </div>
                      ) : null}

                      {packingGroups.length > 0 ? (
                        <div className="cpc-assignment-toolbar">
                          <div className="cpc-assignment-filters" role="group" aria-label="Filter assignment packing">
                            <button type="button" className={packingFilter === "ALL" ? "active" : ""} onClick={() => setPackingFilter("ALL")}>
                              Semua TID <strong>{packingGroups.length}</strong>
                            </button>
                            <button type="button" className={packingFilter === "MINE" ? "active" : ""} onClick={() => setPackingFilter("MINE")}>
                              Packing Saya <strong>{myPackingGroups.length}</strong>
                            </button>
                            <button type="button" className={packingFilter === "UNASSIGNED" ? "active" : ""} onClick={() => setPackingFilter("UNASSIGNED")}>
                              Belum Diambil <strong>{unassignedPackingGroups.length}</strong>
                            </button>
                          </div>
                          <button
                            type="button"
                            className="replenish-button secondary cpc-refresh-packing"
                            onClick={() => void refreshPackingDetail()}
                            disabled={detailLoading || packingDirty || Boolean(assignmentLoadingPointId)}
                            title={packingDirty ? "Simpan perubahan packing sebelum memuat ulang." : "Muat status assignment terbaru dari server."}
                          >
                            Muat Ulang
                          </button>
                        </div>
                      ) : null}

                      {packingGroups.length === 0 ? (
                        <p className="replenish-empty-card">Slot packing belum tersedia. Terima Permintaan akan membentuk packing otomatis per TID sesuai kebutuhan Work Order.</p>
                      ) : (
                        <div className="cpc-tid-packing-list">
                          {visiblePackingGroups.length === 0 ? (
                            <p className="replenish-empty-card">Tidak ada TID pada filter ini.</p>
                          ) : visiblePackingGroups.map((group) => {
                            const asset = group.asset
                            const identity = asset || group.items[0] || {}
                            const assignedToMe = Number(asset?.assigned_to || 0) === currentUserId
                            const unassigned = !Number(asset?.assigned_to || 0)
                            const assignmentBusy = Number(assignmentLoadingPointId) === Number(group.pointId)
                            const canClaim = detail.status === "KASET_DALAM_PERSIAPAN"
                              && canUpdate
                              && detailCapabilities.can_claim_packing_work_order
                              && !packingOwnerUserId
                              && unassigned
                            const editable = detail.status === "KASET_DALAM_PERSIAPAN"
                              && canUpdate
                              && detailCapabilities.can_edit_packing
                              && (packingOwnerIsMe || assignedToMe)
                            const selectedOperatorId = assignmentSelections[group.pointId] || ""
                            const cashComplete = group.items.every((item) => {
                              const serial = String(item.cassette_serial || "").trim().toUpperCase()
                              const seal = String(item.seal_no || "").trim().toUpperCase()
                              return serial && seal && !duplicatePackingCodes.has(serial) && !duplicatePackingCodes.has(seal)
                            })
                            const rejectSerial = String(asset?.reject_cassette_serial || "").trim().toUpperCase()
                            const rejectSeal = String(asset?.reject_cassette_seal_no || "").trim().toUpperCase()
                            const departureSeal = String(asset?.departure_bag_seal_no || "").trim().toUpperCase()
                            const returnSeal = String(asset?.return_bag_seal_no || "").trim().toUpperCase()
                            const assetComplete = Boolean(asset
                              && rejectSerial
                              && rejectSeal
                              && departureSeal
                              && returnSeal
                              && !duplicatePackingCodes.has(rejectSerial)
                              && !duplicatePackingCodes.has(rejectSeal)
                              && !duplicatePackingCodes.has(departureSeal)
                              && !duplicatePackingCodes.has(returnSeal)
                            )
                            const groupComplete = cashComplete && assetComplete

                            return (
                              <article key={group.pointId} className={`cpc-tid-packing-card ${groupComplete ? "complete" : "pending"}`}>
                                <div className="cpc-tid-packing-heading">
                                  <div>
                                    <span>TID</span>
                                    <strong>{identity.tid || identity.sn || `Point ${group.pointId}`}</strong>
                                    <small>{identity.lokasi || "-"} · SN {identity.sn || "-"}</small>
                                  </div>
                                  <span className={`cpc-pack-state ${groupComplete ? "complete" : "pending"}`}>
                                    {groupComplete ? "TID Lengkap" : "Belum lengkap"}
                                  </span>
                                </div>

                                {asset ? (
                                  <div className="cpc-tid-assignment">
                                    <div className="cpc-tid-assignment-owner">
                                      <span>Petugas Packing</span>
                                      <strong>{asset.assigned_to_name || "Belum diambil"}</strong>
                                      <small>
                                        {packingAssignmentLabel(asset.assignment_status)}
                                        {asset.assigned_at ? ` · ditugaskan ${formatDateTime(asset.assigned_at)}` : ""}
                                      </small>
                                      {asset.started_by_name ? (
                                        <small>Mulai oleh <strong>{asset.started_by_name}</strong> · {formatDateTime(asset.started_at)}</small>
                                      ) : null}
                                      {asset.completed_by_name ? (
                                        <small>Selesai oleh <strong>{asset.completed_by_name}</strong> · {formatDateTime(asset.completed_at)}</small>
                                      ) : null}
                                    </div>

                                    <div className="cpc-tid-assignment-actions">
                                      {canClaim ? (
                                        <button
                                          type="button"
                                          className="replenish-button primary compact"
                                          onClick={() => void processPackingAssignment(group.pointId, CPC_PACKING_ASSIGNMENT_ACTIONS.CLAIM)}
                                          disabled={assignmentBusy || packingDirty}
                                        >
                                          {assignmentBusy ? "Mengambil..." : "Ambil Job"}
                                        </button>
                                      ) : null}

                                      {detail.status === "KASET_DALAM_PERSIAPAN" && assignedToMe && asset.assignment_status === "ASSIGNED" ? (
                                        <button
                                          type="button"
                                          className="replenish-button secondary compact"
                                          onClick={() => void processPackingAssignment(group.pointId, CPC_PACKING_ASSIGNMENT_ACTIONS.RELEASE)}
                                          disabled={assignmentBusy || packingDirty}
                                        >
                                          Kembalikan Job
                                        </button>
                                      ) : null}

                                      {detail.status === "KASET_DALAM_PERSIAPAN" && detailCapabilities.can_manage_packing_assignments ? (
                                        <div className="cpc-supervisor-assignment">
                                          <select
                                            value={selectedOperatorId}
                                            onChange={(event) => setAssignmentSelections((current) => ({
                                              ...current,
                                              [group.pointId]: event.target.value,
                                            }))}
                                            disabled={assignmentBusy || packingDirty || packingOperators.length === 0}
                                            aria-label={`Petugas packing ${identity.tid || group.pointId}`}
                                          >
                                            <option value="">Pilih petugas</option>
                                            {packingOperators.map((operator) => (
                                              <option key={operator.id} value={operator.id}>
                                                {operator.full_name} ({operator.username})
                                              </option>
                                            ))}
                                          </select>
                                          <button
                                            type="button"
                                            className="replenish-button secondary compact"
                                            onClick={() => void processPackingAssignment(
                                              group.pointId,
                                              CPC_PACKING_ASSIGNMENT_ACTIONS.ASSIGN,
                                              selectedOperatorId
                                            )}
                                            disabled={assignmentBusy || packingDirty || !selectedOperatorId}
                                          >
                                            {packingOwnerUserId ? "Alihkan Job" : "Assign Job"}
                                          </button>
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : null}

                                <div className="table-wrap cpc-packing-table-wrap cpc-tid-cassette-table-wrap">
                                  <table className="cpc-packing-table cpc-tid-cassette-table">
                                    <thead>
                                      <tr>
                                        <th>Kaset</th>
                                        <th>Denom</th>
                                        <th>Lembar</th>
                                        <th>Nominal</th>
                                        <th>Add Spare Kaset</th>
                                        <th>Segel Karet</th>
                                        <th>Status</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {group.items.map((item, itemPosition) => {
                                        const itemIndex = packingItems.findIndex((candidate) => Number(candidate.id) === Number(item.id))
                                        const sealValue = String(item.seal_no || "").trim().toUpperCase()
                                        const serialValue = String(item.cassette_serial || "").trim().toUpperCase()
                                        const duplicateSeal = sealValue && duplicatePackingCodes.has(sealValue)
                                        const duplicateSerial = serialValue && duplicatePackingCodes.has(serialValue)
                                        const availableSpares = availableSpareCassettesForPackingItem(item)
                                        const previousPairComplete = group.items.slice(0, itemPosition).every((previous) =>
                                          String(previous.cassette_serial || "").trim() && String(previous.seal_no || "").trim()
                                        )
                                        const complete = Boolean(serialValue && sealValue) && !duplicateSeal && !duplicateSerial
                                        return (
                                          <tr key={item.id} className={duplicateSeal || duplicateSerial ? "cpc-packing-row-error" : ""}>
                                            <td><strong>Kaset Uang {item.cassette_no}</strong></td>
                                            <td>{formatCurrency(item.denomination_value)}</td>
                                            <td><strong>{formatNumber(item.sheets_count)}</strong></td>
                                            <td>{formatCurrency(item.amount)}</td>
                                            <td>
                                              {editable ? (
                                                <>
                                                  <input
                                                    className={`cpc-packing-input cpc-spare-scan ${duplicateSerial || spareScanErrors[Number(item.id)] ? "error" : ""}`}
                                                    data-spare-scan-item-id={item.id}
                                                    value={spareScanDrafts[Number(item.id)] || ""}
                                                    onChange={(event) => handlePackingSpareScanChange(itemIndex, item.id, event)}
                                                    onKeyDown={(event) => handlePackingSpareScanEnter(event, itemIndex, item.id)}
                                                    onBlur={(event) => {
                                                      if (event.currentTarget.value) commitPackingSpareScan(itemIndex, event.currentTarget.value)
                                                    }}
                                                    placeholder="Scan label / segel kaset"
                                                    disabled={!previousPairComplete}
                                                    autoComplete="off"
                                                    inputMode="text"
                                                  />
                                                  {spareScanErrors[Number(item.id)] ? <small className="cpc-field-error">{spareScanErrors[Number(item.id)]}</small> : null}
                                                  {duplicateSerial ? <small className="cpc-field-error">Kode kaset sudah digunakan pada field packing lain</small> : null}
                                                  {availableSpares.length === 0 && !item.spare_cassette_id ? <small className="cpc-field-error">Stok denom ini belum siap</small> : null}
                                                </>
                                              ) : <strong>{item.cassette_serial || "-"}</strong>}
                                            </td>
                                            <td>
                                              {editable ? (
                                                <>
                                                  <code className="cpc-seal-code">{item.seal_no || "Otomatis dari spare"}</code>
                                                  <small>{item.packed_by_name ? `Disiapkan ${item.packed_by_name}` : "Tercatat setelah disimpan"}</small>
                                                  {duplicateSeal ? <small className="cpc-field-error">Kode segel sudah digunakan pada field packing lain</small> : null}
                                                </>
                                              ) : <strong>{item.seal_no || "-"}</strong>}
                                            </td>
                                            <td>
                                              <span className={`cpc-pack-state ${complete ? "complete" : "pending"}`}>
                                                {complete ? "Lengkap" : "Belum lengkap"}
                                              </span>
                                            </td>
                                          </tr>
                                        )
                                      })}

                                      {asset ? (
                                        <tr className={duplicatePackingCodes.has(rejectSerial) ? "cpc-packing-row-error cpc-reject-row" : "cpc-reject-row"}>
                                          <td><strong>Kaset Reject</strong></td>
                                          <td>{formatCurrency(0)}</td>
                                          <td><strong>0</strong></td>
                                          <td>{formatCurrency(0)}</td>
                                          <td>
                                            {editable ? (
                                              <>
                                                <input
                                                  className={`cpc-packing-input ${duplicatePackingCodes.has(rejectSerial) ? "error" : ""}`}
                                                  value={asset.reject_cassette_serial || ""}
                                                  onChange={(event) => updatePackingTidAsset(asset.id, "reject_cassette_serial", event.target.value)}
                                                  placeholder="Serial kaset reject"
                                                  disabled={!cashComplete}
                                                  autoComplete="off"
                                                />
                                                {duplicatePackingCodes.has(rejectSerial) ? <small className="cpc-field-error">Kode kaset reject sudah digunakan pada field packing lain</small> : null}
                                              </>
                                            ) : <strong>{asset.reject_cassette_serial || "-"}</strong>}
                                          </td>
                                          <td>
                                            {editable ? (
                                              <>
                                                <input
                                                  className={`cpc-packing-input cpc-seal-input ${duplicatePackingCodes.has(rejectSeal) ? "error" : ""}`}
                                                  value={asset.reject_cassette_seal_no || ""}
                                                  onChange={(event) => updatePackingTidAsset(asset.id, "reject_cassette_seal_no", event.target.value)}
                                                  placeholder="Scan segel kaset reject"
                                                  disabled={!rejectSerial}
                                                  autoComplete="off"
                                                />
                                                {duplicatePackingCodes.has(rejectSeal) ? <small className="cpc-field-error">Kode segel reject sudah digunakan pada field packing lain</small> : null}
                                              </>
                                            ) : <strong>{asset.reject_cassette_seal_no || "-"}</strong>}
                                          </td>
                                          <td>
                                            <span className={`cpc-pack-state ${rejectSerial && rejectSeal && !duplicatePackingCodes.has(rejectSerial) && !duplicatePackingCodes.has(rejectSeal) ? "complete" : "pending"}`}>
                                              {rejectSerial && rejectSeal && !duplicatePackingCodes.has(rejectSerial) && !duplicatePackingCodes.has(rejectSeal) ? "Lengkap" : "Belum lengkap"}
                                            </span>
                                          </td>
                                        </tr>
                                      ) : null}
                                    </tbody>
                                  </table>
                                </div>

                                {asset ? (
                                  <div className="cpc-tid-bag-seals">
                                    <label>
                                      <span>Segel Bag Berangkat</span>
                                      {editable ? (
                                        <>
                                          <input
                                            className={`cpc-packing-input cpc-seal-input ${duplicatePackingCodes.has(departureSeal) ? "error" : ""}`}
                                            value={asset.departure_bag_seal_no || ""}
                                            onChange={(event) => updatePackingTidAsset(asset.id, "departure_bag_seal_no", event.target.value)}
                                            placeholder="Scan segel bag berangkat"
                                            disabled={!rejectSerial || !rejectSeal}
                                            autoComplete="off"
                                          />
                                          {duplicatePackingCodes.has(departureSeal) ? <small className="cpc-field-error">Kode Segel BAG Berangkat sudah digunakan pada field packing lain</small> : null}
                                        </>
                                      ) : <strong>{asset.departure_bag_seal_no || "-"}</strong>}
                                    </label>
                                    <label>
                                      <span>Segel Bag Kembali</span>
                                      {editable ? (
                                        <>
                                          <input
                                            className={`cpc-packing-input cpc-seal-input ${duplicatePackingCodes.has(returnSeal) ? "error" : ""}`}
                                            value={asset.return_bag_seal_no || ""}
                                            onChange={(event) => updatePackingTidAsset(asset.id, "return_bag_seal_no", event.target.value)}
                                            placeholder="Scan segel bag kembali"
                                            disabled={!departureSeal}
                                            autoComplete="off"
                                          />
                                          {duplicatePackingCodes.has(returnSeal) ? <small className="cpc-field-error">Kode Segel BAG Kembali sudah digunakan pada field packing lain</small> : null}
                                        </>
                                      ) : <strong>{asset.return_bag_seal_no || "-"}</strong>}
                                    </label>
                                    <div className="cpc-tid-bag-meta">
                                      <span>Kaset Reject</span>
                                      <strong>{formatCurrency(asset.reject_amount || 0)}</strong>
                                      <small>Nilai tetap 0 dan tidak menambah total nominal Work Order</small>
                                    </div>
                                  </div>
                                ) : null}
                              </article>
                            )
                          })}
                        </div>
                      )}

                      {detail.cpc_packing?.batch ? (
                        <div className="cpc-packing-meta">
                          <span>Diajukan: <strong>{detail.cpc_packing.batch.submitted_by_name || "-"}</strong> · {formatDateTime(detail.cpc_packing.batch.submitted_at)}</span>
                          <span>Approval: <strong>{detail.cpc_packing.batch.approved_by_name || "-"}</strong> · {formatDateTime(detail.cpc_packing.batch.approved_at)}</span>
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  {["KASET_SIAP", "SIAP_BERANGKAT"].includes(detail.status) ? (
                    <section className="replenish-detail-section cpc-handover-section">
                      <div className="replenish-section-heading">
                        <div>
                          <h4>Serah Terima Kaset CPC → Custody</h4>
                          <p>Scan ulang nomor segel pada setiap kaset saat keluar dari CPC. Sistem hanya menerima nomor segel yang sama dengan hasil packing yang sudah di-approve.</p>
                        </div>
                        <div className="cpc-packing-progress">
                          <strong>{formatNumber(handoverVerifiedCount)}/{formatNumber(handoverItems.length)} terverifikasi</strong>
                          <small>{detail.cpc_handover?.summary?.completed ? "Serah terima selesai" : "Verifikasi fisik kaset"}</small>
                        </div>
                      </div>

                      <div className="cpc-handover-parties">
                        <article>
                          <span>Petugas CPC</span>
                          <strong>{user?.pegawai?.nama || user?.fullName || user?.username || "-"}</strong>
                          <small>{user?.pegawai?.nip || user?.roleName || user?.roleCode || "-"}</small>
                        </article>
                        <article>
                          <span>Custody Penerima</span>
                          <strong>{detail.cpc_handover?.handover?.custody_name || custodyMember?.nama || "-"}</strong>
                          <small>{detail.cpc_handover?.handover?.custody_nip || custodyMember?.nip || "-"} · {detail.cpc_handover?.handover?.custody_jabatan || custodyMember?.jabatan || "-"}</small>
                        </article>
                        <article>
                          <span>Status Serah Terima</span>
                          <strong>{detail.status === "SIAP_BERANGKAT" ? "SELESAI" : "VERIFIKASI"}</strong>
                          <small>{detail.cpc_handover?.handover?.completed_at ? formatDateTime(detail.cpc_handover.handover.completed_at) : "Belum diselesaikan"}</small>
                        </article>
                      </div>

                      {handoverItems.length === 0 ? (
                        <p className="replenish-empty-card">Data packing belum tersedia untuk diverifikasi.</p>
                      ) : (
                        <div className="table-wrap cpc-handover-table-wrap">
                          <table className="cpc-handover-table">
                            <thead>
                              <tr>
                                <th>ATM/CRM</th>
                                <th>Kaset</th>
                                <th>Serial Kaset</th>
                                <th>Denom</th>
                                <th>Segel Packing</th>
                                <th>Scan Segel Keluar CPC</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {handoverItems.map((item, index) => {
                                const expected = String(item.expected_seal_no || "").trim().toUpperCase()
                                const scanned = String(item.scanned_seal_no || "").trim().toUpperCase()
                                const mismatch = Boolean(scanned && expected !== scanned)
                                const verified = Boolean(scanned && expected === scanned)
                                const editable = detail.status === "KASET_SIAP" && canUpdate && !detail.cpc_handover?.summary?.completed
                                return (
                                  <tr key={item.id || item.packing_cassette_id} className={mismatch ? "cpc-packing-row-error" : ""}>
                                    <td>
                                      <strong>{item.tid || item.sn || "-"}</strong>
                                      <small>{item.lokasi || "-"}</small>
                                    </td>
                                    <td><strong>Kaset {item.cassette_no}</strong></td>
                                    <td><strong>{item.cassette_serial || "-"}</strong></td>
                                    <td>{formatCurrency(item.denomination_value)}</td>
                                    <td><code className="cpc-seal-code">{expected || "-"}</code></td>
                                    <td>
                                      {editable ? (
                                        <>
                                          <input
                                            className={`cpc-packing-input cpc-seal-input ${mismatch ? "error" : ""}`}
                                            data-cpc-handover-index={index}
                                            value={item.scanned_seal_no || ""}
                                            onChange={(event) => updateHandoverItem(index, event.target.value)}
                                            onKeyDown={(event) => {
                                              if (event.key === "Enter") {
                                                event.preventDefault()
                                                focusNextHandoverSeal(index)
                                              }
                                            }}
                                            placeholder="Scan nomor segel"
                                            autoComplete="off"
                                          />
                                          {mismatch ? <small className="cpc-field-error">Segel tidak sesuai packing</small> : null}
                                        </>
                                      ) : <code className="cpc-seal-code">{scanned || "-"}</code>}
                                    </td>
                                    <td>
                                      <span className={`cpc-pack-state ${verified ? "complete" : mismatch ? "error" : "pending"}`}>
                                        {verified ? "Sesuai" : mismatch ? "Tidak sesuai" : "Belum scan"}
                                      </span>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {detail.status === "KASET_SIAP" && canUpdate ? (
                        <div className="cpc-handover-confirmation">
                          <label>
                            <span>Verifikasi NIP Custody penerima</span>
                            <input
                              value={custodyNip}
                              onChange={(event) => setCustodyNip(String(event.target.value || "").toUpperCase().slice(0, 50))}
                              placeholder="Scan / input NIP Custody"
                              autoComplete="off"
                            />
                            <small>NIP harus sama dengan Custody yang ditugaskan pada Work Order.</small>
                          </label>
                          <label>
                            <span>Catatan serah terima</span>
                            <textarea
                              value={handoverNotes}
                              onChange={(event) => setHandoverNotes(event.target.value.slice(0, 1000))}
                              placeholder="Contoh: seluruh kaset dan segel diterima dalam kondisi baik."
                              rows="3"
                            />
                            <small>{handoverNotes.length}/1000 karakter</small>
                          </label>
                        </div>
                      ) : null}

                      {detail.status === "SIAP_BERANGKAT" && detail.cpc_handover?.handover ? (
                        <div className="cpc-handover-complete">
                          Diserahkan oleh <strong>{detail.cpc_handover.handover.completed_by_name || "Petugas CPC"}</strong> kepada <strong>{detail.cpc_handover.handover.recipient_name_snapshot || detail.cpc_handover.handover.custody_name || "Custody"}</strong> pada {formatDateTime(detail.cpc_handover.handover.completed_at)}.
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  <section className="replenish-detail-section">
                    <div className="replenish-section-heading">
                      <div>
                        <h4>Detail Kaset &amp; Lembar Uang per ATM/CRM</h4>
                        <p>Pagu adalah jumlah lembar uang; kebutuhan kaset mengikuti formula Work Order existing.</p>
                      </div>
                      <strong>{formatNumber(detailTotals.total_cassettes)} kaset</strong>
                    </div>
                    <div className="table-wrap cpc-point-table-wrap">
                      <table className="cpc-point-table">
                        <thead>
                          <tr>
                            <th>No</th>
                            <th>ATM/CRM</th>
                            <th>Aktivitas</th>
                            <th>Denom</th>
                            <th>Lembar</th>
                            <th>Kaset</th>
                            <th>Nominal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(detail.points || []).map((point) => (
                            <tr key={point.id}>
                              <td>{point.sequence_no}</td>
                              <td>
                                <strong>{point.tid || point.sn}</strong>
                                <small>{point.lokasi || "-"}</small>
                                <small>SN {point.sn || "-"}</small>
                              </td>
                              <td>{activityLabel(point.activity_type)}</td>
                              <td>{point.denomination_value ? formatCurrency(point.denomination_value) : "-"}</td>
                              <td>{point.pagu ? formatNumber(point.pagu) : "-"}</td>
                              <td>{point.required_cassettes ? `${formatNumber(point.required_cassettes)} kaset` : "-"}</td>
                              <td>{point.requested_amount ? formatCurrency(point.requested_amount) : "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="replenish-detail-section">
                    <h4>Tim Operasional</h4>
                    <div className="replenish-team-cards cpc-team-cards">
                      {(detail.team || []).map((member) => (
                        <article key={member.id}>
                          <span>{titleCase(member.member_role)}</span>
                          <strong>{member.nama}</strong>
                          <small>{member.nip} · {member.jabatan || "-"}</small>
                        </article>
                      ))}
                    </div>
                  </section>

                  <section className="replenish-detail-section">
                    <h4>Riwayat Status</h4>
                    <div className="replenish-history">
                      {(detail.history || []).length === 0 ? <p className="replenish-empty-card">Belum ada riwayat.</p> : null}
                      {(detail.history || []).map((history) => (
                        <article key={history.id}>
                          <span>{formatDateTime(history.created_at)}</span>
                          <div>
                            <strong>{history.from_status ? `${titleCase(history.from_status)} → ` : ""}{titleCase(history.to_status)}</strong>
                            <p>{history.notes || history.action}</p>
                            <small>{history.actor_name || "System"} · {history.action}</small>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>

                  {["KASET_DALAM_PERSIAPAN", "MENUNGGU_APPROVAL_CPC", "KASET_SIAP", "SIAP_BERANGKAT"].includes(detail.status) ? (
                    <section className={`replenish-detail-section cpc-blotter-gate ${["KASET_SIAP", "SIAP_BERANGKAT"].includes(detail.status) ? "ready" : "locked"}`}>
                      <div>
                        <span>Blotter CPC</span>
                        <strong>{["KASET_SIAP", "SIAP_BERANGKAT"].includes(detail.status) ? "Siap dicetak" : "Belum dapat dicetak"}</strong>
                      </div>
                      <p>
                        {detail.status === "KASET_DALAM_PERSIAPAN"
                          ? "Lengkapi setiap TID secara berurutan: kaset uang + segelnya, Kaset Reject + Segel Kaset Reject, Segel BAG Berangkat, lalu Segel BAG Kembali. Simpan packing, lalu ajukan ke ASISTEN_MANAGER_CPC."
                          : detail.status === "MENUNGGU_APPROVAL_CPC"
                            ? "Packing sudah diajukan. Blotter akan terbuka setelah approval ASISTEN_MANAGER_CPC."
                            : "Packing telah di-approve ASISTEN_MANAGER_CPC. Blotter dapat dicetak."}
                      </p>
                    </section>
                  ) : null}

                  {canUpdate && !["KASET_SIAP", "SIAP_BERANGKAT"].includes(detail.status) ? (
                    <section className="replenish-detail-section cpc-action-section">
                      <h4>Catatan Proses CPC</h4>
                      <label className="cpc-notes-field">
                        <span>{detail.status === "MENUNGGU_APPROVAL_CPC" && detailCapabilities.can_approve_packing ? "Catatan approval / alasan penolakan" : "Catatan opsional"}</span>
                        <textarea
                          value={actionNotes}
                          onChange={(event) => setActionNotes(event.target.value.slice(0, 1000))}
                          placeholder={detail.status === "MENUNGGU_APPROVAL_CPC" ? "Isi catatan approval; alasan wajib jika packing ditolak." : "Contoh: kaset uang + segelnya, kaset reject + segelnya, dan segel BAG per TID telah dicocokkan."}
                          rows="3"
                        />
                        <small>{actionNotes.length}/1000 karakter</small>
                      </label>
                    </section>
                  ) : null}
                </>
              ) : null}
            </div>

            {detail ? (
              <div className="replenish-detail-actions cpc-detail-actions">
                <button type="button" className="replenish-button secondary" onClick={closeDetail} disabled={actionLoading || packingSaving || handoverSaving}>Tutup</button>

                {canUpdate && ["DISETUJUI", "MENUNGGU_VALIDASI_KASET"].includes(detail.status) ? (
                  <button type="button" className="replenish-button primary" onClick={() => void processAction(detail)} disabled={actionLoading}>
                    {actionLoading ? "Memproses..." : CPC_ACTION_LABELS[cpcActionForStatus(detail.status)]}
                  </button>
                ) : null}

                {canUpdate && detail.status === "KASET_DALAM_PERSIAPAN" ? (
                  <>
                    <button type="button" className="replenish-button secondary" onClick={() => void savePacking()} disabled={packingSaving || actionLoading || !detailCapabilities.can_edit_packing || myPackingGroups.length === 0 || duplicatePackingCodes.size > 0 || !packingDirty}>
                      {packingSaving ? "Menyimpan..." : "Simpan Packing Saya"}
                    </button>
                    <button
                      type="button"
                      className="replenish-button primary"
                      onClick={() => void finishPackingAndSubmit()}
                      disabled={actionLoading || packingSaving || !detailCapabilities.can_edit_packing || !localPackingComplete}
                      title={!localPackingComplete ? "Lengkapi pemilihan spare kaset dan seluruh scan segel terlebih dahulu." : "Simpan perubahan terakhir lalu ajukan ke Asisten Manager CPC."}
                    >
                      {actionLoading ? "Mengajukan..." : CPC_ACTION_LABELS[CPC_ACTIONS.SUBMIT_APPROVAL]}
                    </button>
                  </>
                ) : null}

                {canUpdate && detail.status === "MENUNGGU_APPROVAL_CPC" && detailCapabilities.can_approve_packing ? (
                  <>
                    <button
                      type="button"
                      className="replenish-button danger"
                      onClick={() => void processAction(detail, CPC_ACTIONS.REJECT_PACKING)}
                      disabled={actionLoading || !actionNotes.trim()}
                      title={!actionNotes.trim() ? "Alasan penolakan wajib diisi." : ""}
                    >
                      {CPC_ACTION_LABELS[CPC_ACTIONS.REJECT_PACKING]}
                    </button>
                    <button type="button" className="replenish-button primary" onClick={() => void processAction(detail, CPC_ACTIONS.APPROVE_PACKING)} disabled={actionLoading}>
                      {actionLoading ? "Memproses..." : CPC_ACTION_LABELS[CPC_ACTIONS.APPROVE_PACKING]}
                    </button>
                  </>
                ) : null}

                {detail.status === "MENUNGGU_APPROVAL_CPC" && !detailCapabilities.can_approve_packing ? (
                  <span className="cpc-approval-note">Menunggu ASISTEN_MANAGER_CPC</span>
                ) : null}

                {["KASET_SIAP", "SIAP_BERANGKAT"].includes(detail.status) ? (
                  <button type="button" className="replenish-button secondary" onClick={printBlotter}>Cetak Blotter</button>
                ) : null}

                {canUpdate && detail.status === "KASET_SIAP" ? (
                  <>
                    <button
                      type="button"
                      className="replenish-button secondary"
                      onClick={() => void saveHandover()}
                      disabled={handoverSaving || actionLoading || handoverItems.length === 0 || !handoverDirty}
                    >
                      {handoverSaving ? "Menyimpan..." : "Simpan Scan Serah Terima"}
                    </button>
                    <button
                      type="button"
                      className="replenish-button primary"
                      onClick={() => void processAction(detail, CPC_ACTIONS.COMPLETE_HANDOVER)}
                      disabled={actionLoading || handoverSaving || handoverDirty || !localHandoverVerified || !detail.cpc_handover?.summary?.all_verified || !custodyNip.trim()}
                      title={!detail.cpc_handover?.summary?.all_verified ? "Simpan seluruh scan segel yang sesuai terlebih dahulu." : !custodyNip.trim() ? "Verifikasi NIP Custody penerima terlebih dahulu." : ""}
                    >
                      {actionLoading ? "Menyelesaikan..." : CPC_ACTION_LABELS[CPC_ACTIONS.COMPLETE_HANDOVER]}
                    </button>
                  </>
                ) : null}

                {detail.status === "SIAP_BERANGKAT" ? (
                  <span className="cpc-ready-note">Kaset telah diterima Custody · siap berangkat</span>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {toast.open ? <div className={`replenish-toast ${toast.type === "error" ? "error" : ""}`}>{toast.message}</div> : null}
    </div>
  )
}
