"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"

const EMPTY_FORM = {
  kode_merk: "",
  nama_merk: "",
  is_active: true,
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
    kode_merk: String(item?.kode_merk || ""),
    nama_merk: String(item?.nama_merk || ""),
    is_active: Boolean(item?.is_active),
  }
}

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback
}

export default function MasterMerkPage() {
  const router = useRouter()
  const toastTimerRef = useRef(null)

  const [currentUser, setCurrentUser] = useState(null)
  const [merks, setMerks] = useState([])
  const [summary, setSummary] = useState({
    total: 0,
    active: 0,
    inactive: 0,
    total_tipe: 0,
  })
  const [pagination, setPagination] = useState({
    page: 1,
    page_size: 10,
    total: 0,
    total_pages: 1,
  })

  const [searchText, setSearchText] = useState("")
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

  useEffect(() => {
    const controller = new AbortController()

    async function loadCurrentUser() {
      try {
        const result = await requestJson("/api/auth/me", {
          method: "GET",
          signal: controller.signal,
        })

        if (!controller.signal.aborted) {
          setCurrentUser(result.data)
        }
      } catch (error) {
        if (error?.name === "AbortError") {
          return
        }

        if (error?.status === 401) {
          router.replace(`/login?next=${encodeURIComponent("/masters/merk")}`)
          return
        }

        if (error?.status === 403) {
          router.replace("/forbidden")
        }
      }
    }

    void loadCurrentUser()

    return () => controller.abort()
  }, [router])

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

        if (activeFilter !== "ALL") {
          params.set("is_active", activeFilter)
        }

        const result = await requestJson(
          `/api/masters/merk?${params.toString()}`,
          {
            method: "GET",
            signal: controller.signal,
          }
        )

        if (!controller.signal.aborted) {
          setMerks(Array.isArray(result.data?.merks) ? result.data.merks : [])
          setSummary(
            result.data?.summary || {
              total: 0,
              active: 0,
              inactive: 0,
              total_tipe: 0,
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
          router.replace(`/login?next=${encodeURIComponent("/masters/merk")}`)
          return
        }

        if (error?.status === 403) {
          router.replace("/forbidden")
          return
        }

        setLoadError(getErrorMessage(error, "Gagal mengambil data Merk."))
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
  }, [activeFilter, page, pageSize, refreshKey, router, searchText])

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
    setActiveFilter("ALL")
    setPage(1)
  }

  function openAddModal() {
    setEditingId(null)
    setForm(EMPTY_FORM)
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
        kode_merk: form.kode_merk.trim().toUpperCase(),
        nama_merk: form.nama_merk.trim(),
        is_active: form.is_active,
      }

      const result = await requestJson("/api/masters/merk", {
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
        router.replace(`/login?next=${encodeURIComponent("/masters/merk")}`)
        return
      }

      if (error?.status === 403) {
        router.replace("/forbidden")
        return
      }

      const message = getErrorMessage(
        error,
        editingId ? "Gagal memperbarui data Merk." : "Gagal menambahkan data Merk."
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

      const result = await requestJson("/api/masters/merk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      })

      setDeleteTarget(null)
      showToast("success", result.message)

      if (merks.length === 1 && page > 1) {
        setPage((current) => Math.max(1, current - 1))
      } else {
        refreshData()
      }
    } catch (error) {
      const message = getErrorMessage(error, "Gagal menghapus data Merk.")
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
          <h2>Master Merk</h2>
          <p>
            Kelola kode, nama, dan status Merk. Merk menjadi induk relasi
            untuk data Tipe Mesin.
          </p>
        </div>

        <Link href="/masters" className="user-role-button secondary">
          Kembali
        </Link>
      </section>

      <section className="user-role-summary-grid">
        <article className="user-role-summary-card">
          <span>Total Merk</span>
          <strong>{summary.total}</strong>
          <p>Seluruh Merk terdaftar</p>
        </article>
        <article className="user-role-summary-card green">
          <span>Merk Aktif</span>
          <strong>{summary.active}</strong>
          <p>Dapat digunakan pada form Tipe Mesin</p>
        </article>
        <article className="user-role-summary-card red">
          <span>Merk Nonaktif</span>
          <strong>{summary.inactive}</strong>
          <p>Tidak tersedia untuk Tipe Mesin baru</p>
        </article>
        <article className="user-role-summary-card orange">
          <span>Total Tipe Mesin</span>
          <strong>{summary.total_tipe}</strong>
          <p>Tipe Mesin pada seluruh Merk</p>
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
              placeholder="Cari kode atau nama Merk..."
              aria-label="Cari Merk"
            />

            <select
              value={activeFilter}
              onChange={(event) => {
                setActiveFilter(event.target.value)
                setPage(1)
              }}
              aria-label="Filter status Merk"
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
              disabled={!searchText && activeFilter === "ALL"}
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
                disabled={loading || refreshing}
              >
                Tambah Merk
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

        <div className="user-role-table-wrapper">
          <table className="user-role-table master-table-compact">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Merk</th>
                <th>Status</th>
                <th>Jumlah Tipe Mesin</th>
                <th>Tipe Mesin Aktif</th>
                <th>Diperbarui</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="user-role-loading">
                    Memuat data Merk...
                  </td>
                </tr>
              ) : null}

              {!loading && merks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="user-role-empty">
                    {pagination.total === 0
                      ? "Belum ada data Merk."
                      : "Tidak ada data yang sesuai dengan filter."}
                  </td>
                </tr>
              ) : null}

              {!loading
                ? merks.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong className="master-code-value">
                          {item.kode_merk}
                        </strong>
                      </td>
                      <td>
                        <div className="user-role-user-cell">
                          <div className="user-role-avatar">
                            {String(item.nama_merk || "K")
                              .charAt(0)
                              .toUpperCase()}
                          </div>
                          <div>
                            <strong>{item.nama_merk}</strong>
                            <span>ID database: {item.id}</span>
                          </div>
                        </div>
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
                      <td>{Number(item.jumlah_tipe || 0)}</td>
                      <td>{Number(item.tipe_aktif || 0)}</td>
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

            <nav className="master-page-buttons" aria-label="Navigasi halaman Merk">
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
            aria-labelledby="merk-modal-title"
          >
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">Master Data</p>
                <h3 id="merk-modal-title">
                  {editingId ? "Edit Merk" : "Tambah Merk"}
                </h3>
                <p>Isi kode, nama, dan status Merk.</p>
              </div>
              <button type="button" onClick={closeModal} disabled={saving}>
                ×
              </button>
            </header>

            <form onSubmit={handleSubmit}>
              <div className="user-role-form-grid single">
                <div className="user-role-form-field">
                  <label htmlFor="kode_merk">Kode Merk *</label>
                  <input
                    id="kode_merk"
                    name="kode_merk"
                    value={form.kode_merk}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        kode_merk: event.target.value.toUpperCase(),
                      }))
                    }
                    maxLength={30}
                    placeholder="Contoh: KWL-01"
                    autoComplete="off"
                    required
                    autoFocus
                  />
                  <small>Maksimal 20 karakter dan harus unik.</small>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="nama_merk">Nama Merk *</label>
                  <input
                    id="nama_merk"
                    name="nama_merk"
                    value={form.nama_merk}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        nama_merk: event.target.value,
                      }))
                    }
                    maxLength={150}
                    placeholder="Contoh: NCR atau Diebold Nixdorf"
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
                    <strong>Merk aktif</strong>
                    <small>
                      Merk aktif dapat dipilih saat membuat atau mengubah Tipe Mesin.
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
                      : "Simpan Merk"}
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
            aria-labelledby="delete-merk-title"
          >
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">Konfirmasi</p>
                <h3 id="delete-merk-title">Hapus Merk?</h3>
                <p>Merk yang masih memiliki Tipe Mesin tidak dapat dihapus.</p>
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
                <span>Merk yang akan dihapus</span>
                <strong>{deleteTarget.nama_merk}</strong>
                <small>
                  {deleteTarget.kode_merk} · {deleteTarget.jumlah_tipe || 0} Tipe Mesin
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
                {deleting ? "Menghapus..." : "Ya, Hapus Merk"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      <style jsx>{`
        .master-table-compact {
          min-width: 920px;
        }

        .master-code-value {
          color: var(--blue-900);
          font-size: 14px;
          font-weight: 900;
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
