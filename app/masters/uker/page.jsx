"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"

const EMPTY_UKER_FORM = {
  codeuker: "",
  nama_uker: "",
  alamat_uker: "",
  kota: "",
  kode_pos: "",
  telp_branch: "",
  gedung_branch: "",
  email: "",
  tanggal_ops: "",
}

function mapUkerToForm(uker) {
  return {
    codeuker: String(uker?.codeuker || ""),
    nama_uker: String(uker?.nama_uker || ""),
    alamat_uker: String(uker?.alamat_uker || ""),
    kota: String(uker?.kota || ""),
    kode_pos: String(uker?.kode_pos || ""),
    telp_branch: String(uker?.telp_branch || ""),
    gedung_branch: String(uker?.gedung_branch || ""),
    email: String(uker?.email || ""),
    tanggal_ops: uker?.tanggal_ops
      ? String(uker.tanggal_ops).slice(0, 10)
      : "",
  }
}

function formatDate(value) {
  if (!value) {
    return "-"
  }

  const parts = String(value).slice(0, 10).split("-")

  if (parts.length !== 3) {
    return "-"
  }

  const [year, month, day] = parts

  return `${day}/${month}/${year}`
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
  const contentType =
    response.headers.get("content-type") || ""

  if (!contentType.includes("application/json")) {
    throw new Error(
      `Endpoint tidak mengembalikan JSON. Status ${response.status}.`
    )
  }

  return response.json()
}

async function fetchCurrentUser(signal) {
  const response = await fetch("/api/auth/me", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    signal,
  })

  const result = await readJsonResponse(response)

  if (!response.ok || !result.success) {
    const error = new Error(result.message || "Gagal membaca sesi pengguna.")
    error.status = response.status
    throw error
  }

  return result.data
}

async function fetchUkerData(signal) {
  const response = await fetch(
    "/api/masters/uker",
    {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal,
    }
  )

  const result = await readJsonResponse(response)

  if (!response.ok || !result.success) {
    const error = new Error(
      result.message ||
        "Gagal mengambil data unit kerja."
    )

    error.status = response.status

    throw error
  }

  return Array.isArray(result.data?.ukers)
    ? result.data.ukers
    : []
}

async function createUker(payload) {
  const response = await fetch(
    "/api/masters/uker",
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  )

  const result = await readJsonResponse(response)

  if (!response.ok || !result.success) {
    const error = new Error(
      result.message ||
        "Gagal menambahkan data unit kerja."
    )

    error.status = response.status

    throw error
  }

  return {
    message:
      result.message ||
      "Data unit kerja berhasil ditambahkan.",
    data: result.data || null,
  }
}

async function updateUker(payload) {
  const response = await fetch(
    "/api/masters/uker",
    {
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  )

  const result = await readJsonResponse(response)

  if (!response.ok || !result.success) {
    const error = new Error(
      result.message ||
        "Gagal memperbarui data unit kerja."
    )

    error.status = response.status

    throw error
  }

  return {
    message:
      result.message ||
      "Data unit kerja berhasil diperbarui.",
    data: result.data || null,
  }
}

async function deleteUker(id) {
  const response = await fetch(
    "/api/masters/uker",
    {
      method: "DELETE",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id }),
    }
  )

  const result = await readJsonResponse(response)

  if (!response.ok || !result.success) {
    const error = new Error(
      result.message ||
        "Gagal menghapus data unit kerja."
    )

    error.status = response.status

    throw error
  }

  return {
    message:
      result.message ||
      "Data unit kerja berhasil dihapus.",
  }
}

function getErrorMessage(
  error,
  fallbackMessage
) {
  return error instanceof Error
    ? error.message
    : fallbackMessage
}

export default function MasterUkerPage() {
  const router = useRouter()

  const [ukers, setUkers] = useState([])
  const [currentUser, setCurrentUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] =
    useState(false)
  const [loadError, setLoadError] =
    useState("")

  const [searchText, setSearchText] =
    useState("")
  const [cityFilter, setCityFilter] =
    useState("ALL")
  const [currentPage, setCurrentPage] =
    useState(1)
  const [pageSize, setPageSize] =
    useState(10)

  const toastTimerRef = useRef(null)

  const [modalOpen, setModalOpen] =
    useState(false)
  const [editingId, setEditingId] =
    useState(null)
  const [saving, setSaving] =
    useState(false)
  const [form, setForm] =
    useState(EMPTY_UKER_FORM)
  const [modalError, setModalError] =
    useState("")
  const [deleteTarget, setDeleteTarget] =
    useState(null)
  const [deleting, setDeleting] =
    useState(false)
  const [deleteError, setDeleteError] =
    useState("")
  const [toast, setToast] = useState({
    open: false,
    type: "success",
    message: "",
  })

  async function loadData({
    signal,
    isRefresh = false,
  } = {}) {
    try {
      if (isRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      setLoadError("")

      const loadedUkers =
        await fetchUkerData(signal)

      setUkers(loadedUkers)
    } catch (error) {
      if (
        error?.name === "AbortError"
      ) {
        return
      }

      if (error?.status === 401) {
        router.replace(
          `/login?next=${encodeURIComponent(
            "/masters/uker"
          )}`
        )

        return
      }

      if (error?.status === 403) {
        router.replace("/forbidden")
        return
      }

      console.error(
        "Gagal memuat Master Uker:",
        error
      )

      setLoadError(
        getErrorMessage(
          error,
          "Gagal mengambil data unit kerja."
        )
      )
    } finally {
      if (!signal?.aborted) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

 useEffect(() => {
  const controller = new AbortController()

  async function loadInitialData() {
    try {
      const [loadedUkers, loadedUser] = await Promise.all([
        fetchUkerData(controller.signal),
        fetchCurrentUser(controller.signal),
      ])

      if (!controller.signal.aborted) {
        setUkers(loadedUkers)
        setCurrentUser(loadedUser)
      }
    } catch (error) {
      if (
        error?.name === "AbortError" ||
        controller.signal.aborted
      ) {
        return
      }

      if (error?.status === 401) {
        router.replace(
          `/login?next=${encodeURIComponent(
            "/masters/uker"
          )}`
        )

        return
      }

      if (error?.status === 403) {
        router.replace("/forbidden")
        return
      }

      console.error(
        "Gagal memuat Master Uker:",
        error
      )

      setLoadError(
        getErrorMessage(
          error,
          "Gagal mengambil data unit kerja."
        )
      )
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false)
      }
    }
  }

  void loadInitialData()

  return () => {
    controller.abort()
  }
}, [router])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(
          toastTimerRef.current
        )
      }
    }
  }, [])

  useEffect(() => {
    const overlayOpen =
      modalOpen || Boolean(deleteTarget)

    if (!overlayOpen) {
      return undefined
    }

    const previousOverflow =
      document.body.style.overflow

    document.body.style.overflow =
      "hidden"

    function handleEscape(event) {
      if (
        event.key !== "Escape" ||
        saving ||
        deleting
      ) {
        return
      }

      if (deleteTarget) {
        setDeleteTarget(null)
        setDeleteError("")
        return
      }

      setModalOpen(false)
      setEditingId(null)
      setModalError("")
      setForm(EMPTY_UKER_FORM)
    }

    window.addEventListener(
      "keydown",
      handleEscape
    )

    return () => {
      document.body.style.overflow =
        previousOverflow

      window.removeEventListener(
        "keydown",
        handleEscape
      )
    }
  }, [
    deleteTarget,
    deleting,
    modalOpen,
    saving,
  ])

  const isSuperAdmin = currentUser?.roleCode === "SUPER_ADMIN"

  const cities = useMemo(() => {
    return [
      ...new Set(
        ukers
          .map((uker) =>
            String(
              uker.kota || ""
            ).trim()
          )
          .filter(Boolean)
      ),
    ].sort((first, second) =>
      first.localeCompare(
        second,
        "id-ID"
      )
    )
  }, [ukers])

  const filteredUkers = useMemo(() => {
    const keyword = searchText
      .trim()
      .toLowerCase()

    return ukers.filter((uker) => {
      const searchableValues = [
        uker.codeuker,
        uker.nama_uker,
        uker.alamat_uker,
        uker.kota,
        uker.kode_pos,
        uker.telp_branch,
        uker.gedung_branch,
        uker.email,
      ]

      const matchesKeyword =
        !keyword ||
        searchableValues.some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(keyword)
        )

      const matchesCity =
        cityFilter === "ALL" ||
        String(uker.kota || "") ===
          cityFilter

      return (
        matchesKeyword &&
        matchesCity
      )
    })
  }, [
    cityFilter,
    searchText,
    ukers,
  ])

  const totalPages = Math.max(
    1,
    Math.ceil(
      filteredUkers.length / pageSize
    )
  )

  // Batasi halaman aktif secara turunan tanpa memanggil setState di dalam effect.
  const activePage = Math.min(
    currentPage,
    totalPages
  )

  const paginatedUkers = useMemo(() => {
    const startIndex =
      (activePage - 1) * pageSize

    return filteredUkers.slice(
      startIndex,
      startIndex + pageSize
    )
  }, [
    activePage,
    filteredUkers,
    pageSize,
  ])

  const paginationPages = useMemo(() => {
    const visiblePageCount = 5
    let startPage = Math.max(
      1,
      activePage - 2
    )
    let endPage = Math.min(
      totalPages,
      startPage +
        visiblePageCount -
        1
    )

    startPage = Math.max(
      1,
      endPage -
        visiblePageCount +
        1
    )

    return Array.from(
      {
        length:
          endPage - startPage + 1,
      },
      (_, index) =>
        startPage + index
    )
  }, [activePage, totalPages])

  const summary = useMemo(() => {
    const cityCount = new Set(
      ukers
        .map((uker) =>
          String(
            uker.kota || ""
          ).trim()
        )
        .filter(Boolean)
    ).size

    return {
      total: ukers.length,

      cityCount,

      withEmail: ukers.filter(
        (uker) =>
          Boolean(
            String(
              uker.email || ""
            ).trim()
          )
      ).length,

      operational: ukers.filter(
        (uker) =>
          Boolean(uker.tanggal_ops)
      ).length,
    }
  }, [ukers])

  function showToast(type, message) {
    if (toastTimerRef.current) {
      window.clearTimeout(
        toastTimerRef.current
      )
    }

    setToast({
      open: true,
      type,
      message,
    })

    toastTimerRef.current =
      window.setTimeout(() => {
        setToast((currentToast) => ({
          ...currentToast,
          open: false,
        }))

        toastTimerRef.current = null
      }, type === "error" ? 5000 : 3500)
  }

  function handleResetFilter() {
    setSearchText("")
    setCityFilter("ALL")
    setCurrentPage(1)
  }

  function openAddModal() {
    setEditingId(null)
    setForm(EMPTY_UKER_FORM)
    setModalError("")
    setModalOpen(true)
  }

  function openEditModal(uker) {
    setEditingId(uker.id)
    setForm(mapUkerToForm(uker))
    setModalError("")
    setModalOpen(true)
  }

  function closeModal() {
    if (saving) {
      return
    }

    setModalOpen(false)
    setEditingId(null)
    setModalError("")
    setForm(EMPTY_UKER_FORM)
  }

  function openDeleteModal(uker) {
    setDeleteTarget(uker)
    setDeleteError("")
  }

  function closeDeleteModal() {
    if (deleting) {
      return
    }

    setDeleteTarget(null)
    setDeleteError("")
  }

  function handleFormInput(event) {
    const { name, value } =
      event.target

    setForm((currentForm) => ({
      ...currentForm,
      [name]:
        name === "codeuker"
          ? value.toUpperCase()
          : value,
    }))
  }

  async function handleSubmitUker(event) {
    event.preventDefault()

    if (saving) {
      return
    }

    try {
      setSaving(true)
      setModalError("")

      const payload = {
        codeuker:
          form.codeuker.trim(),
        nama_uker:
          form.nama_uker.trim(),
        alamat_uker:
          form.alamat_uker.trim(),
        kota: form.kota.trim(),
        kode_pos:
          form.kode_pos.trim(),
        telp_branch:
          form.telp_branch.trim(),
        gedung_branch:
          form.gedung_branch.trim(),
        email: form.email.trim(),
        tanggal_ops:
          form.tanggal_ops,
      }

      const result = editingId
        ? await updateUker({
            id: editingId,
            ...payload,
          })
        : await createUker(payload)

      setModalOpen(false)
      setEditingId(null)
      setForm(EMPTY_UKER_FORM)

      showToast(
        "success",
        result.message
      )

      await loadData({
        isRefresh: true,
      })
    } catch (error) {
      if (error?.status === 401) {
        router.replace(
          `/login?next=${encodeURIComponent(
            "/masters/uker"
          )}`
        )

        return
      }

      if (error?.status === 403) {
        router.replace("/forbidden")
        return
      }

      const message =
        getErrorMessage(
          error,
          editingId
            ? "Gagal memperbarui data unit kerja."
            : "Gagal menambahkan data unit kerja."
        )

      setModalError(message)
      showToast("error", message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteUker() {
    if (!deleteTarget || deleting) {
      return
    }

    try {
      setDeleting(true)
      setDeleteError("")

      const result = await deleteUker(
        deleteTarget.id
      )

      setDeleteTarget(null)

      showToast(
        "success",
        result.message
      )

      await loadData({
        isRefresh: true,
      })
    } catch (error) {
      if (error?.status === 401) {
        router.replace(
          `/login?next=${encodeURIComponent(
            "/masters/uker"
          )}`
        )

        return
      }

      if (error?.status === 403) {
        router.replace("/forbidden")
        return
      }

      const message =
        getErrorMessage(
          error,
          "Gagal menghapus data unit kerja."
        )

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
            Master Unit Kerja
          </h2>

          <p>
            Kelola informasi unit kerja,
            kode unit, alamat kantor,
            kontak, gedung, dan tanggal
            operasional.
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
            Total Unit Kerja
          </span>

          <strong>
            {summary.total}
          </strong>

          <p>
            Seluruh unit kerja terdaftar
          </p>
        </article>

        <article className="user-role-summary-card green">
          <span>
            Kota Terdaftar
          </span>

          <strong>
            {summary.cityCount}
          </strong>

          <p>
            Jumlah kota yang berbeda
          </p>
        </article>

        <article className="user-role-summary-card orange">
          <span>
            Memiliki Email
          </span>

          <strong>
            {summary.withEmail}
          </strong>

          <p>
            Unit dengan kontak email
          </p>
        </article>

        <article className="user-role-summary-card red">
          <span>
            Sudah Operasional
          </span>

          <strong>
            {summary.operational}
          </strong>

          <p>
            Memiliki tanggal operasional
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
              placeholder="Cari kode, nama, alamat, kota, telepon, atau email..."
              aria-label="Cari unit kerja"
            />

            <select
              value={cityFilter}
              onChange={(event) => {
                setCityFilter(
                  event.target.value
                )
                setCurrentPage(1)
              }}
              aria-label="Filter kota"
            >
              <option value="ALL">
                Semua Kota
              </option>

              {cities.map((city) => (
                <option
                  key={city}
                  value={city}
                >
                  {city}
                </option>
              ))}
            </select>
          </div>

          <div className="user-role-toolbar-actions">
            <button
              type="button"
              className="user-role-button secondary"
              onClick={handleResetFilter}
              disabled={
                !searchText &&
                cityFilter === "ALL"
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
                Tambah Uker
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
                <th>Kode</th>
                <th>Unit Kerja</th>
                <th>Kota</th>
                <th>Kontak</th>
                <th>Gedung</th>
                <th>Tanggal Operasional</th>
                <th>Diperbarui</th>
                <th>Aksi</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={8}
                    className="user-role-loading"
                  >
                    Memuat data unit
                    kerja...
                  </td>
                </tr>
              ) : null}

              {!loading &&
              filteredUkers.length ===
                0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="user-role-empty"
                  >
                    {ukers.length === 0
                      ? "Belum ada data unit kerja."
                      : "Tidak ada data yang sesuai dengan pencarian."}
                  </td>
                </tr>
              ) : null}

              {!loading
                ? paginatedUkers.map(
                    (uker) => (
                      <tr key={uker.id}>
                        <td>
                          <strong className="uker-code-value">
                            {uker.codeuker ||
                              "-"}
                          </strong>
                        </td>

                        <td>
                          <div className="user-role-user-cell">
                            <div className="user-role-avatar">
                              {String(
                                uker.nama_uker ||
                                  "U"
                              )
                                .charAt(0)
                                .toUpperCase()}
                            </div>

                            <div>
                              <strong>
                                {uker.nama_uker ||
                                  "-"}
                              </strong>

                              <span>
                                {uker.alamat_uker ||
                                  "Alamat belum diisi"}
                              </span>

                              <small>
                                Kode pos:{" "}
                                {uker.kode_pos ||
                                  "-"}
                              </small>
                            </div>
                          </div>
                        </td>

                        <td>
                          {uker.kota || "-"}
                        </td>

                        <td>
                          <strong>
                            {uker.telp_branch ||
                              "-"}
                          </strong>

                          <div
                            style={{
                              marginTop:
                                "4px",
                              color:
                                "var(--muted)",
                              fontSize:
                                "12px",
                            }}
                          >
                            {uker.email || "-"}
                          </div>
                        </td>

                        <td>
                          {uker.gedung_branch ||
                            "-"}
                        </td>

                        <td>
                          {formatDate(
                            uker.tanggal_ops
                          )}
                        </td>

                        <td>
                          {formatDateTime(
                            uker.updated_at ||
                              uker.created_at
                          )}
                        </td>

                        <td className="uker-action-cell">
                          <div className="uker-action-buttons">
                            <button
                              type="button"
                              className="uker-edit-button"
                              onClick={() =>
                                openEditModal(uker)
                              }
                              disabled={
                                saving || deleting
                              }
                              aria-label={`Edit unit kerja ${
                                uker.nama_uker ||
                                uker.codeuker ||
                                ""
                              }`}
                              title="Edit unit kerja"
                            >
                              Edit
                            </button>

                            {isSuperAdmin ? (
                              <button
                                type="button"
                              className="uker-delete-button"
                              onClick={() =>
                                openDeleteModal(uker)
                              }
                              disabled={
                                saving || deleting
                              }
                              aria-label={`Hapus unit kerja ${
                                uker.nama_uker ||
                                uker.codeuker ||
                                ""
                              }`}
                              title="Hapus unit kerja"
                            >
                                Hapus
                              </button>
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
        ukers.length > 0 ? (
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
                aria-label="Navigasi halaman unit kerja"
              >
                <button
                  type="button"
                  onClick={() =>
                    setCurrentPage(1)
                  }
                  disabled={
                    activePage === 1
                  }
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
                  disabled={
                    activePage === 1
                  }
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
                        page ===
                        activePage
                          ? "active"
                          : ""
                      }
                      onClick={() =>
                        setCurrentPage(
                          page
                        )
                      }
                      aria-current={
                        page ===
                        activePage
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
                    activePage ===
                    totalPages
                  }
                  aria-label="Halaman berikutnya"
                  title="Halaman berikutnya"
                >
                  ›
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setCurrentPage(
                      totalPages
                    )
                  }
                  disabled={
                    activePage ===
                    totalPages
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
            aria-labelledby="uker-modal-title"
          >
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">
                  Master Data
                </p>

                <h3 id="uker-modal-title">
                  {editingId
                    ? "Edit Unit Kerja"
                    : "Tambah Unit Kerja"}
                </h3>

                <p>
                  {editingId
                    ? "Perbarui data unit kerja. Kolom bertanda wajib harus diisi."
                    : "Isi data utama unit kerja. Kolom bertanda wajib harus diisi."}
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

            <form
              onSubmit={handleSubmitUker}
            >
              <div className="user-role-form-grid">
                <div className="user-role-form-field">
                  <label htmlFor="codeuker">
                    Kode Unit Kerja *
                  </label>

                  <input
                    id="codeuker"
                    name="codeuker"
                    value={form.codeuker}
                    onChange={handleFormInput}
                    maxLength={4}
                    disabled={!isSuperAdmin && editingId !== null}
                    placeholder="Contoh: 001A"
                    autoComplete="off"
                    required
                    autoFocus
                  />

                  <small>
                    Maksimal 4 karakter dan
                    harus unik.
                  </small>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="nama_uker">
                    Nama Unit Kerja *
                  </label>

                  <input
                    id="nama_uker"
                    name="nama_uker"
                    value={form.nama_uker}
                    onChange={handleFormInput}
                    maxLength={100}
                    placeholder="Nama unit kerja"
                    required
                  />
                </div>

                <div className="user-role-form-field full">
                  <label htmlFor="alamat_uker">
                    Alamat Unit Kerja
                  </label>

                  <input
                    id="alamat_uker"
                    name="alamat_uker"
                    value={form.alamat_uker}
                    onChange={handleFormInput}
                    maxLength={255}
                    placeholder="Alamat lengkap"
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="kota">
                    Kota
                  </label>

                  <input
                    id="kota"
                    name="kota"
                    value={form.kota}
                    onChange={handleFormInput}
                    maxLength={200}
                    placeholder="Nama kota"
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="kode_pos">
                    Kode Pos
                  </label>

                  <input
                    id="kode_pos"
                    name="kode_pos"
                    value={form.kode_pos}
                    onChange={handleFormInput}
                    maxLength={50}
                    placeholder="Kode pos"
                    inputMode="numeric"
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="telp_branch">
                    Nomor Telepon
                  </label>

                  <input
                    id="telp_branch"
                    name="telp_branch"
                    value={form.telp_branch}
                    onChange={handleFormInput}
                    maxLength={255}
                    placeholder="Nomor telepon kantor"
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
                    maxLength={255}
                    placeholder="uker@perusahaan.co.id"
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="gedung_branch">
                    Gedung
                  </label>

                  <select
                    id="gedung_branch"
                    name="gedung_branch"
                    value={form.gedung_branch}
                    onChange={handleFormInput}
                  >
                    <option value="">
                      Pilih status gedung
                    </option>
                    <option value="Sewa">
                      Sewa
                    </option>
                    <option value="Milik">
                      Milik
                    </option>
                  </select>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="tanggal_ops">
                    Tanggal Operasional
                  </label>

                  <input
                    id="tanggal_ops"
                    name="tanggal_ops"
                    type="date"
                    value={form.tanggal_ops}
                    onChange={handleFormInput}
                  />
                </div>
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
                      : "Simpan Uker"}
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
            aria-labelledby="delete-uker-title"
            aria-describedby="delete-uker-description"
          >
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">
                  Konfirmasi
                </p>

                <h3 id="delete-uker-title">
                  Hapus Unit Kerja?
                </h3>

                <p id="delete-uker-description">
                  Data yang sudah dihapus tidak
                  dapat dikembalikan.
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
                <span>Unit kerja yang akan dihapus</span>

                <strong>
                  {deleteTarget.nama_uker || "-"}
                </strong>

                <small>
                  Kode: {deleteTarget.codeuker || "-"}
                  {deleteTarget.kota
                    ? ` · ${deleteTarget.kota}`
                    : ""}
                </small>
              </div>

              <p className="uker-delete-warning">
                Pastikan unit kerja ini tidak lagi
                digunakan pada data transaksi atau
                data master lainnya.
              </p>

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
                onClick={handleDeleteUker}
                disabled={deleting}
              >
                {deleting
                  ? "Menghapus..."
                  : "Ya, Hapus Uker"}
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

        @media (max-width: 760px) {
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