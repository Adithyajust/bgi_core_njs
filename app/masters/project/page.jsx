"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

const PROJECT_STATUSES = [
  { value: "PERENCANAAN", label: "Perencanaan" },
  { value: "BERJALAN", label: "Berjalan" },
  { value: "DITUNDA", label: "Ditunda" },
  { value: "SELESAI", label: "Selesai" },
  { value: "DIBATALKAN", label: "Dibatalkan" },
]

const EMPTY_PROJECT_FORM = {
  kode_project: "",
  nama_project: "",
  customer: "",
  lokasi: "",
  uker_id: "",
  project_manager: "",
  tanggal_mulai: "",
  tanggal_selesai: "",
  nilai_project: "",
  status_project: "PERENCANAAN",
  progress: "0",
  keterangan: "",
  is_active: true,
}

function mapProjectToForm(project) {
  return {
    kode_project: String(project?.kode_project || ""),
    nama_project: String(project?.nama_project || ""),
    customer: String(project?.customer || ""),
    lokasi: String(project?.lokasi || ""),
    uker_id: String(project?.uker_id || ""),
    project_manager: String(project?.project_manager || ""),
    tanggal_mulai: project?.tanggal_mulai
      ? String(project.tanggal_mulai).slice(0, 10)
      : "",
    tanggal_selesai: project?.tanggal_selesai
      ? String(project.tanggal_selesai).slice(0, 10)
      : "",
    nilai_project:
      project?.nilai_project === null || project?.nilai_project === undefined
        ? ""
        : String(project.nilai_project),
    status_project: String(project?.status_project || "PERENCANAAN"),
    progress: String(project?.progress ?? 0),
    keterangan: String(project?.keterangan || ""),
    is_active: Boolean(project?.is_active),
  }
}

function getStatusLabel(status) {
  return (
    PROJECT_STATUSES.find((item) => item.value === status)?.label ||
    status ||
    "-"
  )
}

function formatDate(value) {
  if (!value) return "-"

  const parts = String(value).slice(0, 10).split("-")
  if (parts.length !== 3) return "-"

  return `${parts[2]}/${parts[1]}/${parts[0]}`
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

function formatCurrency(value) {
  if (value === null || value === undefined || value === "") return "-"

  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return "-"

  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(numberValue)
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
    throw error
  }

  return result
}

function getErrorMessage(error, fallbackMessage) {
  return error instanceof Error ? error.message : fallbackMessage
}

function routeAuthorizationError(error, router) {
  if (error?.status === 401) {
    router.replace(`/login?next=${encodeURIComponent("/masters/project")}`)
    return true
  }

  if (error?.status === 403) {
    router.replace("/forbidden")
    return true
  }

  return false
}

export default function MasterProjectPage() {
  const router = useRouter()
  const toastTimerRef = useRef(null)

  const [projects, setProjects] = useState([])
  const [ukers, setUkers] = useState([])
  const [currentUser, setCurrentUser] = useState(null)
  const [scope, setScope] = useState(null)
  const [summary, setSummary] = useState({
    total: 0,
    active: 0,
    ongoing: 0,
    completed: 0,
  })
  const [pagination, setPagination] = useState({
    page: 1,
    page_size: 10,
    total_items: 0,
    total_pages: 1,
  })

  const [loadingReferences, setLoadingReferences] = useState(true)
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState("")

  const [searchText, setSearchText] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [ukerFilter, setUkerFilter] = useState("ALL")
  const [activeFilter, setActiveFilter] = useState("ALL")
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [refreshKey, setRefreshKey] = useState(0)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_PROJECT_FORM)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState("")

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
      setToast((currentToast) => ({ ...currentToast, open: false }))
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

    Promise.all([
      requestJson("/api/masters/uker", {
        method: "GET",
        signal: controller.signal,
      }),
      requestJson("/api/auth/me", {
        method: "GET",
        signal: controller.signal,
      }),
    ])
      .then(([ukerResult, userResult]) => {
        if (controller.signal.aborted) return

        setUkers(
          Array.isArray(ukerResult.data?.ukers) ? ukerResult.data.ukers : []
        )
        setCurrentUser(userResult.data || null)
      })
      .catch((error) => {
        if (error?.name === "AbortError" || controller.signal.aborted) return
        if (routeAuthorizationError(error, router)) return

        console.error("Gagal memuat referensi master project:", error)
        setLoadError(
          getErrorMessage(error, "Gagal mengambil data unit kerja dan pengguna.")
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
      page: String(currentPage),
      page_size: String(pageSize),
    })

    if (debouncedSearch) query.set("search", debouncedSearch)
    if (statusFilter !== "ALL") query.set("status_project", statusFilter)
    if (ukerFilter !== "ALL") query.set("uker_id", ukerFilter)
    if (activeFilter === "ACTIVE") query.set("is_active", "true")
    if (activeFilter === "INACTIVE") query.set("is_active", "false")

    setLoadingProjects(true)
    setLoadError("")

    requestJson(`/api/masters/project?${query.toString()}`, {
      method: "GET",
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return

        const resultPagination = result.data?.pagination || {}

        setProjects(
          Array.isArray(result.data?.projects) ? result.data.projects : []
        )
        setSummary({
          total: Number(result.data?.summary?.total || 0),
          active: Number(result.data?.summary?.active || 0),
          ongoing: Number(result.data?.summary?.ongoing || 0),
          completed: Number(result.data?.summary?.completed || 0),
        })
        setScope(result.data?.scope || null)
        setPagination({
          page: Number(resultPagination.page || 1),
          page_size: Number(resultPagination.page_size || pageSize),
          total_items: Number(resultPagination.total_items || 0),
          total_pages: Number(resultPagination.total_pages || 1),
        })

        if (
          resultPagination.page &&
          Number(resultPagination.page) !== currentPage
        ) {
          setCurrentPage(Number(resultPagination.page))
        }
      })
      .catch((error) => {
        if (error?.name === "AbortError" || controller.signal.aborted) return
        if (routeAuthorizationError(error, router)) return

        console.error("Gagal memuat master project:", error)
        setLoadError(getErrorMessage(error, "Gagal mengambil data project."))
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingProjects(false)
          setRefreshing(false)
        }
      })

    return () => controller.abort()
  }, [
    activeFilter,
    currentPage,
    debouncedSearch,
    pageSize,
    refreshKey,
    router,
    statusFilter,
    ukerFilter,
  ])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const overlayOpen = modalOpen || Boolean(deleteTarget)
    if (!overlayOpen) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    function handleEscape(event) {
      if (event.key !== "Escape" || saving || deleting) return

      if (deleteTarget) {
        setDeleteTarget(null)
        setDeleteError("")
      } else {
        setModalOpen(false)
        setEditingId(null)
        setForm(EMPTY_PROJECT_FORM)
        setModalError("")
      }
    }

    window.addEventListener("keydown", handleEscape)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleEscape)
    }
  }, [deleteTarget, deleting, modalOpen, saving])

  function resetFilters() {
    setSearchText("")
    setDebouncedSearch("")
    setStatusFilter("ALL")
    setUkerFilter("ALL")
    setActiveFilter("ALL")
    setCurrentPage(1)
  }

  function refreshProjects() {
    setRefreshing(true)
    setRefreshKey((value) => value + 1)
  }

  function openAddModal() {
    setEditingId(null)
    setForm({
      ...EMPTY_PROJECT_FORM,
      uker_id: ukers.length === 1 ? String(ukers[0].id) : "",
    })
    setModalError("")
    setModalOpen(true)
  }

  function openEditModal(project) {
    setEditingId(project.id)
    setForm(mapProjectToForm(project))
    setModalError("")
    setModalOpen(true)
  }

  function closeModal() {
    if (saving) return

    setModalOpen(false)
    setEditingId(null)
    setForm(EMPTY_PROJECT_FORM)
    setModalError("")
  }

  function handleFormInput(event) {
    const { name, type, checked, value } = event.target

    setForm((currentForm) => ({
      ...currentForm,
      [name]: type === "checkbox" ? checked : value,
    }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (saving) return

    const progressValue = Number(form.progress)
    const nilaiProjectValue =
      form.nilai_project === "" ? null : Number(form.nilai_project)

    if (!Number.isInteger(progressValue) || progressValue < 0 || progressValue > 100) {
      setModalError("Progress harus berupa bilangan bulat antara 0 sampai 100.")
      return
    }

    if (nilaiProjectValue !== null && (!Number.isFinite(nilaiProjectValue) || nilaiProjectValue < 0)) {
      setModalError("Nilai project tidak boleh negatif.")
      return
    }

    if (
      form.tanggal_mulai &&
      form.tanggal_selesai &&
      form.tanggal_selesai < form.tanggal_mulai
    ) {
      setModalError("Tanggal selesai tidak boleh lebih awal dari tanggal mulai.")
      return
    }

    const payload = {
      kode_project: form.kode_project.trim(),
      nama_project: form.nama_project.trim(),
      customer: form.customer.trim(),
      lokasi: form.lokasi.trim(),
      uker_id: form.uker_id,
      project_manager: form.project_manager.trim(),
      tanggal_mulai: form.tanggal_mulai,
      tanggal_selesai: form.tanggal_selesai,
      nilai_project: nilaiProjectValue,
      status_project: form.status_project,
      progress: progressValue,
      keterangan: form.keterangan.trim(),
      is_active: form.is_active,
    }

    if (editingId) payload.id = editingId

    try {
      setSaving(true)
      setModalError("")

      const result = await requestJson("/api/masters/project", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      setModalOpen(false)
      setEditingId(null)
      setForm(EMPTY_PROJECT_FORM)
      setModalError("")
      showToast("success", result.message)
      refreshProjects()
    } catch (error) {
      if (routeAuthorizationError(error, router)) return

      const message = getErrorMessage(
        error,
        editingId
          ? "Gagal memperbarui data project."
          : "Gagal menambahkan data project."
      )

      setModalError(message)
      showToast("error", message)
    } finally {
      setSaving(false)
    }
  }

  function openDeleteModal(project) {
    setDeleteTarget(project)
    setDeleteError("")
  }

  function closeDeleteModal() {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteError("")
  }

  async function handleDelete() {
    if (!deleteTarget || deleting) return

    try {
      setDeleting(true)
      setDeleteError("")

      const result = await requestJson("/api/masters/project", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      })

      setDeleteTarget(null)
      showToast("success", result.message)
      refreshProjects()
    } catch (error) {
      if (routeAuthorizationError(error, router)) return

      const message = getErrorMessage(error, "Gagal menghapus data project.")
      setDeleteError(message)
      showToast("error", message)
    } finally {
      setDeleting(false)
    }
  }

  const paginationPages = []
  const totalPages = Math.max(1, pagination.total_pages)
  let startPage = Math.max(1, pagination.page - 2)
  let endPage = Math.min(totalPages, startPage + 4)
  startPage = Math.max(1, endPage - 4)

  for (let page = startPage; page <= endPage; page += 1) {
    paginationPages.push(page)
  }

  return (
    <div className="simple-page user-role-page">
      <section className="page-heading-card user-role-heading">
        <div>
          <p className="eyebrow">Master Data</p>
          <h2>Master Project</h2>
          <p>
            Kelola identitas project, customer, lokasi, unit kerja, Project
            Manager, periode pelaksanaan, nilai, status, dan progress pekerjaan.
          </p>
        </div>

        <Link href="/masters" className="user-role-button secondary">
          Kembali
        </Link>
      </section>

      <section className="user-role-summary-grid">
        <article className="user-role-summary-card">
          <span>Total Project</span>
          <strong>{summary.total}</strong>
          <p>Seluruh project dalam akses Anda</p>
        </article>

        <article className="user-role-summary-card green">
          <span>Project Aktif</span>
          <strong>{summary.active}</strong>
          <p>Project yang masih diaktifkan</p>
        </article>

        <article className="user-role-summary-card orange">
          <span>Sedang Berjalan</span>
          <strong>{summary.ongoing}</strong>
          <p>Project berstatus berjalan</p>
        </article>

        <article className="user-role-summary-card green">
          <span>Project Selesai</span>
          <strong>{summary.completed}</strong>
          <p>Project yang telah diselesaikan</p>
        </article>
      </section>

      <section className="settings-card user-role-panel">
        <div className="user-role-toolbar">
          <div className="user-role-filters project-filters">
            <input
              type="search"
              value={searchText}
              onChange={(event) => {
                setSearchText(event.target.value)
                setCurrentPage(1)
              }}
              placeholder="Cari kode, nama project, customer, lokasi, atau Project Manager..."
              aria-label="Cari project"
            />

            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value)
                setCurrentPage(1)
              }}
              aria-label="Filter status project"
            >
              <option value="ALL">Semua Status Project</option>
              {PROJECT_STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>

            <select
              value={ukerFilter}
              onChange={(event) => {
                setUkerFilter(event.target.value)
                setCurrentPage(1)
              }}
              aria-label="Filter unit kerja"
              disabled={!isSuperAdmin && ukers.length <= 1}
            >
              <option value="ALL">Semua Unit Kerja</option>
              {ukers.map((uker) => (
                <option key={uker.id} value={uker.id}>
                  {uker.codeuker} - {uker.nama_uker}
                </option>
              ))}
            </select>

            <select
              value={activeFilter}
              onChange={(event) => {
                setActiveFilter(event.target.value)
                setCurrentPage(1)
              }}
              aria-label="Filter status aktif"
            >
              <option value="ALL">Semua Aktivasi</option>
              <option value="ACTIVE">Aktif</option>
              <option value="INACTIVE">Tidak Aktif</option>
            </select>
          </div>

          <div className="user-role-toolbar-actions">
            <button
              type="button"
              className="user-role-button secondary"
              onClick={resetFilters}
              disabled={
                !searchText &&
                statusFilter === "ALL" &&
                ukerFilter === "ALL" &&
                activeFilter === "ALL"
              }
            >
              Reset
            </button>

            <button
              type="button"
              className="user-role-button secondary"
              onClick={refreshProjects}
              disabled={loadingProjects || refreshing}
            >
              {refreshing ? "Memuat..." : "Refresh"}
            </button>

            {isSuperAdmin ? (
              <button
                type="button"
                className="user-role-button primary"
                onClick={openAddModal}
                disabled={loadingReferences || loadingProjects}
              >
                Tambah Project
              </button>
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
              Anda hanya dapat melihat project pada unit kerja yang terhubung
              dengan akun Anda.
            </span>
          </div>
        ) : null}

        <div className="user-role-table-wrapper">
          <table className="user-role-table project-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Customer / Lokasi</th>
                <th>Unit Kerja</th>
                <th>Project Manager</th>
                <th>Periode</th>
                <th>Nilai Project</th>
                <th>Status / Progress</th>
                <th>Aktivasi</th>
                <th>Diperbarui</th>
                <th>Aksi</th>
              </tr>
            </thead>

            <tbody>
              {loadingProjects ? (
                <tr>
                  <td colSpan={10} className="user-role-loading">
                    Memuat data project...
                  </td>
                </tr>
              ) : null}

              {!loadingProjects && projects.length === 0 ? (
                <tr>
                  <td colSpan={10} className="user-role-empty">
                    {summary.total === 0
                      ? "Belum ada data project."
                      : "Tidak ada project yang sesuai dengan filter."}
                  </td>
                </tr>
              ) : null}

              {!loadingProjects
                ? projects.map((project) => (
                    <tr key={project.id}>
                      <td>
                        <strong className="project-code">
                          {project.kode_project || "-"}
                        </strong>
                        <span className="project-cell-subtext">
                          {project.nama_project || "-"}
                        </span>
                      </td>

                      <td>
                        <strong>{project.customer || "-"}</strong>
                        <span className="project-cell-subtext">
                          {project.lokasi || "Lokasi belum diisi"}
                        </span>
                      </td>

                      <td>
                        <strong>{project.codeuker || "-"}</strong>
                        <span className="project-cell-subtext">
                          {project.nama_uker || "-"}
                        </span>
                      </td>

                      <td>{project.project_manager || "-"}</td>

                      <td>
                        <strong>{formatDate(project.tanggal_mulai)}</strong>
                        <span className="project-cell-subtext">
                          s.d. {formatDate(project.tanggal_selesai)}
                        </span>
                      </td>

                      <td className="project-currency">
                        {formatCurrency(project.nilai_project)}
                      </td>

                      <td>
                        <span
                          className={`project-status ${String(
                            project.status_project || ""
                          ).toLowerCase()}`}
                        >
                          {getStatusLabel(project.status_project)}
                        </span>

                        <div className="project-progress-row">
                          <div className="project-progress-track">
                            <span
                              style={{
                                width: `${Math.min(
                                  100,
                                  Math.max(0, Number(project.progress || 0))
                                )}%`,
                              }}
                            />
                          </div>
                          <strong>{Number(project.progress || 0)}%</strong>
                        </div>
                      </td>

                      <td>
                        <span
                          className={
                            project.is_active
                              ? "user-role-status active"
                              : "user-role-status inactive"
                          }
                        >
                          {project.is_active ? "Aktif" : "Tidak Aktif"}
                        </span>
                      </td>

                      <td>
                        {formatDateTime(project.updated_at || project.created_at)}
                      </td>

                      <td>
                        {isSuperAdmin ? (
                          <div className="user-role-actions project-actions">
                            <button
                              type="button"
                              className="edit"
                              onClick={() => openEditModal(project)}
                              disabled={saving || deleting}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="delete"
                              onClick={() => openDeleteModal(project)}
                              disabled={saving || deleting}
                            >
                              Hapus
                            </button>
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

        {!loadingProjects && pagination.total_items > 0 ? (
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
                    setCurrentPage(1)
                  }}
                  aria-label="Jumlah project per halaman"
                >
                  {[10, 25, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>

              <nav aria-label="Navigasi halaman project">
                <button
                  type="button"
                  onClick={() => setCurrentPage(1)}
                  disabled={pagination.page === 1}
                  title="Halaman pertama"
                >
                  «
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage(Math.max(1, pagination.page - 1))}
                  disabled={pagination.page === 1}
                  title="Halaman sebelumnya"
                >
                  ‹
                </button>

                {paginationPages.map((page) => (
                  <button
                    key={page}
                    type="button"
                    className={page === pagination.page ? "active" : ""}
                    onClick={() => setCurrentPage(page)}
                    aria-current={page === pagination.page ? "page" : undefined}
                  >
                    {page}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() =>
                    setCurrentPage(Math.min(totalPages, pagination.page + 1))
                  }
                  disabled={pagination.page === totalPages}
                  title="Halaman berikutnya"
                >
                  ›
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage(totalPages)}
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

      {toast.open ? (
        <div
          className={`user-role-toast ${toast.type === "error" ? "error" : ""}`}
          role="status"
          aria-live="polite"
        >
          <strong>{toast.type === "error" ? "Proses gagal" : "Berhasil"}</strong>
          <p>{toast.message}</p>
          <button
            type="button"
            onClick={() => setToast((current) => ({ ...current, open: false }))}
            aria-label="Tutup notifikasi"
          >
            ×
          </button>
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
            className="user-role-modal project-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-modal-title"
          >
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">Master Data</p>
                <h3 id="project-modal-title">
                  {editingId ? "Edit Project" : "Tambah Project"}
                </h3>
                <p>
                  Project Manager diisi sebagai teks dan tidak terhubung dengan
                  tabel pegawai.
                </p>
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
              <div className="user-role-form-grid">
                <div className="user-role-form-field">
                  <label htmlFor="kode_project">Kode Project *</label>
                  <input
                    id="kode_project"
                    name="kode_project"
                    value={form.kode_project}
                    onChange={handleFormInput}
                    maxLength={30}
                    placeholder="Contoh: PRJ-2026-001"
                    autoComplete="off"
                    required
                    autoFocus
                  />
                  <small>Maksimal 30 karakter dan harus unik.</small>
                </div>

                <div className="user-role-form-field">
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

                <div className="user-role-form-field full">
                  <label htmlFor="nama_project">Nama Project *</label>
                  <input
                    id="nama_project"
                    name="nama_project"
                    value={form.nama_project}
                    onChange={handleFormInput}
                    maxLength={150}
                    placeholder="Nama lengkap project"
                    required
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="customer">Customer</label>
                  <input
                    id="customer"
                    name="customer"
                    value={form.customer}
                    onChange={handleFormInput}
                    maxLength={150}
                    placeholder="Nama customer"
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="lokasi">Lokasi</label>
                  <input
                    id="lokasi"
                    name="lokasi"
                    value={form.lokasi}
                    onChange={handleFormInput}
                    maxLength={255}
                    placeholder="Lokasi pelaksanaan project"
                  />
                </div>

                <div className="user-role-form-field full">
                  <label htmlFor="project_manager">Project Manager</label>
                  <input
                    id="project_manager"
                    name="project_manager"
                    value={form.project_manager}
                    onChange={handleFormInput}
                    maxLength={150}
                    placeholder="Ketik nama Project Manager"
                  />
                  <small>
                    Input teks bebas. Tidak mengambil data dari master pegawai.
                  </small>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="tanggal_mulai">Tanggal Mulai</label>
                  <input
                    id="tanggal_mulai"
                    name="tanggal_mulai"
                    type="date"
                    value={form.tanggal_mulai}
                    onChange={handleFormInput}
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="tanggal_selesai">Tanggal Selesai</label>
                  <input
                    id="tanggal_selesai"
                    name="tanggal_selesai"
                    type="date"
                    value={form.tanggal_selesai}
                    min={form.tanggal_mulai || undefined}
                    onChange={handleFormInput}
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="nilai_project">Nilai Project</label>
                  <input
                    id="nilai_project"
                    name="nilai_project"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.nilai_project}
                    onChange={handleFormInput}
                    placeholder="0"
                  />
                  <small>Masukkan angka tanpa tanda pemisah ribuan.</small>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="status_project">Status Project *</label>
                  <select
                    id="status_project"
                    name="status_project"
                    value={form.status_project}
                    onChange={handleFormInput}
                    required
                  >
                    {PROJECT_STATUSES.map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="user-role-form-field full">
                  <label htmlFor="progress">Progress: {form.progress || 0}%</label>
                  <input
                    id="progress"
                    name="progress"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={form.progress}
                    onChange={handleFormInput}
                    className="project-progress-input"
                  />
                </div>

                <div className="user-role-form-field full">
                  <label htmlFor="keterangan">Keterangan</label>
                  <textarea
                    id="keterangan"
                    name="keterangan"
                    value={form.keterangan}
                    onChange={handleFormInput}
                    maxLength={500}
                    rows={4}
                    placeholder="Catatan tambahan project"
                  />
                  <small>{form.keterangan.length}/500 karakter</small>
                </div>

                <label className="user-role-toggle-field full">
                  <input
                    type="checkbox"
                    name="is_active"
                    checked={form.is_active}
                    onChange={handleFormInput}
                  />
                  <span>
                    <strong>Project aktif</strong>
                    <small>
                      Nonaktifkan apabila project tidak lagi digunakan dalam
                      proses operasional.
                    </small>
                  </span>
                </label>
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
                      : "Tambah Project"}
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
            aria-labelledby="delete-project-title"
          >
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">Konfirmasi</p>
                <h3 id="delete-project-title">Hapus Project</h3>
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
                <span>Kode Project</span>
                <strong>{deleteTarget.kode_project}</strong>
                <small>{deleteTarget.nama_project}</small>
              </div>

              <p className="user-role-delete-warning">
                Pastikan project ini tidak lagi dibutuhkan. Data yang sudah
                dihapus tidak dapat dikembalikan melalui halaman ini.
              </p>

              {deleteError ? (
                <div className="user-role-alert error">
                  <strong>Project gagal dihapus</strong>
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
                {deleting ? "Menghapus..." : "Hapus Project"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  )
}
