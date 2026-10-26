"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useAppBootstrap } from "@/components/app-bootstrap-context"

const JABATAN_OPTIONS = [
  "Superadmin",
  "Pinca",
  "Manager Operasional",
  "Asisten Manager CRO",
  "Asisten Manager CPC",
  "Teknisi",
  "Internal Control",
  "General Affair",
  "Custody",
  "Driver",
  "CPC",
  "Project Manager"
]

const EMPTY_PEGAWAI_FORM = {
  nip: "",
  ktp: "",
  nama: "",
  alamat: "",
  jabatan: "",
  handphone: "",
  email: "",
  status: true,
  status_peg: "",
  tgl_lahir: "",
  tgl_job: "",
  foto: "",
  uker_id: "",
  row_version: "",
}

const PEGAWAI_PHOTO_MAX_BYTES = 2 * 1024 * 1024
const PEGAWAI_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"]

function mapPegawaiToForm(pegawai) {
  return {
    nip: String(pegawai?.nip || ""),
    ktp: String(pegawai?.ktp || ""),
    nama: String(pegawai?.nama || ""),
    alamat: String(pegawai?.alamat || ""),
    jabatan: String(pegawai?.jabatan || ""),
    handphone: String(pegawai?.handphone || ""),
    email: String(pegawai?.email || ""),
    status: Boolean(pegawai?.status),
    status_peg: String(pegawai?.status_peg || ""),
    tgl_lahir: pegawai?.tgl_lahir ? String(pegawai.tgl_lahir).slice(0, 10) : "",
    tgl_job: pegawai?.tgl_job ? String(pegawai.tgl_job).slice(0, 10) : "",
    foto: String(pegawai?.foto || ""),
    uker_id: String(pegawai?.uker_id || ""),
    row_version: String(pegawai?.row_version || ""),
  }
}

function PegawaiAvatar({ name, src, className = "" }) {
  const initial = String(name || "P").charAt(0).toUpperCase()

  return (
    <div className={`user-role-avatar ${className}`.trim()}>
      {initial}

      {src ? (
        <span
          className="pegawai-avatar-photo"
          role="img"
          aria-label={`Foto ${name || "pegawai"}`}
          style={{ backgroundImage: `url(${JSON.stringify(src)})` }}
        />
      ) : null}
    </div>
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

async function fetchInitialData({
  signal,
  page,
  pageSize,
  search,
  ukerFilter,
  statusFilter,
}) {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  })

  if (search) params.set("search", search)
  if (ukerFilter !== "ALL") params.set("uker_id", ukerFilter)
  if (statusFilter !== "ALL") params.set("status", statusFilter)

  const [pegawaiResult, ukerResult] = await Promise.all([
    requestJson(`/api/masters/pegawai?${params.toString()}`, {
      method: "GET",
      signal,
    }),
    requestJson("/api/masters/uker?mode=options", {
      method: "GET",
      signal,
    }),
  ])

  return {
    pegawai: Array.isArray(pegawaiResult.data?.pegawai)
      ? pegawaiResult.data.pegawai
      : [],
    pagination: pegawaiResult.data?.pagination || {
      page,
      page_size: pageSize,
      total: 0,
      total_pages: 1,
    },
    summary: pegawaiResult.data?.summary || {
      total: 0,
      active: 0,
      linked: 0,
      withoutEmail: 0,
    },
    ukers: Array.isArray(ukerResult.data?.ukers) ? ukerResult.data.ukers : [],
  }
}

async function savePegawai(payload, editingId = null) {
  if (editingId) {
    payload.set("id", String(editingId))
  }

  return requestJson("/api/masters/pegawai", {
    method: editingId ? "PUT" : "POST",
    body: payload,
  })
}

async function deletePegawai(id, deleteLinkedUser = false) {
  return requestJson("/api/masters/pegawai", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      delete_linked_user: deleteLinkedUser,
    }),
  })
}

function getErrorMessage(error, fallbackMessage) {
  return error instanceof Error ? error.message : fallbackMessage
}

export default function MasterPegawaiPage() {
  const router = useRouter()
  const { user: currentUser } = useAppBootstrap()
  const toastTimerRef = useRef(null)
  const photoInputRef = useRef(null)
  const photoObjectUrlRef = useRef(null)

  const [pegawai, setPegawai] = useState([])
  const [ukers, setUkers] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState("")

  const [searchText, setSearchText] = useState("")
  const [ukerFilter, setUkerFilter] = useState("ALL")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [debouncedSearchText, setDebouncedSearchText] = useState("")
  const [pagination, setPagination] = useState({
    page: 1,
    page_size: 10,
    total: 0,
    total_pages: 1,
  })
  const [summary, setSummary] = useState({
    total: 0,
    active: 0,
    linked: 0,
    withoutEmail: 0,
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_PEGAWAI_FORM)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState("")
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState("")
  const [removePhoto, setRemovePhoto] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState("")
  const [deleteLinkedUser, setDeleteLinkedUser] = useState(false)

  const [toast, setToast] = useState({
    open: false,
    type: "success",
    message: "",
  })

  const isSuperAdmin = currentUser?.roleCode === "SUPER_ADMIN"

  function releasePhotoObjectUrl() {
    if (photoObjectUrlRef.current) {
      URL.revokeObjectURL(photoObjectUrlRef.current)
      photoObjectUrlRef.current = null
    }
  }

  function resetPhotoEditor(photoPath = "") {
    releasePhotoObjectUrl()
    setPhotoFile(null)
    setPhotoPreview(photoPath)
    setRemovePhoto(false)

    if (photoInputRef.current) {
      photoInputRef.current.value = ""
    }
  }

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

  async function loadData({ signal, isRefresh = false } = {}) {
    try {
      if (isRefresh) setRefreshing(true)
      else setLoading(true)

      setLoadError("")

      const loadedData = await fetchInitialData({
        signal,
        page: currentPage,
        pageSize,
        search: debouncedSearchText,
        ukerFilter,
        statusFilter,
      })

      setPegawai(loadedData.pegawai)
      setUkers(loadedData.ukers)
      setPagination(loadedData.pagination)
      setSummary(loadedData.summary)

      if (loadedData.pagination.page > loadedData.pagination.total_pages) {
        setCurrentPage(loadedData.pagination.total_pages)
      }
    } catch (error) {
      if (error?.name === "AbortError") return

      if (error?.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/masters/pegawai")}`)
        return
      }

      if (error?.status === 403) {
        router.replace("/forbidden")
        return
      }

      console.error("Gagal memuat master pegawai:", error)
      setLoadError(getErrorMessage(error, "Gagal mengambil data pegawai."))
    } finally {
      if (!signal?.aborted) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchText(searchText.trim())
    }, 350)

    return () => window.clearTimeout(timer)
  }, [searchText])

  useEffect(() => {
    const controller = new AbortController()

    fetchInitialData({
      signal: controller.signal,
      page: currentPage,
      pageSize,
      search: debouncedSearchText,
      ukerFilter,
      statusFilter,
    })
      .then((loadedData) => {
        if (controller.signal.aborted) return
        setPegawai(loadedData.pegawai)
        setUkers(loadedData.ukers)
        setPagination(loadedData.pagination)
        setSummary(loadedData.summary)
        if (currentPage > Number(loadedData.pagination.total_pages || 1)) {
          setCurrentPage(Math.max(1, Number(loadedData.pagination.total_pages || 1)))
        }
        setLoadError("")
      })
      .catch((error) => {
        if (error?.name === "AbortError" || controller.signal.aborted) return
        if (error?.status === 401) {
          router.replace(`/login?next=${encodeURIComponent("/masters/pegawai")}`)
          return
        }
        if (error?.status === 403) {
          router.replace("/forbidden")
          return
        }
        console.error("Gagal memuat master pegawai:", error)
        setLoadError(getErrorMessage(error, "Gagal mengambil data pegawai."))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [currentPage, debouncedSearchText, pageSize, router, statusFilter, ukerFilter])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
      if (photoObjectUrlRef.current) {
        URL.revokeObjectURL(photoObjectUrlRef.current)
      }
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
        if (photoObjectUrlRef.current) {
          URL.revokeObjectURL(photoObjectUrlRef.current)
          photoObjectUrlRef.current = null
        }

        setModalOpen(false)
        setEditingId(null)
        setForm(EMPTY_PEGAWAI_FORM)
        setPhotoFile(null)
        setPhotoPreview("")
        setRemovePhoto(false)
        setModalError("")
      }
    }

    window.addEventListener("keydown", handleEscape)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleEscape)
    }
  }, [deleteTarget, deleting, modalOpen, saving])

  const filteredPegawai = pegawai
  const paginatedPegawai = pegawai
  const totalPages = Math.max(1, Number(pagination.total_pages || 1))
  const activePage = Math.min(currentPage, totalPages)

  const paginationPages = useMemo(() => {
    const visiblePageCount = 5
    let startPage = Math.max(1, activePage - 2)
    let endPage = Math.min(totalPages, startPage + visiblePageCount - 1)
    startPage = Math.max(1, endPage - visiblePageCount + 1)

    return Array.from(
      { length: endPage - startPage + 1 },
      (_, index) => startPage + index
    )
  }, [activePage, totalPages])

  function resetFilters() {
    setSearchText("")
    setUkerFilter("ALL")
    setStatusFilter("ALL")
    setCurrentPage(1)
  }

  function openAddModal() {
    setEditingId(null)
    setForm({
      ...EMPTY_PEGAWAI_FORM,
      uker_id: ukers.length === 1 ? String(ukers[0].id) : "",
    })
    resetPhotoEditor()
    setModalError("")
    setModalOpen(true)
  }

  function openEditModal(item) {
    setEditingId(item.id)
    setForm(mapPegawaiToForm(item))
    resetPhotoEditor(String(item.foto || ""))
    setModalError("")
    setModalOpen(true)
  }

  function closeModal() {
    if (saving) return

    setModalOpen(false)
    setEditingId(null)
    setForm(EMPTY_PEGAWAI_FORM)
    resetPhotoEditor()
    setModalError("")
  }

  function handleFormInput(event) {
    const { name, type, checked, value } = event.target

    setForm((currentForm) => ({
      ...currentForm,
      [name]: type === "checkbox" ? checked : value,
    }))
  }

  function handlePhotoInput(event) {
    const selectedFile = event.target.files?.[0]

    if (!selectedFile) return

    if (!PEGAWAI_PHOTO_TYPES.includes(selectedFile.type)) {
      setModalError("Format foto harus JPG, PNG, atau WebP.")
      event.target.value = ""
      return
    }

    if (selectedFile.size > PEGAWAI_PHOTO_MAX_BYTES) {
      setModalError("Ukuran foto maksimal 2 MB.")
      event.target.value = ""
      return
    }

    releasePhotoObjectUrl()

    const objectUrl = URL.createObjectURL(selectedFile)
    photoObjectUrlRef.current = objectUrl
    setPhotoFile(selectedFile)
    setPhotoPreview(objectUrl)
    setRemovePhoto(false)
    setModalError("")
  }

  function handleRemovePhoto() {
    releasePhotoObjectUrl()
    setPhotoFile(null)
    setPhotoPreview("")
    setRemovePhoto(Boolean(form.foto))
    setModalError("")

    if (photoInputRef.current) {
      photoInputRef.current.value = ""
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (saving) return

    try {
      setSaving(true)
      setModalError("")

      const payload = new FormData()
      payload.set("nip", form.nip.trim())
      payload.set("ktp", form.ktp.trim())
      payload.set("nama", form.nama.trim())
      payload.set("alamat", form.alamat.trim())
      payload.set("jabatan", form.jabatan.trim())
      payload.set("handphone", form.handphone.trim())
      payload.set("email", form.email.trim())
      payload.set("status", String(form.status))
      payload.set("status_peg", form.status_peg.trim())
      payload.set("tgl_lahir", form.tgl_lahir)
      payload.set("tgl_job", form.tgl_job)
      payload.set("uker_id", form.uker_id)
      if (editingId) payload.set("row_version", form.row_version)
      payload.set("remove_photo", String(removePhoto))

      if (photoFile) {
        payload.set("foto_file", photoFile, photoFile.name)
      }

      const result = await savePegawai(payload, editingId)

      setModalOpen(false)
      setEditingId(null)
      setForm(EMPTY_PEGAWAI_FORM)
      resetPhotoEditor()
      setModalError("")
      showToast("success", result.message)
      await loadData({ isRefresh: true })
    } catch (error) {
      if (error?.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/masters/pegawai")}`)
        return
      }

      if (error?.status === 403) {
        router.replace("/forbidden")
        return
      }

      const message = getErrorMessage(
        error,
        editingId
          ? "Gagal memperbarui data pegawai."
          : "Gagal menambahkan data pegawai."
      )

      setModalError(message)
      showToast("error", message)
    } finally {
      setSaving(false)
    }
  }

  function openDeleteModal(item) {
    setDeleteTarget(item)
    setDeleteError("")
    setDeleteLinkedUser(false)
  }

  function closeDeleteModal() {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteError("")
    setDeleteLinkedUser(false)
  }

  async function handleDelete() {
    if (!deleteTarget || deleting) return

    try {
      setDeleting(true)
      setDeleteError("")

      const result = await deletePegawai(
        deleteTarget.id,
        Boolean(deleteTarget.user_id) && deleteLinkedUser
      )
      setDeleteTarget(null)
      setDeleteLinkedUser(false)
      showToast("success", result.message)
      await loadData({ isRefresh: true })
    } catch (error) {
      if (error?.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/masters/pegawai")}`)
        return
      }

      if (error?.status === 403) {
        router.replace("/forbidden")
        return
      }

      const message = getErrorMessage(error, "Gagal menghapus data pegawai.")
      setDeleteError(message)
      showToast("error", message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="simple-page user-role-page">
      <section className="page-heading-card user-role-heading">
        <div>
          <p className="eyebrow">
            Master Data
          </p>

          <h2>
            Master Pegawai
          </h2>

          <p>
            Kelola identitas pegawai, unit kerja,
            jabatan, kontak, status kepegawaian,
            dan relasi akun aplikasi.
          </p>
        </div>

        <Link
          href="/masters"
          className="user-role-button secondary"
        >
          Kembali
        </Link>
      </section>

      <section className="user-role-summary-grid">
        <article className="user-role-summary-card">
          <span>
            Total Pegawai
          </span>

          <strong>
            {summary.total}
          </strong>

          <p>
            Seluruh pegawai terdaftar
          </p>
        </article>

        <article className="user-role-summary-card green">
          <span>
            Pegawai Aktif
          </span>

          <strong>
            {summary.active}
          </strong>

          <p>
            Pegawai dengan status aktif
          </p>
        </article>

        <article className="user-role-summary-card orange">
          <span>
            Memiliki Akun
          </span>

          <strong>
            {summary.linked}
          </strong>

          <p>
            Terhubung dengan akun user
          </p>
        </article>

        <article className="user-role-summary-card red">
          <span>
            Tanpa Email
          </span>

          <strong>
            {summary.withoutEmail}
          </strong>

          <p>
            Data email belum dilengkapi
          </p>
        </article>
      </section>

      <section className="settings-card user-role-panel">
        <div className="user-role-toolbar">
          <div className="user-role-filters">
            <input
              type="search"
              value={searchText}
              onChange={(event) => {
                setSearchText(
                  event.target.value
                )
                setCurrentPage(1)
              }}
              placeholder="Cari NIP, KTP, nama, alamat, jabatan, email, unit kerja, atau username..."
              aria-label="Cari pegawai"
            />

            <select
              value={ukerFilter}
              onChange={(event) => {
                setUkerFilter(
                  event.target.value
                )
                setCurrentPage(1)
              }}
              aria-label="Filter unit kerja"
            >
              <option value="ALL">
                Semua Unit Kerja
              </option>

              {ukers.map((uker) => (
                <option
                  key={uker.id}
                  value={uker.id}
                >
                  {uker.codeuker} - {uker.nama_uker}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(
                  event.target.value
                )
                setCurrentPage(1)
              }}
              aria-label="Filter status pegawai"
            >
              <option value="ALL">
                Semua Status
              </option>
              <option value="ACTIVE">
                Aktif
              </option>
              <option value="INACTIVE">
                Tidak Aktif
              </option>
            </select>
          </div>

          <div className="user-role-toolbar-actions">
            <button
              type="button"
              className="user-role-button secondary"
              onClick={resetFilters}
              disabled={
                !searchText &&
                ukerFilter === "ALL" &&
                statusFilter === "ALL"
              }
            >
              Reset
            </button>

            <button
              type="button"
              className="user-role-button secondary"
              onClick={() =>
                loadData({
                  isRefresh: true,
                })
              }
              disabled={
                loading || refreshing
              }
            >
              {refreshing
                ? "Memuat..."
                : "Refresh"}
            </button>

            {isSuperAdmin ? (
              <button
                type="button"
                className="user-role-button primary"
                onClick={openAddModal}
                disabled={loading || refreshing}
              >
                Tambah Pegawai
              </button>
            ) : null}
          </div>
        </div>

        {loadError ? (
          <div className="user-role-alert error">
            <strong>
              Data gagal dimuat
            </strong>

            <span>
              {loadError}
            </span>
          </div>
        ) : null}

        <div className="user-role-table-wrapper">
          <table className="user-role-table">
            <thead>
              <tr>
                <th>NIP / KTP</th>
                <th>Pegawai</th>
                <th>Unit Kerja</th>
                <th>Jabatan</th>
                <th>Kontak</th>
                <th>Status</th>
                <th>Akun User</th>
                <th>Diperbarui</th>
                <th>Aksi</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={9}
                    className="user-role-loading"
                  >
                    Memuat data pegawai...
                  </td>
                </tr>
              ) : null}

              {!loading &&
              filteredPegawai.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="user-role-empty"
                  >
                    {summary.total === 0
                      ? "Belum ada data pegawai."
                      : "Tidak ada data yang sesuai dengan pencarian."}
                  </td>
                </tr>
              ) : null}

              {!loading
                ? paginatedPegawai.map(
                    (item) => (
                      <tr key={item.id}>
                        <td>
                          <strong className="uker-code-value">
                            {item.nip || "-"}
                          </strong>
                          <small className="pegawai-identity-subtext">
                            KTP: {item.ktp || "-"}
                          </small>
                        </td>

                        <td>
                          <div className="user-role-user-cell">
                            <PegawaiAvatar
                              key={`${item.id}-${item.foto || "tanpa-foto"}`}
                              name={item.nama}
                              src={item.foto}
                            />

                            <div>
                              <strong>
                                {item.nama || "-"}
                              </strong>

                              <span>
                                {item.status_peg ||
                                  "Status kepegawaian belum diisi"}
                              </span>

                              <small>
                                Mulai kerja: {formatDate(item.tgl_job)}
                              </small>

                              <small title={item.alamat || ""}>
                                Alamat: {item.alamat || "-"}
                              </small>
                            </div>
                          </div>
                        </td>

                        <td>
                          <strong>
                            {item.codeuker || "-"}
                          </strong>

                          <div
                            style={{
                              marginTop: "4px",
                              color: "var(--muted)",
                              fontSize: "12px",
                            }}
                          >
                            {item.nama_uker || "-"}
                          </div>
                        </td>

                        <td>
                          {item.jabatan || "-"}
                        </td>

                        <td>
                          <strong>
                            {item.handphone || "-"}
                          </strong>

                          <div
                            style={{
                              marginTop: "4px",
                              color: "var(--muted)",
                              fontSize: "12px",
                            }}
                          >
                            {item.email || "-"}
                          </div>
                        </td>

                        <td>
                          <span
                            className={
                              item.status
                                ? "user-role-status active"
                                : "user-role-status inactive"
                            }
                          >
                            {item.status
                              ? "Aktif"
                              : "Tidak Aktif"}
                          </span>
                        </td>

                        <td>
                          {item.user_id ? (
                            <div>
                              <strong>
                                @{item.username}
                              </strong>

                              <div
                                style={{
                                  marginTop: "4px",
                                  color: "var(--muted)",
                                  fontSize: "12px",
                                }}
                              >
                                {item.role_name ||
                                  "Role tidak tersedia"}
                              </div>
                            </div>
                          ) : (
                            <span className="user-role-status inactive">
                              Belum terhubung
                            </span>
                          )}
                        </td>

                        <td>
                          {formatDateTime(
                            item.updated_at ||
                              item.created_at
                          )}
                        </td>

                        <td className="uker-action-cell">
                          <div className="uker-action-buttons">
                            {isSuperAdmin ? (
                              <>
                                <button
                                  type="button"
                                  className="uker-edit-button"
                                  onClick={() =>
                                    openEditModal(item)
                                  }
                                  disabled={saving || deleting}
                                  aria-label={`Edit pegawai ${
                                    item.nama || item.nip || ""
                                  }`}
                                  title="Edit pegawai"
                                >
                                  Edit
                                </button>

                                <button
                                  type="button"
                                  className="uker-delete-button"
                                  onClick={() =>
                                    openDeleteModal(item)
                                  }
                                  disabled={
                                    saving ||
                                    deleting ||
                                    Number(item.user_id) === Number(currentUser?.id)
                                  }
                                  aria-label={`Hapus pegawai ${
                                    item.nama || item.nip || ""
                                  }`}
                                  title={
                                    Number(item.user_id) === Number(currentUser?.id)
                                      ? "Pegawai yang terhubung dengan akun Anda tidak dapat dihapus."
                                      : item.user_id
                                        ? "Hapus pegawai beserta akun user terkait"
                                        : "Hapus pegawai"
                                  }
                                >
                                  Hapus
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  )
                : null}
            </tbody>
          </table>
        </div>

        {!loading &&
        pegawai.length > 0 ? (
          <div
            className="user-role-pagination"
            style={{ justifyContent: "flex-end" }}
          >
            <div className="user-role-pagination-controls">
              <label className="user-role-page-size">
                <span>Baris</span>
                <select
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(
                      Number(
                        event.target.value
                      )
                    )
                    setCurrentPage(1)
                  }}
                  aria-label="Jumlah baris per halaman"
                >
                  {[10, 25, 50].map(
                    (size) => (
                      <option
                        key={size}
                        value={size}
                      >
                        {size}
                      </option>
                    )
                  )}
                </select>
              </label>

              <nav
                className="user-role-page-buttons"
                aria-label="Navigasi halaman pegawai"
              >
                <button
                  type="button"
                  onClick={() =>
                    setCurrentPage(1)
                  }
                  disabled={activePage === 1}
                  aria-label="Halaman pertama"
                  title="Halaman pertama"
                >
                  «
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setCurrentPage(
                      Math.max(
                        1,
                        activePage - 1
                      )
                    )
                  }
                  disabled={activePage === 1}
                  aria-label="Halaman sebelumnya"
                  title="Halaman sebelumnya"
                >
                  ‹
                </button>

                {paginationPages.map(
                  (page) => (
                    <button
                      key={page}
                      type="button"
                      className={
                        page === activePage
                          ? "active"
                          : ""
                      }
                      onClick={() =>
                        setCurrentPage(page)
                      }
                      aria-current={
                        page === activePage
                          ? "page"
                          : undefined
                      }
                    >
                      {page}
                    </button>
                  )
                )}

                <button
                  type="button"
                  onClick={() =>
                    setCurrentPage(
                      Math.min(
                        totalPages,
                        activePage + 1
                      )
                    )
                  }
                  disabled={
                    activePage === totalPages
                  }
                  aria-label="Halaman berikutnya"
                  title="Halaman berikutnya"
                >
                  ›
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setCurrentPage(totalPages)
                  }
                  disabled={
                    activePage === totalPages
                  }
                  aria-label="Halaman terakhir"
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
          className={`user-role-toast ${
            toast.type === "error"
              ? "error"
              : ""
          }`}
          role="status"
          aria-live="polite"
        >
          <strong>
            {toast.type === "error"
              ? "Proses gagal"
              : "Berhasil"}
          </strong>

          <p>{toast.message}</p>
        </div>
      ) : null}

      {modalOpen ? (
        <div
          className="user-role-modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target ===
                event.currentTarget &&
              !saving
            ) {
              closeModal()
            }
          }}
        >
          <section
            className="user-role-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pegawai-modal-title"
          >
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">
                  Master Data
                </p>

                <h3 id="pegawai-modal-title">
                  {editingId
                    ? "Edit Pegawai"
                    : "Tambah Pegawai"}
                </h3>

                <p>
                  {editingId
                    ? "Perbarui data pegawai. Kolom bertanda wajib harus diisi."
                    : "Isi data utama pegawai. Kolom bertanda wajib harus diisi."}
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
                  <label htmlFor="nip">
                    NIP *
                  </label>

                  <input
                    id="nip"
                    name="nip"
                    value={form.nip}
                    onChange={handleFormInput}
                    maxLength={50}
                    placeholder="Nomor induk pegawai"
                    autoComplete="off"
                    required
                    autoFocus
                  />

                  <small>
                    Maksimal 50 karakter dan harus unik.
                  </small>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="ktp">
                    Nomor KTP *
                  </label>

                  <input
                    id="ktp"
                    name="ktp"
                    value={form.ktp}
                    onChange={handleFormInput}
                    maxLength={16}
                    minLength={16}
                    inputMode="numeric"
                    pattern="[0-9]{16}"
                    placeholder="16 digit nomor KTP"
                    autoComplete="off"
                    required
                  />

                  <small>
                    Wajib 16 digit angka dan harus unik.
                  </small>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="nama">
                    Nama Pegawai *
                  </label>

                  <input
                    id="nama"
                    name="nama"
                    value={form.nama}
                    onChange={handleFormInput}
                    maxLength={100}
                    placeholder="Nama lengkap pegawai"
                    required
                  />
                </div>

                <div className="user-role-form-field full">
                  <label htmlFor="alamat">
                    Alamat Pegawai *
                  </label>

                  <textarea
                    id="alamat"
                    name="alamat"
                    value={form.alamat}
                    onChange={handleFormInput}
                    maxLength={255}
                    rows={3}
                    placeholder="Masukkan alamat lengkap pegawai"
                    required
                  />

                  <small>
                    Wajib diisi. Maksimal 255 karakter.
                  </small>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="uker_id">
                    Unit Kerja *
                  </label>

                  <select
                    id="uker_id"
                    name="uker_id"
                    value={form.uker_id}
                    onChange={handleFormInput}
                    required
                  >
                    <option value="">
                      Pilih unit kerja
                    </option>

                    {ukers.map((uker) => (
                      <option
                        key={uker.id}
                        value={uker.id}
                      >
                        {uker.codeuker} - {uker.nama_uker}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="jabatan">
                    Jabatan
                  </label>

                  <select
                    id="jabatan"
                    name="jabatan"
                    value={form.jabatan}
                    onChange={handleFormInput}
                  >
                    <option value="">
                      Pilih jabatan
                    </option>

                    {JABATAN_OPTIONS.map((jabatan) => (
                      <option key={jabatan} value={jabatan}>
                        {jabatan}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="status_peg">
                    Status Kepegawaian
                  </label>

                  <select
                    id="status_peg"
                    name="status_peg"
                    value={form.status_peg}
                    onChange={handleFormInput}
                  >
                    <option value="">
                      Pilih status kepegawaian
                    </option>
                    <option value="TETAP">
                      Tetap
                    </option>
                    <option value="KONTRAK">
                      Kontrak
                    </option>
                    <option value="MAGANG">
                      Magang
                    </option>
                    <option value="OUTSOURCING">
                      Outsourcing
                    </option>
                  </select>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="handphone">
                    Nomor Handphone
                  </label>

                  <input
                    id="handphone"
                    name="handphone"
                    value={form.handphone}
                    onChange={handleFormInput}
                    maxLength={30}
                    placeholder="Nomor handphone"
                    inputMode="tel"
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="email">
                    Email
                  </label>

                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={handleFormInput}
                    maxLength={150}
                    placeholder="pegawai@perusahaan.co.id"
                  />

                  <small>
                    Otomatis disalin ke akun user yang terhubung.
                  </small>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="tgl_lahir">
                    Tanggal Lahir
                  </label>

                  <input
                    id="tgl_lahir"
                    name="tgl_lahir"
                    type="date"
                    value={form.tgl_lahir}
                    onChange={handleFormInput}
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="tgl_job">
                    Tanggal Mulai Bekerja
                  </label>

                  <input
                    id="tgl_job"
                    name="tgl_job"
                    type="date"
                    value={form.tgl_job}
                    onChange={handleFormInput}
                  />
                </div>

                <div className="pegawai-photo-upload">
                  <div className="pegawai-photo-preview-shell">
                    <PegawaiAvatar
                      key={photoPreview || "tanpa-preview"}
                      name={form.nama}
                      src={photoPreview}
                      className="pegawai-photo-preview"
                    />
                  </div>

                  <div className="pegawai-photo-controls">
                    <div>
                      <strong>Foto Pegawai</strong>
                      <p>
                        Gunakan foto JPG, PNG, atau WebP. Ukuran maksimal 2 MB.
                      </p>
                    </div>

                    <div className="pegawai-photo-actions">
                      <label
                        htmlFor="foto_file"
                        className="pegawai-photo-select-button"
                      >
                        {photoPreview ? "Ganti Foto" : "Pilih Foto"}
                      </label>

                      <input
                        ref={photoInputRef}
                        id="foto_file"
                        name="foto_file"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={handlePhotoInput}
                        disabled={saving}
                      />

                      {photoPreview ? (
                        <button
                          type="button"
                          className="pegawai-photo-remove-button"
                          onClick={handleRemovePhoto}
                          disabled={saving}
                        >
                          Hapus Foto
                        </button>
                      ) : null}
                    </div>

                    <small className={removePhoto ? "remove" : ""}>
                      {photoFile
                        ? `File dipilih: ${photoFile.name}`
                        : removePhoto
                          ? "Foto akan dihapus setelah perubahan disimpan."
                          : photoPreview
                            ? "Foto saat ini tetap digunakan jika tidak diganti."
                            : "Belum ada foto yang dipilih."}
                    </small>
                  </div>
                </div>

                <label className="user-role-toggle-field full">
                  <input
                    name="status"
                    type="checkbox"
                    checked={form.status}
                    onChange={handleFormInput}
                  />

                  <span>
                    <strong>
                      Pegawai Aktif
                    </strong>

                    <small>
                      Tandai jika pegawai masih aktif bekerja.
                    </small>
                  </span>
                </label>
              </div>

              {modalError ? (
                <div className="user-role-alert error">
                  {modalError}
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
                      : "Simpan Pegawai"}
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
            if (
              event.target ===
                event.currentTarget &&
              !deleting
            ) {
              closeDeleteModal()
            }
          }}
        >
          <section
            className="user-role-modal uker-delete-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-pegawai-title"
            aria-describedby="delete-pegawai-description"
          >
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">
                  Konfirmasi
                </p>

                <h3 id="delete-pegawai-title">
                  Hapus Pegawai?
                </h3>

                <p id="delete-pegawai-description">
                  Data yang sudah dihapus tidak dapat dikembalikan.
                </p>
              </div>

              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={deleting}
                aria-label="Tutup konfirmasi hapus"
              >
                ×
              </button>
            </header>

            <div className="uker-delete-content">
              <div
                className="uker-delete-icon"
                aria-hidden="true"
              >
                !
              </div>

              <div className="uker-delete-target">
                <span>
                  Pegawai yang akan dihapus
                </span>

                <strong>
                  {deleteTarget.nama || "-"}
                </strong>

                <small>
                  NIP: {deleteTarget.nip || "-"} | KTP: {deleteTarget.ktp || "-"}
                  {deleteTarget.nama_uker
                    ? ` · ${deleteTarget.nama_uker}`
                    : ""}
                </small>
              </div>

              {deleteTarget.user_id ? (
                <>
                  <p className="uker-delete-warning">
                    Pegawai ini masih terhubung dengan akun @{deleteTarget.username}. Untuk melanjutkan, akun dan seluruh session login harus ikut dihapus.
                  </p>

                  <label className="pegawai-delete-user-option">
                    <input
                      type="checkbox"
                      checked={deleteLinkedUser}
                      onChange={(event) =>
                        setDeleteLinkedUser(event.target.checked)
                      }
                      disabled={deleting}
                    />
                    <span>
                      <strong>Hapus akun @{deleteTarget.username} sekaligus</strong>
                      <small>Data akun tidak dapat dikembalikan setelah proses selesai.</small>
                    </span>
                  </label>
                </>
              ) : (
                <p className="uker-delete-warning">
                  Pastikan pegawai ini tidak digunakan pada transaksi atau data lainnya.
                </p>
              )}

              {deleteError ? (
                <div className="user-role-alert error">
                  {deleteError}
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
                className="user-role-button uker-confirm-delete"
                onClick={handleDelete}
                disabled={
                  deleting ||
                  (Boolean(deleteTarget.user_id) && !deleteLinkedUser)
                }
              >
                {deleting
                  ? "Menghapus..."
                  : deleteTarget.user_id
                    ? "Hapus Pegawai & User"
                    : "Ya, Hapus Pegawai"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      <style jsx>{`
        .uker-code-value {
          display: inline-block;
          color: var(--ink);
          font-size: 16px;
          font-weight: 800;
          line-height: 1.4;
          letter-spacing: 0.01em;
        }

        .pegawai-identity-subtext {
          display: block;
          margin-top: 2px;
          color: var(--muted);
          font-size: 11px;
          font-weight: 600;
          line-height: 1.4;
          white-space: nowrap;
        }

        .uker-action-cell {
          white-space: nowrap;
        }

        .uker-action-buttons {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .uker-edit-button,
        .uker-delete-button {
          min-width: 68px;
          height: 34px;
          padding: 0 14px;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 800;
          transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease, transform 0.18s ease;
        }

        .uker-edit-button {
          border: 1px solid rgba(11, 99, 206, 0.25);
          color: var(--blue-800);
          background: var(--blue-100);
        }

        .uker-edit-button:not(:disabled):hover {
          border-color: var(--blue-600);
          color: #fff;
          background: var(--blue-700);
          transform: translateY(-1px);
        }

        .uker-edit-button:disabled,
        .uker-delete-button:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }

        .uker-delete-button {
          border: 1px solid rgba(220, 38, 38, 0.2);
          color: #b91c1c;
          background: #fff1f2;
        }

        .uker-delete-button:not(:disabled):hover {
          border-color: #dc2626;
          color: #fff;
          background: #dc2626;
          transform: translateY(-1px);
        }

        .uker-delete-modal {
          width: min(520px, calc(100vw - 32px));
        }

        .uker-delete-content {
          display: grid;
          gap: 16px;
          padding: 24px;
        }

        .uker-delete-icon {
          width: 48px;
          height: 48px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          color: #b91c1c;
          background: #fee2e2;
          font-size: 24px;
          font-weight: 900;
        }

        .uker-delete-target {
          display: grid;
          gap: 5px;
          padding: 16px;
          border: 1px solid #fecaca;
          border-radius: 14px;
          background: #fffafa;
        }

        .uker-delete-target span,
        .uker-delete-target small {
          color: var(--muted);
          font-size: 12px;
        }

        .uker-delete-target strong {
          color: var(--ink);
          font-size: 16px;
        }

        .uker-delete-warning {
          margin: 0;
          color: var(--muted);
          font-size: 13px;
          line-height: 1.65;
        }

        .pegawai-delete-user-option {
          display: flex;
          align-items: flex-start;
          gap: 11px;
          padding: 14px;
          border: 1px solid #fca5a5;
          border-radius: 14px;
          background: #fff7f7;
          cursor: pointer;
        }

        .pegawai-delete-user-option input {
          width: 18px;
          height: 18px;
          margin-top: 2px;
          accent-color: #dc2626;
        }

        .pegawai-delete-user-option span,
        .pegawai-delete-user-option strong,
        .pegawai-delete-user-option small {
          display: block;
        }

        .pegawai-delete-user-option strong {
          color: #991b1b;
          font-size: 13px;
        }

        .pegawai-delete-user-option small {
          margin-top: 4px;
          color: var(--muted);
          font-size: 12px;
          line-height: 1.45;
        }

        .uker-confirm-delete {
          border: 1px solid #dc2626;
          color: #fff;
          background: #dc2626;
        }

        .uker-confirm-delete:not(:disabled):hover {
          border-color: #b91c1c;
          background: #b91c1c;
        }

        .uker-confirm-delete:disabled {
          cursor: not-allowed;
          opacity: 0.65;
        }

        .user-role-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          margin-top: 18px;
          padding: 14px 16px;
          border: 1px solid var(--line);
          border-radius: 16px;
          background: #f8fafc;
        }

        .user-role-pagination-controls {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 14px;
          flex-wrap: wrap;
        }

        .user-role-page-size {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 700;
        }

        .user-role-page-size select {
          min-width: 68px;
          height: 36px;
          padding: 0 28px 0 10px;
          border: 1px solid var(--line);
          border-radius: 10px;
          outline: none;
          color: var(--ink);
          background: #fff;
          font-weight: 700;
        }

        .user-role-page-size select:focus {
          border-color: var(--blue-600);
          box-shadow: 0 0 0 3px rgba(11, 99, 206, 0.1);
        }

        .user-role-page-buttons {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .user-role-page-buttons button {
          width: 36px;
          height: 36px;
          display: inline-grid;
          place-items: center;
          border: 1px solid var(--line);
          border-radius: 10px;
          color: var(--blue-800);
          background: #fff;
          font-size: 13px;
          font-weight: 800;
          transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease, transform 0.18s ease;
        }

        .user-role-page-buttons button:not(:disabled):hover {
          border-color: var(--blue-600);
          background: var(--blue-100);
          transform: translateY(-1px);
        }

        .user-role-page-buttons button.active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, var(--blue-700), var(--blue-900));
          box-shadow: 0 8px 18px rgba(11, 86, 208, 0.2);
        }

        .user-role-page-buttons button:disabled {
          cursor: not-allowed;
          color: #a8b2c1;
          background: #f1f5f9;
          opacity: 0.7;
        }

        .pegawai-photo-upload {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: 112px minmax(0, 1fr);
          gap: 18px;
          align-items: center;
          padding: 18px;
          border: 1px dashed #b9cce5;
          border-radius: 18px;
          background: #f8fbff;
        }

        .pegawai-photo-preview-shell {
          display: grid;
          place-items: center;
        }

        .pegawai-photo-preview {
          width: 96px;
          height: 96px;
          border-radius: 24px;
          font-size: 30px;
          box-shadow: 0 12px 28px rgba(11, 86, 208, 0.18);
        }

        .pegawai-photo-controls {
          display: grid;
          gap: 12px;
        }

        .pegawai-photo-controls strong {
          display: block;
          color: var(--ink);
          font-size: 14px;
        }

        .pegawai-photo-controls p {
          margin: 5px 0 0;
          color: var(--muted);
          font-size: 12px;
          line-height: 1.55;
        }

        .pegawai-photo-actions {
          display: flex;
          align-items: center;
          gap: 9px;
          flex-wrap: wrap;
        }

        .pegawai-photo-actions input[type="file"] {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          clip-path: inset(50%);
        }

        .pegawai-photo-select-button,
        .pegawai-photo-remove-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 38px;
          padding: 8px 14px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
        }

        .pegawai-photo-select-button {
          border: 1px solid rgba(11, 99, 206, 0.25);
          color: var(--blue-800);
          background: var(--blue-100);
        }

        .pegawai-photo-select-button:hover {
          border-color: var(--blue-600);
          color: #fff;
          background: var(--blue-700);
        }

        .pegawai-photo-remove-button {
          border: 1px solid #fecaca;
          color: #b91c1c;
          background: #fff;
        }

        .pegawai-photo-remove-button:not(:disabled):hover {
          border-color: #dc2626;
          color: #fff;
          background: #dc2626;
        }

        .pegawai-photo-remove-button:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }

        .pegawai-photo-controls > small {
          color: var(--muted);
          font-size: 11px;
        }

        .pegawai-photo-controls > small.remove {
          color: #b91c1c;
          font-weight: 700;
        }

        @media (max-width: 760px) {
          .pegawai-photo-upload {
            grid-template-columns: 1fr;
            justify-items: start;
          }

          .pegawai-photo-preview-shell {
            justify-self: start;
          }

          .user-role-pagination {
            align-items: stretch;
            flex-direction: column;
          }

          .user-role-pagination-controls {
            justify-content: space-between;
          }
        }

        @media (max-width: 520px) {
          .user-role-pagination-controls {
            align-items: stretch;
            flex-direction: column;
          }

          .user-role-page-size {
            justify-content: space-between;
          }

          .user-role-page-buttons {
            width: 100%;
            justify-content: center;
            overflow-x: auto;
            padding-bottom: 2px;
          }
        }
      `}</style>
    </div>
  )
}
