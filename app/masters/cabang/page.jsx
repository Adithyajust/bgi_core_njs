"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useAppBootstrap } from "@/components/app-bootstrap-context"

const EMPTY_FORM = {
  kanwil_id: "",
  kode_cabang: "",
  nama_cabang: "",
  is_active: true,
  row_version: "",
}

function formatDateTime(value) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || ""

  if (!contentType.includes("application/json")) {
    throw new Error(
      `Endpoint tidak mengembalikan JSON. Status ${response.status}.`
    )
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

function mapToForm(item) {
  return {
    kanwil_id: String(item?.kanwil_id || ""),
    kode_cabang: String(item?.kode_cabang || ""),
    nama_cabang: String(item?.nama_cabang || ""),
    is_active: Boolean(item?.is_active),
    row_version: String(item?.row_version || ""),
  }
}

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback
}

export default function MasterCabangPage() {
  const router = useRouter()
  const { user: currentUser } = useAppBootstrap()
  const toastTimerRef = useRef(null)

  const [kanwilOptions, setKanwilOptions] = useState([])
  const [cabangs, setCabangs] = useState([])
  const [summary, setSummary] = useState({
    total: 0,
    active: 0,
    inactive: 0,
    kanwil_count: 0,
  })
  const [pagination, setPagination] = useState({
    page: 1,
    page_size: 10,
    total: 0,
    total_pages: 1,
  })

  const [searchText, setSearchText] = useState("")
  const [kanwilFilter, setKanwilFilter] = useState("ALL")
  const [activeFilter, setActiveFilter] = useState("ALL")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [refreshKey, setRefreshKey] = useState(0)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState("")

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
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

  const isSuperAdmin = currentUser?.roleCode === "SUPER_ADMIN"
  const activeKanwilOptions = useMemo(
    () => kanwilOptions.filter((item) => item.is_active),
    [kanwilOptions]
  )

  useEffect(() => {
    const controller = new AbortController()

    async function loadIdentityAndOptions() {
      try {
        const kanwilResult = await requestJson(
          "/api/masters/kanwil?mode=options&include_inactive=true",
          { method: "GET", signal: controller.signal }
        )

        if (!controller.signal.aborted) {
          setKanwilOptions(
            Array.isArray(kanwilResult.data?.kanwils)
              ? kanwilResult.data.kanwils
              : []
          )
        }
      } catch (error) {
        if (error?.name === "AbortError") {
          return
        }

        if (error?.status === 401) {
          router.replace(`/login?next=${encodeURIComponent("/masters/cabang")}`)
          return
        }

        if (error?.status === 403) {
          router.replace("/forbidden")
          return
        }

        setLoadError(
          getErrorMessage(error, "Gagal mengambil data Kanwil untuk form Cabang.")
        )
      }
    }

    void loadIdentityAndOptions()

    return () => controller.abort()
  }, [refreshKey, router])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        setLoadError("")

        if (refreshKey > 0) {
          setRefreshing(true)
        } else {
          setLoading(true)
        }

        const params = new URLSearchParams({
          page: String(page),
          page_size: String(pageSize),
        })

        if (searchText.trim()) {
          params.set("search", searchText.trim())
        }

        if (kanwilFilter !== "ALL") {
          params.set("kanwil_id", kanwilFilter)
        }

        if (activeFilter !== "ALL") {
          params.set("is_active", activeFilter)
        }

        const result = await requestJson(
          `/api/masters/cabang?${params.toString()}`,
          {
            method: "GET",
            signal: controller.signal,
          }
        )

        if (!controller.signal.aborted) {
          setCabangs(Array.isArray(result.data?.cabangs) ? result.data.cabangs : [])
          setSummary(
            result.data?.summary || {
              total: 0,
              active: 0,
              inactive: 0,
              kanwil_count: 0,
            }
          )
          setPagination(
            result.data?.pagination || {
              page: 1,
              page_size: pageSize,
              total: 0,
              total_pages: 1,
            }
          )
        }
      } catch (error) {
        if (error?.name === "AbortError") {
          return
        }

        if (error?.status === 401) {
          router.replace(`/login?next=${encodeURIComponent("/masters/cabang")}`)
          return
        }

        if (error?.status === 403) {
          router.replace("/forbidden")
          return
        }

        setLoadError(getErrorMessage(error, "Gagal mengambil data Cabang."))
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }, searchText ? 300 : 0)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [activeFilter, kanwilFilter, page, pageSize, refreshKey, router, searchText])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!modalOpen && !deleteTarget) {
      return undefined
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    function handleEscape(event) {
      if (event.key !== "Escape" || saving || deleting) {
        return
      }

      if (deleteTarget) {
        setDeleteTarget(null)
        setDeleteError("")
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
  }, [deleteTarget, deleting, modalOpen, saving])

  const paginationPages = useMemo(() => {
    const totalPages = Math.max(1, Number(pagination.total_pages || 1))
    const activePage = Math.min(page, totalPages)
    const visibleCount = 5
    let startPage = Math.max(1, activePage - 2)
    let endPage = Math.min(totalPages, startPage + visibleCount - 1)

    startPage = Math.max(1, endPage - visibleCount + 1)

    return Array.from(
      { length: endPage - startPage + 1 },
      (_, index) => startPage + index
    )
  }, [page, pagination.total_pages])

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

  function refreshData() {
    setRefreshKey((current) => current + 1)
  }

  function resetFilters() {
    setSearchText("")
    setKanwilFilter("ALL")
    setActiveFilter("ALL")
    setPage(1)
  }

  function openAddModal() {
    setEditingId(null)
    setForm({
      ...EMPTY_FORM,
      kanwil_id:
        activeKanwilOptions.length === 1
          ? String(activeKanwilOptions[0].id)
          : "",
    })
    setModalError("")
    setModalOpen(true)
  }

  function openEditModal(item) {
    setEditingId(item.id)
    setForm(mapToForm(item))
    setModalError("")
    setModalOpen(true)
  }

  function closeModal() {
    if (saving) {
      return
    }

    setModalOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setModalError("")
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (saving) {
      return
    }

    try {
      setSaving(true)
      setModalError("")

      const payload = {
        kanwil_id: Number(form.kanwil_id),
        kode_cabang: form.kode_cabang.trim().toUpperCase(),
        nama_cabang: form.nama_cabang.trim(),
        is_active: form.is_active,
        row_version: form.row_version,
      }

      const result = await requestJson("/api/masters/cabang", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, ...payload } : payload),
      })

      setModalOpen(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
      setModalError("")
      showToast("success", result.message)
      refreshData()
    } catch (error) {
      if (error?.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/masters/cabang")}`)
        return
      }

      if (error?.status === 403) {
        router.replace("/forbidden")
        return
      }

      const message = getErrorMessage(
        error,
        editingId ? "Gagal memperbarui data Cabang." : "Gagal menambahkan data Cabang."
      )

      setModalError(message)
      showToast("error", message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deleting) {
      return
    }

    try {
      setDeleting(true)
      setDeleteError("")

      const result = await requestJson("/api/masters/cabang", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      })

      setDeleteTarget(null)
      showToast("success", result.message)

      if (cabangs.length === 1 && page > 1) {
        setPage((current) => Math.max(1, current - 1))
      } else {
        refreshData()
      }
    } catch (error) {
      const message = getErrorMessage(error, "Gagal menghapus data Cabang.")
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
          <p className="eyebrow">Master Data</p>
          <h2>Master Cabang</h2>
          <p>
            Kelola Cabang beserta relasi Kanwil. Cabang ini berfungsi sebagai
            cabang pengelola mesin, bukan sebagai alamat fisik TID.
          </p>
        </div>

        <Link href="/masters" className="user-role-button secondary">
          Kembali
        </Link>
      </section>

      <section className="user-role-summary-grid">
        <article className="user-role-summary-card">
          <span>Total Cabang</span>
          <strong>{summary.total}</strong>
          <p>Seluruh Cabang terdaftar</p>
        </article>
        <article className="user-role-summary-card green">
          <span>Cabang Aktif</span>
          <strong>{summary.active}</strong>
          <p>Dapat dipilih sebagai pengelola</p>
        </article>
        <article className="user-role-summary-card red">
          <span>Cabang Nonaktif</span>
          <strong>{summary.inactive}</strong>
          <p>Tidak tersedia untuk data baru</p>
        </article>
        <article className="user-role-summary-card orange">
          <span>Kanwil Terpakai</span>
          <strong>{summary.kanwil_count}</strong>
          <p>Kanwil yang memiliki Cabang</p>
        </article>
      </section>

      <section className="settings-card user-role-panel">
        <div className="user-role-toolbar">
          <div className="user-role-filters">
            <input
              type="search"
              value={searchText}
              onChange={(event) => {
                setSearchText(event.target.value)
                setPage(1)
              }}
              placeholder="Cari kode, nama Cabang, atau Kanwil..."
              aria-label="Cari Cabang"
            />

            <select
              value={kanwilFilter}
              onChange={(event) => {
                setKanwilFilter(event.target.value)
                setPage(1)
              }}
              aria-label="Filter Kanwil"
            >
              <option value="ALL">Semua Kanwil</option>
              {kanwilOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.kode_kanwil} · {item.nama_kanwil}
                  {item.is_active ? "" : " (Nonaktif)"}
                </option>
              ))}
            </select>

            <select
              value={activeFilter}
              onChange={(event) => {
                setActiveFilter(event.target.value)
                setPage(1)
              }}
              aria-label="Filter status Cabang"
            >
              <option value="ALL">Semua Status</option>
              <option value="true">Aktif</option>
              <option value="false">Nonaktif</option>
            </select>
          </div>

          <div className="user-role-toolbar-actions">
            <button
              type="button"
              className="user-role-button secondary"
              onClick={resetFilters}
              disabled={
                !searchText && kanwilFilter === "ALL" && activeFilter === "ALL"
              }
            >
              Reset
            </button>
            <button
              type="button"
              className="user-role-button secondary"
              onClick={refreshData}
              disabled={loading || refreshing}
            >
              {refreshing ? "Memuat..." : "Refresh"}
            </button>
            {isSuperAdmin ? (
              <button
                type="button"
                className="user-role-button primary"
                onClick={openAddModal}
                disabled={loading || refreshing || activeKanwilOptions.length === 0}
                title={
                  activeKanwilOptions.length === 0
                    ? "Buat Kanwil aktif terlebih dahulu."
                    : undefined
                }
              >
                Tambah Cabang
              </button>
            ) : null}
          </div>
        </div>

        {activeKanwilOptions.length === 0 && !loading ? (
          <div className="user-role-alert info">
            <strong>Kanwil aktif belum tersedia</strong>
            <span>
              Tambahkan atau aktifkan Kanwil terlebih dahulu sebelum membuat Cabang.
            </span>
          </div>
        ) : null}

        {loadError ? (
          <div className="user-role-alert error">
            <strong>Data gagal dimuat</strong>
            <span>{loadError}</span>
          </div>
        ) : null}

        <div className="user-role-table-wrapper">
          <table className="user-role-table master-table-compact">
            <thead>
              <tr>
                <th>Kode Cabang</th>
                <th>Nama Cabang</th>
                <th>Kanwil</th>
                <th>Status</th>
                <th>Diperbarui</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="user-role-loading">
                    Memuat data Cabang...
                  </td>
                </tr>
              ) : null}

              {!loading && cabangs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="user-role-empty">
                    {pagination.total === 0
                      ? "Belum ada data Cabang."
                      : "Tidak ada data yang sesuai dengan filter."}
                  </td>
                </tr>
              ) : null}

              {!loading
                ? cabangs.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong className="master-code-value">
                          {item.kode_cabang}
                        </strong>
                      </td>
                      <td>
                        <div className="user-role-user-cell">
                          <div className="user-role-avatar">
                            {String(item.nama_cabang || "C")
                              .charAt(0)
                              .toUpperCase()}
                          </div>
                          <div>
                            <strong>{item.nama_cabang}</strong>
                            <span>ID database: {item.id}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <strong>{item.nama_kanwil}</strong>
                        <div className="master-subtext">{item.kode_kanwil}</div>
                      </td>
                      <td>
                        <span
                          className={`user-role-status ${
                            item.is_active ? "active" : "inactive"
                          }`}
                        >
                          {item.is_active ? "Aktif" : "Nonaktif"}
                        </span>
                      </td>
                      <td>{formatDateTime(item.updated_at || item.created_at)}</td>
                      <td>
                        <div className="master-action-buttons">
                          {isSuperAdmin ? (
                            <>
                              <button
                                type="button"
                                className="master-action-button edit"
                                onClick={() => openEditModal(item)}
                                disabled={saving || deleting}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="master-action-button delete"
                                onClick={() => {
                                  setDeleteTarget(item)
                                  setDeleteError("")
                                }}
                                disabled={saving || deleting}
                              >
                                Hapus
                              </button>
                            </>
                          ) : (
                            <span className="master-readonly-label">Lihat saja</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        </div>

        {!loading && pagination.total > 0 ? (
          <div className="master-pagination">
            <label className="master-page-size">
              <span>Baris</span>
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value))
                  setPage(1)
                }}
              >
                {[10, 25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>

            <span className="master-page-info">
              {pagination.total} data · Halaman {page} dari {pagination.total_pages}
            </span>

            <nav className="master-page-buttons" aria-label="Navigasi halaman Cabang">
              <button type="button" onClick={() => setPage(1)} disabled={page <= 1}>
                «
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
              >
                ‹
              </button>
              {paginationPages.map((pageNumber) => (
                <button
                  key={pageNumber}
                  type="button"
                  className={pageNumber === page ? "active" : ""}
                  onClick={() => setPage(pageNumber)}
                >
                  {pageNumber}
                </button>
              ))}
              <button
                type="button"
                onClick={() =>
                  setPage((current) =>
                    Math.min(pagination.total_pages, current + 1)
                  )
                }
                disabled={page >= pagination.total_pages}
              >
                ›
              </button>
              <button
                type="button"
                onClick={() => setPage(pagination.total_pages)}
                disabled={page >= pagination.total_pages}
              >
                »
              </button>
            </nav>
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
        </div>
      ) : null}

      {modalOpen ? (
        <div
          className="user-role-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) {
              closeModal()
            }
          }}
        >
          <section
            className="user-role-modal compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cabang-modal-title"
          >
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">Master Data</p>
                <h3 id="cabang-modal-title">
                  {editingId ? "Edit Cabang" : "Tambah Cabang"}
                </h3>
                <p>Pilih Kanwil, lalu isi kode, nama, dan status Cabang.</p>
              </div>
              <button type="button" onClick={closeModal} disabled={saving}>
                ×
              </button>
            </header>

            <form onSubmit={handleSubmit}>
              <div className="user-role-form-grid single">
                <div className="user-role-form-field">
                  <label htmlFor="kanwil_id">Kanwil *</label>
                  <select
                    id="kanwil_id"
                    name="kanwil_id"
                    value={form.kanwil_id}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        kanwil_id: event.target.value,
                      }))
                    }
                    required
                    autoFocus
                  >
                    <option value="">Pilih Kanwil</option>
                    {kanwilOptions.map((item) => (
                      <option
                        key={item.id}
                        value={item.id}
                        disabled={!item.is_active}
                      >
                        {item.kode_kanwil} · {item.nama_kanwil}
                        {item.is_active ? "" : " (Nonaktif)"}
                      </option>
                    ))}
                  </select>
                  <small>Hanya Kanwil aktif yang dapat dipilih.</small>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="kode_cabang">Kode Cabang *</label>
                  <input
                    id="kode_cabang"
                    name="kode_cabang"
                    value={form.kode_cabang}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        kode_cabang: event.target.value.toUpperCase(),
                      }))
                    }
                    maxLength={30}
                    placeholder="Contoh: KCP-JKT-01"
                    autoComplete="off"
                    required
                  />
                  <small>Maksimal 30 karakter dan unik secara global.</small>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="nama_cabang">Nama Cabang *</label>
                  <input
                    id="nama_cabang"
                    name="nama_cabang"
                    value={form.nama_cabang}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        nama_cabang: event.target.value,
                      }))
                    }
                    maxLength={150}
                    placeholder="Contoh: Cabang Jakarta Selatan"
                    required
                  />
                </div>

                <label className="user-role-toggle-field full">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        is_active: event.target.checked,
                      }))
                    }
                  />
                  <span>
                    <strong>Cabang aktif</strong>
                    <small>
                      Cabang aktif dapat dipakai sebagai cabang pengelola mesin.
                    </small>
                  </span>
                </label>
              </div>

              {modalError ? (
                <div className="user-role-alert error">{modalError}</div>
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
                      : "Simpan Cabang"}
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
              setDeleteTarget(null)
              setDeleteError("")
            }
          }}
        >
          <section
            className="user-role-modal compact"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-cabang-title"
          >
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">Konfirmasi</p>
                <h3 id="delete-cabang-title">Hapus Cabang?</h3>
                <p>Cabang yang sudah digunakan oleh mesin tidak dapat dihapus.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDeleteTarget(null)
                  setDeleteError("")
                }}
                disabled={deleting}
              >
                ×
              </button>
            </header>

            <div className="master-delete-content">
              <div className="master-delete-target">
                <span>Cabang yang akan dihapus</span>
                <strong>{deleteTarget.nama_cabang}</strong>
                <small>
                  {deleteTarget.kode_cabang} · {deleteTarget.nama_kanwil}
                </small>
              </div>
              {deleteError ? (
                <div className="user-role-alert error">{deleteError}</div>
              ) : null}
            </div>

            <footer className="user-role-modal-footer">
              <button
                type="button"
                className="user-role-button secondary"
                onClick={() => {
                  setDeleteTarget(null)
                  setDeleteError("")
                }}
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
                {deleting ? "Menghapus..." : "Ya, Hapus Cabang"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      <style jsx>{`
        .master-table-compact {
          min-width: 900px;
        }

        .master-code-value {
          color: var(--blue-900);
          font-size: 14px;
          font-weight: 900;
        }

        .master-subtext {
          margin-top: 4px;
          color: var(--muted);
          font-size: 12px;
        }

        .master-action-buttons {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          white-space: nowrap;
        }

        .master-action-button {
          min-width: 62px;
          height: 34px;
          border: 1px solid transparent;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 800;
        }

        .master-action-button.edit {
          color: var(--blue-800);
          border-color: rgba(11, 99, 206, 0.25);
          background: var(--blue-100);
        }

        .master-action-button.delete {
          color: #b91c1c;
          border-color: #fecaca;
          background: #fff1f2;
        }

        .master-action-button:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }

        .master-readonly-label {
          color: var(--muted);
          font-size: 12px;
        }

        .master-pagination {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 14px;
          flex-wrap: wrap;
          margin-top: 18px;
          padding: 14px 16px;
          border: 1px solid var(--line);
          border-radius: 16px;
          background: #f8fafc;
        }

        .master-page-size {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 700;
        }

        .master-page-size select {
          height: 36px;
          padding: 0 28px 0 10px;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: #fff;
        }

        .master-page-info {
          color: var(--muted);
          font-size: 12px;
        }

        .master-page-buttons {
          display: inline-flex;
          gap: 6px;
        }

        .master-page-buttons button {
          width: 36px;
          height: 36px;
          border: 1px solid var(--line);
          border-radius: 10px;
          color: var(--blue-800);
          background: #fff;
          font-weight: 800;
        }

        .master-page-buttons button.active {
          color: #fff;
          border-color: transparent;
          background: linear-gradient(135deg, var(--blue-700), var(--blue-900));
        }

        .master-page-buttons button:disabled {
          cursor: not-allowed;
          color: #a8b2c1;
          background: #f1f5f9;
        }

        .master-delete-content {
          padding: 22px 24px;
        }

        .master-delete-target {
          display: grid;
          gap: 5px;
          padding: 16px;
          border: 1px solid #fecaca;
          border-radius: 14px;
          background: #fffafa;
        }

        .master-delete-target span,
        .master-delete-target small {
          color: var(--muted);
          font-size: 12px;
        }

        .master-delete-target strong {
          color: var(--ink);
          font-size: 16px;
        }

        @media (max-width: 720px) {
          .master-pagination {
            justify-content: center;
          }
        }
      `}</style>
    </div>
  )
}
