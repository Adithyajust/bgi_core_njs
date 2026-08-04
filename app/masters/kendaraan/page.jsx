"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useAppBootstrap } from "@/components/app-bootstrap-context"

import {
  validateVehicleImportRows,
} from "@/modules/master-kendaraan/import-validation"
import {
  parseVehicleSpreadsheet,
} from "@/modules/master-kendaraan/spreadsheet-parser"

const VEHICLE_TYPES = [
  { value: "MOBIL", label: "Mobil" },
  { value: "MOTOR", label: "Motor" },
]

const VEHICLE_STATUSES = [
  { value: "AKTIF", label: "Aktif" },
  { value: "NONAKTIF", label: "Nonaktif" },
]

const EMPTY_FORM = {
  uker_id: "",
  jenis_kendaraan: "MOBIL",
  merk_kendaraan: "",
  nomor_kendaraan: "",
  status: "AKTIF",
  row_version: "",
}

function mapToForm(vehicle) {
  return {
    uker_id: String(vehicle?.uker_id || ""),
    jenis_kendaraan: String(vehicle?.jenis_kendaraan || "MOBIL"),
    merk_kendaraan: String(vehicle?.merk_kendaraan || ""),
    nomor_kendaraan: String(vehicle?.nomor_kendaraan || ""),
    status: String(vehicle?.status || "AKTIF"),
    row_version: String(vehicle?.row_version || ""),
  }
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

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || ""

  if (!contentType.includes("application/json")) {
    throw new Error(`Endpoint tidak mengembalikan JSON. Status ${response.status}.`)
  }

  return response.json()
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...options,
  })

  const result = await readJsonResponse(response)

  if (!response.ok || !result.success) {
    const error = new Error(result.message || "Permintaan gagal diproses.")
    error.status = response.status
    error.payload = result
    throw error
  }

  return result
}

function getErrorMessage(error, fallbackMessage) {
  return error instanceof Error ? error.message : fallbackMessage
}

function formatFileSize(size) {
  const bytes = Number(size || 0)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function routeAuthorizationError(error, router) {
  if (error?.status === 401) {
    router.replace(`/login?next=${encodeURIComponent("/masters/kendaraan")}`)
    return true
  }

  if (error?.status === 403) {
    router.replace("/forbidden")
    return true
  }

  return false
}

export default function MasterKendaraanPage() {
  const router = useRouter()
  const { user: currentUser } = useAppBootstrap()
  const toastTimerRef = useRef(null)
  const importFileInputRef = useRef(null)

  const [vehicles, setVehicles] = useState([])
  const [ukers, setUkers] = useState([])
  const [scope, setScope] = useState(null)
  const [permissions, setPermissions] = useState({
    can_create: false,
    can_update: false,
    can_delete: false,
  })
  const [summary, setSummary] = useState({
    total: 0,
    mobil: 0,
    motor: 0,
    aktif: 0,
  })
  const [pagination, setPagination] = useState({
    page: 1,
    page_size: 10,
    total_items: 0,
    total_pages: 1,
  })

  const [searchText, setSearchText] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("ALL")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [ukerFilter, setUkerFilter] = useState("ALL")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [refreshKey, setRefreshKey] = useState(0)

  const [loadingReferences, setLoadingReferences] = useState(true)
  const [loadingVehicles, setLoadingVehicles] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState("")

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState("")

  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importRows, setImportRows] = useState([])
  const [importErrors, setImportErrors] = useState([])
  const [importError, setImportError] = useState("")
  const [importParsing, setImportParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importDragActive, setImportDragActive] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState("")

  const [toast, setToast] = useState({
    open: false,
    type: "success",
    message: "",
  })

  const isSuperAdmin =
    currentUser?.roleCode === "SUPER_ADMIN" || Boolean(scope?.isSuperAdmin)

  function showToast(type, message) {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current)
    }

    setToast({ open: true, type, message })
    toastTimerRef.current = window.setTimeout(() => {
      setToast((current) => ({ ...current, open: false }))
      toastTimerRef.current = null
    }, type === "error" ? 5000 : 3500)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchText.trim())
    }, 350)

    return () => window.clearTimeout(timer)
  }, [searchText])

  useEffect(() => {
    const controller = new AbortController()

    requestJson("/api/masters/uker?mode=options", {
      method: "GET",
      signal: controller.signal,
    })
      .then((ukerResult) => {
        if (controller.signal.aborted) return

        setUkers(
          Array.isArray(ukerResult.data?.ukers) ? ukerResult.data.ukers : []
        )
      })
      .catch((error) => {
        if (error?.name === "AbortError" || controller.signal.aborted) return
        if (routeAuthorizationError(error, router)) return

        setLoadError(
          getErrorMessage(error, "Gagal mengambil data unit kerja.")
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingReferences(false)
      })

    return () => controller.abort()
  }, [router])

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    })

    if (debouncedSearch) query.set("search", debouncedSearch)
    if (typeFilter !== "ALL") query.set("jenis_kendaraan", typeFilter)
    if (statusFilter !== "ALL") query.set("status", statusFilter)
    if (ukerFilter !== "ALL") query.set("uker_id", ukerFilter)

    queueMicrotask(() => {
      if (controller.signal.aborted) return

      setLoadingVehicles(true)
      setLoadError("")
    })

    requestJson(`/api/masters/kendaraan?${query.toString()}`, {
      method: "GET",
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return

        const resultPagination = result.data?.pagination || {}

        setVehicles(
          Array.isArray(result.data?.vehicles) ? result.data.vehicles : []
        )
        setSummary({
          total: Number(result.data?.summary?.total || 0),
          mobil: Number(result.data?.summary?.mobil || 0),
          motor: Number(result.data?.summary?.motor || 0),
          aktif: Number(result.data?.summary?.aktif || 0),
        })
        setScope(result.data?.scope || null)
        setPermissions({
          can_create: Boolean(result.data?.permissions?.can_create),
          can_update: Boolean(result.data?.permissions?.can_update),
          can_delete: Boolean(result.data?.permissions?.can_delete),
        })
        setPagination({
          page: Number(resultPagination.page || 1),
          page_size: Number(resultPagination.page_size || pageSize),
          total_items: Number(resultPagination.total_items || 0),
          total_pages: Number(resultPagination.total_pages || 1),
        })

        if (resultPagination.page && Number(resultPagination.page) !== page) {
          setPage(Number(resultPagination.page))
        }
      })
      .catch((error) => {
        if (error?.name === "AbortError" || controller.signal.aborted) return
        if (routeAuthorizationError(error, router)) return

        setLoadError(getErrorMessage(error, "Gagal mengambil data kendaraan."))
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingVehicles(false)
          setRefreshing(false)
        }
      })

    return () => controller.abort()
  }, [
    debouncedSearch,
    page,
    pageSize,
    refreshKey,
    router,
    statusFilter,
    typeFilter,
    ukerFilter,
  ])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!modalOpen && !importModalOpen && !deleteTarget) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    function handleEscape(event) {
      if (event.key !== "Escape" || saving || deleting || importing || importParsing) {
        return
      }

      if (deleteTarget) {
        setDeleteTarget(null)
        setDeleteError("")
      } else if (importModalOpen) {
        setImportModalOpen(false)
        setImportFile(null)
        setImportRows([])
        setImportErrors([])
        setImportError("")
        setImportParsing(false)
        setImportDragActive(false)

        if (importFileInputRef.current) {
          importFileInputRef.current.value = ""
        }
      } else {
        setModalOpen(false)
        setEditingId(null)
        setForm(EMPTY_FORM)
        setModalError("")
      }
    }

    window.addEventListener("keydown", handleEscape)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleEscape)
    }
  }, [
    deleteTarget,
    deleting,
    importing,
    importModalOpen,
    importParsing,
    modalOpen,
    saving,
  ])

  function openAddModal() {
    const ownUker = ukers.find(
      (item) => item.codeuker === currentUser?.codeUker
    )

    setEditingId(null)
    setForm({
      ...EMPTY_FORM,
      uker_id: isSuperAdmin ? "" : String(ownUker?.id || ukers[0]?.id || ""),
    })
    setModalError("")
    setModalOpen(true)
  }

  function openEditModal(vehicle) {
    setEditingId(vehicle.id)
    setForm(mapToForm(vehicle))
    setModalError("")
    setModalOpen(true)
  }

  function closeModal() {
    if (saving) return

    setModalOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setModalError("")
  }

  function handleFormInput(event) {
    const { name, value } = event.target

    setForm((current) => ({
      ...current,
      [name]: name === "nomor_kendaraan" ? value.toUpperCase() : value,
    }))
  }

  function resetImportState() {
    setImportFile(null)
    setImportRows([])
    setImportErrors([])
    setImportError("")
    setImportParsing(false)
    setImportDragActive(false)

    if (importFileInputRef.current) {
      importFileInputRef.current.value = ""
    }
  }

  function openImportModal() {
    resetImportState()
    setImportModalOpen(true)
  }

  function closeImportModal() {
    if (importing || importParsing) return

    setImportModalOpen(false)
    resetImportState()
  }

  async function processImportFile(file) {
    if (!file) return

    setImportFile(file)
    setImportRows([])
    setImportErrors([])
    setImportError("")
    setImportParsing(true)

    try {
      const parsedRows = await parseVehicleSpreadsheet(file)
      const validation = validateVehicleImportRows(parsedRows, {
        isSuperAdmin,
      })
      const errors = [...validation.errors]

      if (isSuperAdmin) {
        const availableCodes = new Set(
          ukers.map((uker) => String(uker.codeuker || "").trim().toUpperCase())
        )

        validation.rows.forEach((row) => {
          if (
            row.kode_unit_kerja &&
            !availableCodes.has(row.kode_unit_kerja)
          ) {
            errors.push({
              row: row._row_number,
              field: "kode_unit_kerja",
              message: `Kode unit kerja ${row.kode_unit_kerja} tidak ditemukan.`,
            })
          }
        })
      }

      setImportRows(validation.rows)
      setImportErrors(errors)
    } catch (error) {
      setImportError(
        getErrorMessage(error, "File kendaraan gagal dibaca.")
      )
    } finally {
      setImportParsing(false)
    }
  }

  function handleImportFileChange(event) {
    const file = event.target.files?.[0] || null
    processImportFile(file)
  }

  function handleImportDrop(event) {
    event.preventDefault()
    setImportDragActive(false)

    const file = event.dataTransfer.files?.[0] || null
    processImportFile(file)
  }

  async function handleImportSubmit() {
    if (importRows.length === 0 || importErrors.length > 0) return

    setImporting(true)
    setImportError("")

    try {
      const result = await requestJson("/api/masters/kendaraan/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: importRows }),
      })

      setImportModalOpen(false)
      resetImportState()
      showToast("success", result.message)
      setPage(1)
      setRefreshKey((value) => value + 1)
    } catch (error) {
      if (routeAuthorizationError(error, router)) return

      const serverErrors = error?.payload?.data?.errors
      if (Array.isArray(serverErrors)) {
        setImportErrors(serverErrors)
      }

      setImportError(
        getErrorMessage(error, "Data kendaraan gagal diupload.")
      )
    } finally {
      setImporting(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setModalError("")

    try {
      const result = await requestJson("/api/masters/kendaraan", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editingId ? { id: editingId } : {}),
          ...form,
        }),
      })

      setModalOpen(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
      setModalError("")
      showToast("success", result.message)
      setRefreshKey((value) => value + 1)
    } catch (error) {
      if (routeAuthorizationError(error, router)) return
      setModalError(getErrorMessage(error, "Data kendaraan gagal disimpan."))
    } finally {
      setSaving(false)
    }
  }

  function openDeleteModal(vehicle) {
    setDeleteTarget(vehicle)
    setDeleteError("")
  }

  function closeDeleteModal() {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteError("")
  }

  async function handleDelete() {
    if (!deleteTarget) return

    setDeleting(true)
    setDeleteError("")

    try {
      const result = await requestJson("/api/masters/kendaraan", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      })

      setDeleteTarget(null)
      setDeleteError("")
      showToast("success", result.message)
      setRefreshKey((value) => value + 1)
    } catch (error) {
      if (routeAuthorizationError(error, router)) return
      setDeleteError(getErrorMessage(error, "Data kendaraan gagal dihapus."))
    } finally {
      setDeleting(false)
    }
  }

  function resetFilters() {
    setSearchText("")
    setDebouncedSearch("")
    setTypeFilter("ALL")
    setStatusFilter("ALL")
    setUkerFilter("ALL")
    setPage(1)
  }

  function refreshVehicles() {
    setRefreshing(true)
    setRefreshKey((value) => value + 1)
  }

  const paginationPages = []
  const totalPages = Math.max(1, pagination.total_pages)
  let startPage = Math.max(1, pagination.page - 2)
  let endPage = Math.min(totalPages, startPage + 4)
  startPage = Math.max(1, endPage - 4)

  for (let current = startPage; current <= endPage; current += 1) {
    paginationPages.push(current)
  }

  const importErrorRows = new Set(
    importErrors
      .map((error) => Number(error.row))
      .filter((row) => Number.isSafeInteger(row) && row > 0)
  )
  const importInvalidCount = importErrorRows.size
  const importValidCount = Math.max(0, importRows.length - importInvalidCount)
  const importErrorsByRow = new Map()

  importErrors.forEach((error) => {
    const rowNumber = Number(error.row)
    if (!Number.isSafeInteger(rowNumber)) return

    const rowErrors = importErrorsByRow.get(rowNumber) || []
    rowErrors.push(error.message)
    importErrorsByRow.set(rowNumber, rowErrors)
  })

  return (
    <div className="simple-page user-role-page vehicle-page">
      <section className="page-heading-card user-role-heading">
        <div>
          <p className="eyebrow">Master Data</p>
          <h2>Master Kendaraan</h2>
          <p>
            Kelola kendaraan operasional berdasarkan unit kerja, jenis
            kendaraan, merk, nomor kendaraan unik, dan status penggunaan.
          </p>
        </div>

        <Link href="/masters" className="user-role-button secondary">
          Kembali
        </Link>
      </section>

      <section className="user-role-summary-grid">
        <article className="user-role-summary-card">
          <span>Total Kendaraan</span>
          <strong>{summary.total}</strong>
          <p>Seluruh kendaraan dalam akses Anda</p>
        </article>

        <article className="user-role-summary-card green">
          <span>Kendaraan Aktif</span>
          <strong>{summary.aktif}</strong>
          <p>Kendaraan yang masih digunakan</p>
        </article>

        <article className="user-role-summary-card orange">
          <span>Mobil</span>
          <strong>{summary.mobil}</strong>
          <p>Total kendaraan berjenis mobil</p>
        </article>

        <article className="user-role-summary-card green">
          <span>Motor</span>
          <strong>{summary.motor}</strong>
          <p>Total kendaraan berjenis motor</p>
        </article>
      </section>

      <section className="settings-card user-role-panel">
        <div className="user-role-toolbar vehicle-toolbar">
          <div className="user-role-filters vehicle-filters">
            <input
              type="search"
              value={searchText}
              onChange={(event) => {
                setSearchText(event.target.value)
                setPage(1)
              }}
              placeholder="Cari merk, nomor kendaraan, atau unit kerja..."
              aria-label="Cari kendaraan"
            />

            <select
              value={typeFilter}
              onChange={(event) => {
                setTypeFilter(event.target.value)
                setPage(1)
              }}
              aria-label="Filter jenis kendaraan"
            >
              <option value="ALL">Semua Jenis</option>
              {VEHICLE_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value)
                setPage(1)
              }}
              aria-label="Filter status kendaraan"
            >
              <option value="ALL">Semua Status</option>
              {VEHICLE_STATUSES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>

            {isSuperAdmin ? (
              <select
                value={ukerFilter}
                onChange={(event) => {
                  setUkerFilter(event.target.value)
                  setPage(1)
                }}
                aria-label="Filter unit kerja"
              >
                <option value="ALL">Semua Unit Kerja</option>
                {ukers.map((uker) => (
                  <option key={uker.id} value={uker.id}>
                    {uker.codeuker} - {uker.nama_uker}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <div className="user-role-toolbar-actions">
            <button
              type="button"
              className="user-role-button secondary"
              onClick={resetFilters}
              disabled={
                !searchText &&
                typeFilter === "ALL" &&
                statusFilter === "ALL" &&
                ukerFilter === "ALL"
              }
            >
              Reset
            </button>

            <button
              type="button"
              className="user-role-button secondary"
              onClick={refreshVehicles}
              disabled={loadingVehicles || refreshing}
            >
              {refreshing ? "Memuat..." : "Refresh"}
            </button>

            {permissions.can_create ? (
              <>
                <button
                  type="button"
                  className="user-role-button secondary"
                  onClick={openImportModal}
                  disabled={loadingReferences || loadingVehicles}
                >
                  Upload Kendaraan
                </button>
                <button
                  type="button"
                  className="user-role-button primary"
                  onClick={openAddModal}
                  disabled={loadingReferences || loadingVehicles}
                >
                  Tambah Kendaraan
                </button>
              </>
            ) : null}
          </div>
        </div>

        {loadError ? (
          <div className="user-role-alert error">
            <strong>Data gagal dimuat</strong>
            <span>{loadError}</span>
          </div>
        ) : null}

        {!isSuperAdmin && !loadingReferences ? (
          <div className="user-role-alert info">
            <strong>Akses berdasarkan unit kerja</strong>
            <span>
              Anda hanya dapat melihat dan mengelola kendaraan milik unit kerja
              {currentUser?.ukerName ? ` ${currentUser.ukerName}` : " Anda"}.
            </span>
          </div>
        ) : null}

        <div className="user-role-table-wrapper">
          <table className="user-role-table vehicle-table">
            <thead>
              <tr>
                <th>Nomor Kendaraan</th>
                <th>Jenis</th>
                <th>Merk Kendaraan</th>
                <th>Unit Kerja</th>
                <th>Status</th>
                <th>Dibuat</th>
                <th>Diperbarui</th>
                <th>Aksi</th>
              </tr>
            </thead>

            <tbody>
              {loadingVehicles ? (
                <tr>
                  <td colSpan={8} className="user-role-loading">
                    Memuat data kendaraan...
                  </td>
                </tr>
              ) : null}

              {!loadingVehicles && vehicles.length === 0 ? (
                <tr>
                  <td colSpan={8} className="user-role-empty">
                    {summary.total === 0
                      ? "Belum ada data kendaraan."
                      : "Tidak ada kendaraan yang sesuai dengan filter."}
                  </td>
                </tr>
              ) : null}

              {!loadingVehicles
                ? vehicles.map((vehicle) => (
                    <tr key={vehicle.id}>
                      <td>
                        <strong className="vehicle-number">
                          {vehicle.nomor_kendaraan || "-"}
                        </strong>
                      </td>
                      <td>
                        <span
                          className={`vehicle-type ${String(
                            vehicle.jenis_kendaraan || ""
                          ).toLowerCase()}`}
                        >
                          {vehicle.jenis_kendaraan === "MOTOR"
                            ? "Motor"
                            : "Mobil"}
                        </span>
                      </td>
                      <td>
                        <strong>{vehicle.merk_kendaraan || "-"}</strong>
                      </td>
                      <td>
                        <strong>{vehicle.codeuker || "-"}</strong>
                        <span className="project-cell-subtext">
                          {vehicle.nama_uker || "-"}
                        </span>
                      </td>
                      <td>
                        <span
                          className={
                            vehicle.status === "AKTIF"
                              ? "user-role-status active"
                              : "user-role-status inactive"
                          }
                        >
                          {vehicle.status === "AKTIF" ? "Aktif" : "Nonaktif"}
                        </span>
                      </td>
                      <td>{formatDateTime(vehicle.created_at)}</td>
                      <td>{formatDateTime(vehicle.updated_at)}</td>
                      <td>
                        {permissions.can_update || permissions.can_delete ? (
                          <div className="user-role-actions vehicle-actions">
                            {permissions.can_update ? (
                              <button
                                type="button"
                                className="edit"
                                onClick={() => openEditModal(vehicle)}
                                disabled={saving || deleting}
                              >
                                Edit
                              </button>
                            ) : null}
                            {permissions.can_delete ? (
                              <button
                                type="button"
                                className="delete"
                                onClick={() => openDeleteModal(vehicle)}
                                disabled={saving || deleting}
                              >
                                Hapus
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        </div>

        {!loadingVehicles && pagination.total_items > 0 ? (
          <div className="project-pagination">
            <p>
              Menampilkan {(pagination.page - 1) * pagination.page_size + 1} -{" "}
              {Math.min(
                pagination.page * pagination.page_size,
                pagination.total_items
              )}{" "}
              dari {pagination.total_items} data
            </p>

            <div className="project-pagination-controls">
              <label>
                <span>Baris</span>
                <select
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value))
                    setPage(1)
                  }}
                  aria-label="Jumlah kendaraan per halaman"
                >
                  {[10, 25, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>

              <nav aria-label="Navigasi halaman kendaraan">
                <button
                  type="button"
                  onClick={() => setPage(1)}
                  disabled={pagination.page === 1}
                  title="Halaman pertama"
                >
                  «
                </button>
                <button
                  type="button"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={pagination.page === 1}
                  title="Halaman sebelumnya"
                >
                  ‹
                </button>

                {paginationPages.map((pageNumber) => (
                  <button
                    key={pageNumber}
                    type="button"
                    className={pageNumber === pagination.page ? "active" : ""}
                    onClick={() => setPage(pageNumber)}
                  >
                    {pageNumber}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() =>
                    setPage((value) => Math.min(totalPages, value + 1))
                  }
                  disabled={pagination.page === totalPages}
                  title="Halaman berikutnya"
                >
                  ›
                </button>
                <button
                  type="button"
                  onClick={() => setPage(totalPages)}
                  disabled={pagination.page === totalPages}
                  title="Halaman terakhir"
                >
                  »
                </button>
              </nav>
            </div>
          </div>
        ) : null}
      </section>

      {importModalOpen ? (
        <div
          className="user-role-modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !importing &&
              !importParsing
            ) {
              closeImportModal()
            }
          }}
        >
          <section
            className="user-role-modal vehicle-import-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vehicle-import-title"
          >
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">Master Kendaraan</p>
                <h3 id="vehicle-import-title">Upload Data Kendaraan</h3>
                <p>Import maksimal 500 kendaraan melalui file XLSX atau CSV.</p>
              </div>

              <button
                type="button"
                onClick={closeImportModal}
                disabled={importing || importParsing}
                aria-label="Tutup formulir upload"
              >
                ×
              </button>
            </header>

            <form
              className="vehicle-import-form"
              onSubmit={(event) => {
                event.preventDefault()
                handleImportSubmit()
              }}
            >
              <div className="user-role-form-grid single vehicle-import-form-grid">
                <div className="user-role-form-field full">
                  <label>Template Data Kendaraan</label>
                  <div className="vehicle-import-template-field">
                    <div>
                      <strong>Gunakan template resmi</strong>
                      <small>
                        Unduh template, isi data tanpa mengubah nama kolom, lalu
                        unggah kembali dalam format XLSX atau CSV.
                      </small>
                    </div>
                    <a
                      href="/templates/template-upload-kendaraan.xlsx"
                      download
                      className="user-role-button secondary vehicle-import-download"
                    >
                      Unduh Template XLSX
                    </a>
                  </div>
                </div>

                <div className="user-role-form-field full">
                  <label htmlFor="vehicle-import-file">File Kendaraan *</label>
                  <div
                    className={`vehicle-import-dropzone ${
                      importDragActive ? "active" : ""
                    }`}
                    onDragEnter={(event) => {
                      event.preventDefault()
                      setImportDragActive(true)
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={(event) => {
                      event.preventDefault()
                      if (!event.currentTarget.contains(event.relatedTarget)) {
                        setImportDragActive(false)
                      }
                    }}
                    onDrop={handleImportDrop}
                  >
                    <input
                      id="vehicle-import-file"
                      ref={importFileInputRef}
                      type="file"
                      accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                      onChange={handleImportFileChange}
                      hidden
                    />
                    <span className="vehicle-import-file-icon">XLSX</span>
                    <div className="vehicle-import-file-copy">
                      <strong>
                        {importFile
                          ? importFile.name
                          : "Pilih atau tarik file kendaraan ke area ini"}
                      </strong>
                      <small>
                        {importFile
                          ? `${formatFileSize(importFile.size)} • File siap divalidasi`
                          : "Format XLSX/CSV, maksimal 5 MB dan 500 baris. File tidak boleh diproteksi kata sandi."}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="user-role-button secondary vehicle-import-file-button"
                      onClick={() => importFileInputRef.current?.click()}
                      disabled={importParsing || importing}
                    >
                      {importFile ? "Ganti File" : "Pilih File"}
                    </button>
                  </div>
                </div>

                <details className="vehicle-import-format-details">
                  <summary>Lihat format dan ketentuan kolom</summary>
                  <div className="vehicle-import-format-table-wrap">
                    <table className="vehicle-import-format-table">
                      <thead>
                        <tr>
                          <th>Kolom</th>
                          <th>Ketentuan</th>
                          <th>Contoh</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>kode_unit_kerja</td>
                          <td>
                            {isSuperAdmin
                              ? "Wajib; harus sesuai Master Unit Kerja"
                              : "Opsional; otomatis memakai unit kerja akun"}
                          </td>
                          <td>0001</td>
                        </tr>
                        <tr>
                          <td>jenis_kendaraan</td>
                          <td>MOBIL atau MOTOR</td>
                          <td>MOBIL</td>
                        </tr>
                        <tr>
                          <td>merk_kendaraan</td>
                          <td>Wajib; maksimal 100 karakter</td>
                          <td>Toyota Avanza</td>
                        </tr>
                        <tr>
                          <td>nomor_kendaraan</td>
                          <td>Wajib dan unik; maksimal 20 karakter</td>
                          <td>B 1234 XYZ</td>
                        </tr>
                        <tr>
                          <td>status</td>
                          <td>AKTIF atau NONAKTIF</td>
                          <td>AKTIF</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </details>

                {importParsing ? (
                  <div className="vehicle-import-processing">
                    Membaca dan memvalidasi file...
                  </div>
                ) : null}

                {importFile && !importParsing ? (
                  <div className="vehicle-import-summary">
                    <article>
                      <span>Total Baris</span>
                      <strong>{importRows.length}</strong>
                    </article>
                    <article className="valid">
                      <span>Valid</span>
                      <strong>{importValidCount}</strong>
                    </article>
                    <article className={importInvalidCount > 0 ? "invalid" : ""}>
                      <span>Perlu Diperbaiki</span>
                      <strong>{importInvalidCount}</strong>
                    </article>
                  </div>
                ) : null}

                {importError ? (
                  <div className="user-role-alert error vehicle-import-alert">
                    <strong>Upload belum dapat diproses</strong>
                    <span>{importError}</span>
                  </div>
                ) : null}

                {importErrors.length > 0 ? (
                  <div className="vehicle-import-error-list">
                    <strong>Kesalahan data ({importErrors.length})</strong>
                    <ul>
                      {importErrors.slice(0, 10).map((error, index) => (
                        <li key={`${error.row || "general"}-${error.field || "field"}-${index}`}>
                          {error.row ? `Baris ${error.row}: ` : ""}
                          {error.message}
                        </li>
                      ))}
                    </ul>
                    {importErrors.length > 10 ? (
                      <small>
                        Masih ada {importErrors.length - 10} kesalahan lain.
                      </small>
                    ) : null}
                  </div>
                ) : null}

                {importRows.length > 0 ? (
                  <div className="vehicle-import-preview">
                    <div className="vehicle-import-preview-heading">
                      <strong>Pratinjau data</strong>
                      <span>Menampilkan maksimal 10 baris pertama</span>
                    </div>
                    <div className="vehicle-import-preview-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Baris</th>
                            <th>Kode Uker</th>
                            <th>Jenis</th>
                            <th>Merk</th>
                            <th>Nomor</th>
                            <th>Status</th>
                            <th>Validasi</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importRows.slice(0, 10).map((row) => {
                            const rowErrors =
                              importErrorsByRow.get(row._row_number) || []

                            return (
                              <tr
                                key={row._row_number}
                                className={rowErrors.length > 0 ? "invalid" : ""}
                              >
                                <td>{row._row_number}</td>
                                <td>{row.kode_unit_kerja || "-"}</td>
                                <td>{row.jenis_kendaraan || "-"}</td>
                                <td>{row.merk_kendaraan || "-"}</td>
                                <td>{row.nomor_kendaraan || "-"}</td>
                                <td>{row.status || "-"}</td>
                                <td>
                                  <span
                                    className={`vehicle-import-row-status ${
                                      rowErrors.length > 0 ? "invalid" : "valid"
                                    }`}
                                    title={rowErrors.join(" ")}
                                  >
                                    {rowErrors.length > 0 ? "Periksa" : "Valid"}
                                  </span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>

            <footer className="user-role-modal-footer">
              <button
                type="button"
                className="user-role-button secondary"
                onClick={closeImportModal}
                disabled={importing || importParsing}
              >
                Batal
              </button>
              <button
                type="submit"
                className="user-role-button primary"
                disabled={
                  importing ||
                  importParsing ||
                  importRows.length === 0 ||
                  importErrors.length > 0
                }
              >
                {importing
                  ? "Mengupload..."
                  : `Upload ${importRows.length || ""} Kendaraan`.trim()}
              </button>
            </footer>
            </form>
          </section>
        </div>
      ) : null}

      {modalOpen ? (
        <div
          className="user-role-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) closeModal()
          }}
        >
          <section
            className="user-role-modal vehicle-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vehicle-modal-title"
          >
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">Master Kendaraan</p>
                <h3 id="vehicle-modal-title">
                  {editingId ? "Edit Kendaraan" : "Tambah Kendaraan"}
                </h3>
                <p>Lengkapi identitas dan status kendaraan operasional.</p>
              </div>

              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                aria-label="Tutup formulir"
              >
                ×
              </button>
            </header>

            <form onSubmit={handleSubmit}>
              <div className="user-role-form-grid vehicle-form-grid">
                {isSuperAdmin ? (
                  <div className="user-role-form-field full">
                    <label htmlFor="uker_id">Unit Kerja *</label>
                    <select
                      id="uker_id"
                      name="uker_id"
                      value={form.uker_id}
                      onChange={handleFormInput}
                      required
                    >
                      <option value="">Pilih unit kerja</option>
                      {ukers.map((uker) => (
                        <option key={uker.id} value={uker.id}>
                          {uker.codeuker} - {uker.nama_uker}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div className="user-role-form-field">
                  <label htmlFor="jenis_kendaraan">Jenis Kendaraan *</label>
                  <select
                    id="jenis_kendaraan"
                    name="jenis_kendaraan"
                    value={form.jenis_kendaraan}
                    onChange={handleFormInput}
                    required
                  >
                    {VEHICLE_TYPES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="status">Status *</label>
                  <select
                    id="status"
                    name="status"
                    value={form.status}
                    onChange={handleFormInput}
                    required
                  >
                    {VEHICLE_STATUSES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="merk_kendaraan">Merk Kendaraan *</label>
                  <input
                    id="merk_kendaraan"
                    name="merk_kendaraan"
                    value={form.merk_kendaraan}
                    onChange={handleFormInput}
                    maxLength={100}
                    placeholder="Contoh: Toyota Avanza"
                    required
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="nomor_kendaraan">Nomor Kendaraan *</label>
                  <input
                    id="nomor_kendaraan"
                    name="nomor_kendaraan"
                    value={form.nomor_kendaraan}
                    onChange={handleFormInput}
                    maxLength={20}
                    placeholder="Contoh: B 1234 XYZ"
                    required
                  />
                  <small>
                    Nomor kendaraan dibuat unik dan disimpan dengan huruf kapital.
                  </small>
                </div>
              </div>

              {modalError ? (
                <div className="user-role-alert error">
                  <strong>Data belum dapat disimpan</strong>
                  <span>{modalError}</span>
                </div>
              ) : null}

              <footer className="user-role-modal-footer">
                <button
                  type="button"
                  className="user-role-button secondary"
                  onClick={closeModal}
                  disabled={saving}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="user-role-button primary"
                  disabled={saving}
                >
                  {saving
                    ? "Menyimpan..."
                    : editingId
                      ? "Simpan Perubahan"
                      : "Tambah Kendaraan"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          className="user-role-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deleting) {
              closeDeleteModal()
            }
          }}
        >
          <section
            className="user-role-modal compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-vehicle-title"
          >
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">Konfirmasi</p>
                <h3 id="delete-vehicle-title">Hapus Kendaraan</h3>
                <p>Tindakan ini akan menghapus data secara permanen.</p>
              </div>

              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={deleting}
                aria-label="Tutup konfirmasi"
              >
                ×
              </button>
            </header>

            <div className="user-role-delete-content">
              <div className="user-role-delete-target">
                <span>Nomor Kendaraan</span>
                <strong>{deleteTarget.nomor_kendaraan}</strong>
                <small>
                  {deleteTarget.jenis_kendaraan} · {deleteTarget.merk_kendaraan}
                </small>
              </div>

              {deleteError ? (
                <div className="user-role-alert error">
                  <strong>Data belum dapat dihapus</strong>
                  <span>{deleteError}</span>
                </div>
              ) : null}
            </div>

            <footer className="user-role-modal-footer">
              <button
                type="button"
                className="user-role-button secondary"
                onClick={closeDeleteModal}
                disabled={deleting}
              >
                Batal
              </button>
              <button
                type="button"
                className="user-role-button danger"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Menghapus..." : "Hapus Kendaraan"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {toast.open ? (
        <div className={`user-role-toast ${toast.type}`} role="status">
          {toast.message}
        </div>
      ) : null}
    </div>
  )
}
