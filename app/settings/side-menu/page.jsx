"use client"

import Link from "next/link"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

const EMPTY_FORM = {
  id: null,
  label: "",
  href: "",
  icon: "IconGrid",
  badge: "",
  sort_order: "",
  is_active: true,
}

const ICON_OPTIONS = [
  {
    value: "IconGrid",
    label: "Grid",
  },
  {
    value: "IconUsers",
    label: "Users",
  },
  {
    value: "IconTransfer",
    label: "Transfer",
  },
  {
    value: "IconShield",
    label: "Shield",
  },
  {
    value: "IconReport",
    label: "Report",
  },
  {
    value: "IconCog",
    label: "Cog",
  },
]

function sortMenus(data) {
  return [...data].sort((firstMenu, secondMenu) => {
    const firstOrder = Number(firstMenu.sort_order || 0)
    const secondOrder = Number(secondMenu.sort_order || 0)

    if (firstOrder !== secondOrder) {
      return firstOrder - secondOrder
    }

    return Number(firstMenu.id) - Number(secondMenu.id)
  })
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

function getErrorMessage(error, fallbackMessage) {
  if (error instanceof Error) {
    return error.message
  }

  return fallbackMessage
}

function formatDate(value) {
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

export default function SideMenuMaintenancePage() {
  const toastTimerRef = useRef(null)

  const [menus, setMenus] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [modalErrorMessage, setModalErrorMessage] =
    useState("")
  const [loadErrorMessage, setLoadErrorMessage] =
    useState("")

  const [toast, setToast] = useState({
    open: false,
    id: 0,
    type: "success",
    title: "",
    message: "",
  })

  const isEditing = form.id !== null

  const nextSortOrder = useMemo(() => {
    if (menus.length === 0) {
      return 1
    }

    const highestOrder = Math.max(
      ...menus.map((menu) =>
        Number(menu.sort_order || 0)
      )
    )

    return highestOrder + 1
  }, [menus])

  const closeToast = useCallback(() => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }

    setToast((currentToast) => ({
      ...currentToast,
      open: false,
    }))
  }, [])

  const showToast = useCallback((type, message) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current)
    }

    const duration =
      type === "error" ? 5000 : 3500

    setToast({
      open: true,
      id: Date.now(),
      type,
      title:
        type === "success"
          ? "Berhasil"
          : "Proses gagal",
      message,
    })

    toastTimerRef.current = window.setTimeout(() => {
      setToast((currentToast) => ({
        ...currentToast,
        open: false,
      }))

      toastTimerRef.current = null
    }, duration)
  }, [])

  const fetchMenus = useCallback(async (signal) => {
    const response = await fetch(
      "/api/settings/side-menu",
      {
        method: "GET",
        cache: "no-store",
        signal,
      }
    )

    const result = await readJsonResponse(response)

    if (!response.ok || !result.success) {
      throw new Error(
        result.message ||
          "Gagal mengambil data side menu."
      )
    }

    return Array.isArray(result.data)
      ? sortMenus(result.data)
      : []
  }, [])

  const loadMenus = useCallback(async () => {
    try {
      setLoading(true)
      setLoadErrorMessage("")

      const data = await fetchMenus()

      setMenus(data)

      return true
    } catch (error) {
      console.error(
        "Gagal mengambil data side menu:",
        error
      )

      const message = getErrorMessage(
        error,
        "Gagal mengambil data side menu."
      )

      setLoadErrorMessage(message)
      showToast("error", message)

      return false
    } finally {
      setLoading(false)
    }
  }, [fetchMenus, showToast])

  useEffect(() => {
    const controller = new AbortController()

    async function loadInitialMenus() {
      try {
        const data = await fetchMenus(
          controller.signal
        )

        if (!controller.signal.aborted) {
          setMenus(data)
          setLoadErrorMessage("")
        }
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          return
        }

        console.error(
          "Gagal mengambil data side menu:",
          error
        )

        if (!controller.signal.aborted) {
          const message = getErrorMessage(
            error,
            "Gagal mengambil data side menu."
          )

          setLoadErrorMessage(message)
          showToast("error", message)
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void loadInitialMenus()

    return () => {
      controller.abort()
    }
  }, [fetchMenus, showToast])

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
    if (!modalOpen) {
      return undefined
    }

    const previousOverflow =
      document.body.style.overflow

    document.body.style.overflow = "hidden"

    function handleEscape(event) {
      if (
        event.key === "Escape" &&
        !saving
      ) {
        setModalOpen(false)
        setModalErrorMessage("")
        setForm(EMPTY_FORM)
      }
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
  }, [modalOpen, saving])

  function handleInputChange(event) {
    const {
      name,
      value,
      type,
      checked,
    } = event.target

    setForm((currentForm) => ({
      ...currentForm,
      [name]:
        type === "checkbox"
          ? checked
          : value,
    }))
  }

  function openAddModal() {
    setForm({
      ...EMPTY_FORM,
      sort_order: String(nextSortOrder),
    })

    setModalErrorMessage("")
    setModalOpen(true)
  }

  function openEditModal(menu) {
    setForm({
      id: menu.id,
      label: menu.label || "",
      href: menu.href || "",
      icon: menu.icon || "IconGrid",
      badge: menu.badge || "",
      sort_order: String(
        menu.sort_order || ""
      ),
      is_active: Boolean(menu.is_active),
    })

    setModalErrorMessage("")
    setModalOpen(true)
  }

  function closeModal() {
    if (saving) {
      return
    }

    setModalOpen(false)
    setModalErrorMessage("")
    setForm(EMPTY_FORM)
  }

  function notifySidebarChanged() {
    window.dispatchEvent(
      new Event("sidebar-menu-updated")
    )
  }

  async function handleSubmit(event) {
    event.preventDefault()

    try {
      setSaving(true)
      setModalErrorMessage("")

      const payload = {
        id: form.id,
        label: form.label.trim(),
        href: form.href.trim(),
        icon: form.icon,
        badge: form.badge.trim(),
        sort_order: Number(form.sort_order),
        is_active: form.is_active,
      }

      const response = await fetch(
        "/api/settings/side-menu",
        {
          method: isEditing
            ? "PUT"
            : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      )

      const result =
        await readJsonResponse(response)

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
            "Data side menu gagal disimpan."
        )
      }

      if (result.data?.id) {
        setMenus((currentMenus) => {
          const remainingMenus =
            currentMenus.filter(
              (menu) =>
                Number(menu.id) !==
                Number(result.data.id)
            )

          return sortMenus([
            ...remainingMenus,
            result.data,
          ])
        })
      } else {
        await loadMenus()
      }

      setModalOpen(false)
      setModalErrorMessage("")
      setForm(EMPTY_FORM)

      notifySidebarChanged()

      showToast(
        "success",
        result.message ||
          (isEditing
            ? "Menu berhasil diperbarui."
            : "Menu berhasil ditambahkan.")
      )
    } catch (error) {
      console.error(
        "Gagal menyimpan side menu:",
        error
      )

      const message = getErrorMessage(
        error,
        "Data side menu gagal disimpan."
      )

      setModalErrorMessage(message)
      showToast("error", message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(menu) {
    const approved = window.confirm(
      `Hapus menu "${menu.label}" secara permanen?`
    )

    if (!approved) {
      return
    }

    try {
      setDeletingId(menu.id)

      const response = await fetch(
        `/api/settings/side-menu?id=${menu.id}`,
        {
          method: "DELETE",
        }
      )

      const result =
        await readJsonResponse(response)

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
            "Menu gagal dihapus."
        )
      }

      setMenus((currentMenus) =>
        currentMenus.filter(
          (currentMenu) =>
            Number(currentMenu.id) !==
            Number(menu.id)
        )
      )

      notifySidebarChanged()

      showToast(
        "success",
        result.message ||
          "Menu berhasil dihapus."
      )
    } catch (error) {
      console.error(
        "Gagal menghapus side menu:",
        error
      )

      const message = getErrorMessage(
        error,
        "Menu gagal dihapus."
      )

      showToast("error", message)
    } finally {
      setDeletingId(null)
    }
  }

  const toastIsSuccess =
    toast.type === "success"

  const toastAccentColor = toastIsSuccess
    ? "#16a34a"
    : "#dc2626"

  const toastBorderColor = toastIsSuccess
    ? "#bbf7d0"
    : "#fecaca"

  return (
    <div className="simple-page">
      <section className="page-heading-card">
        <p className="eyebrow">
          Settings
        </p>

        <h2>
          Maintenance Side Menu
        </h2>

        <p>
          Tambah, ubah, hapus, dan atur
          status menu sidebar.
        </p>
      </section>

      <section className="settings-card">
        <div className="side-menu-toolbar">
          <div>
            <strong>
              Data Side Menu
            </strong>

            <p>
              Total data: {menus.length} menu
            </p>
          </div>

          <div className="side-menu-toolbar-actions">
            <button
              type="button"
              className="side-menu-button secondary"
              onClick={() => loadMenus()}
              disabled={loading}
            >
              {loading
                ? "Memuat..."
                : "Muat Ulang"}
            </button>

            <button
              type="button"
              className="side-menu-button primary"
              onClick={openAddModal}
            >
              Tambah Menu
            </button>

            <Link
              href="/settings"
              className="side-menu-button secondary"
            >
              Kembali
            </Link>
          </div>
        </div>

        {loadErrorMessage ? (
          <div className="side-menu-alert error">
            <strong>
              Data gagal dimuat.
            </strong>

            <div
              style={{
                marginTop: "6px",
              }}
            >
              {loadErrorMessage}
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="side-menu-loading">
            Memuat data side menu...
          </div>
        ) : null}

        {!loading &&
        !loadErrorMessage ? (
          <div className="side-menu-table-wrapper">
            <table className="side-menu-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nama Menu</th>
                  <th>URL</th>
                  <th>Ikon</th>
                  <th>Badge</th>
                  <th>Urutan</th>
                  <th>Status</th>
                  <th>Dibuat</th>
                  <th>Aksi</th>
                </tr>
              </thead>

              <tbody>
                {menus.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="side-menu-empty"
                    >
                      Data side menu belum
                      tersedia.
                    </td>
                  </tr>
                ) : (
                  menus.map((menu) => (
                    <tr key={menu.id}>
                      <td>
                        {menu.id}
                      </td>

                      <td>
                        <strong>
                          {menu.label}
                        </strong>
                      </td>

                      <td>
                        {menu.href}
                      </td>

                      <td>
                        {menu.icon}
                      </td>

                      <td>
                        {menu.badge || "-"}
                      </td>

                      <td>
                        {menu.sort_order}
                      </td>

                      <td>
                        <span
                          className={
                            menu.is_active
                              ? "side-menu-status active"
                              : "side-menu-status inactive"
                          }
                        >
                          {menu.is_active
                            ? "Aktif"
                            : "Tidak Aktif"}
                        </span>
                      </td>

                      <td>
                        {formatDate(
                          menu.created_at
                        )}
                      </td>

                      <td>
                        <div className="side-menu-actions">
                          <button
                            type="button"
                            className="side-menu-action edit"
                            onClick={() =>
                              openEditModal(menu)
                            }
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            className="side-menu-action delete"
                            onClick={() =>
                              handleDelete(menu)
                            }
                            disabled={
                              deletingId ===
                              menu.id
                            }
                          >
                            {deletingId ===
                            menu.id
                              ? "Menghapus..."
                              : "Hapus"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {toast.open ? (
        <div
          key={toast.id}
          role={
            toastIsSuccess
              ? "status"
              : "alert"
          }
          aria-live={
            toastIsSuccess
              ? "polite"
              : "assertive"
          }
          style={{
            position: "fixed",
            top: "24px",
            right: "24px",
            zIndex: 20000,
            width: "min(390px, calc(100vw - 48px))",
            display: "grid",
            gridTemplateColumns:
              "42px minmax(0, 1fr) 30px",
            alignItems: "start",
            gap: "12px",
            padding: "16px",
            overflow: "hidden",
            border: `1px solid ${toastBorderColor}`,
            borderRadius: "16px",
            background: "#ffffff",
            boxShadow:
              "0 20px 55px rgba(5, 20, 43, 0.24)",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              width: "5px",
              background: toastAccentColor,
            }}
          />

          <div
            style={{
              width: "38px",
              height: "38px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "50%",
              background: toastAccentColor,
              color: "#ffffff",
              fontSize: "19px",
              fontWeight: 800,
            }}
          >
            {toastIsSuccess ? "✓" : "!"}
          </div>

          <div
            style={{
              minWidth: 0,
              paddingTop: "1px",
            }}
          >
            <strong
              style={{
                display: "block",
                marginBottom: "4px",
                color: "#172033",
                fontSize: "14px",
              }}
            >
              {toast.title}
            </strong>

            <p
              style={{
                margin: 0,
                color: "#64748b",
                fontSize: "13px",
                lineHeight: 1.5,
                overflowWrap: "anywhere",
              }}
            >
              {toast.message}
            </p>
          </div>

          <button
            type="button"
            onClick={closeToast}
            aria-label="Tutup notifikasi"
            style={{
              width: "30px",
              height: "30px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              border: "none",
              borderRadius: "50%",
              background: "#f1f5f9",
              color: "#64748b",
              fontSize: "20px",
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
      ) : null}

      {modalOpen ? (
        <div
          className="side-menu-modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeModal()
            }
          }}
        >
          <section
            className="side-menu-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="side-menu-modal-title"
          >
            <header className="side-menu-modal-header">
              <div>
                <p className="eyebrow">
                  Side Menu
                </p>

                <h3 id="side-menu-modal-title">
                  {isEditing
                    ? "Ubah Side Menu"
                    : "Tambah Side Menu"}
                </h3>

                <p>
                  Isi informasi menu lalu
                  simpan perubahan.
                </p>
              </div>

              <button
                type="button"
                className="side-menu-modal-close"
                onClick={closeModal}
                disabled={saving}
                aria-label="Tutup popup"
              >
                ×
              </button>
            </header>

            <form onSubmit={handleSubmit}>
              <div className="side-menu-form-grid">
                <div className="side-menu-form-field">
                  <label htmlFor="label">
                    Nama Menu
                  </label>

                  <input
                    id="label"
                    name="label"
                    type="text"
                    value={form.label}
                    onChange={
                      handleInputChange
                    }
                    maxLength={100}
                    placeholder="Contoh: Dashboard"
                    required
                    autoFocus
                  />
                </div>

                <div className="side-menu-form-field">
                  <label htmlFor="href">
                    URL
                  </label>

                  <input
                    id="href"
                    name="href"
                    type="text"
                    value={form.href}
                    onChange={
                      handleInputChange
                    }
                    maxLength={200}
                    placeholder="/dashboard"
                    required
                  />
                </div>

                <div className="side-menu-form-field">
                  <label htmlFor="icon">
                    Ikon
                  </label>

                  <select
                    id="icon"
                    name="icon"
                    value={form.icon}
                    onChange={
                      handleInputChange
                    }
                    required
                  >
                    {ICON_OPTIONS.map(
                      (icon) => (
                        <option
                          key={icon.value}
                          value={icon.value}
                        >
                          {icon.label} (
                          {icon.value})
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div className="side-menu-form-field">
                  <label htmlFor="badge">
                    Badge
                  </label>

                  <input
                    id="badge"
                    name="badge"
                    type="text"
                    value={form.badge}
                    onChange={
                      handleInputChange
                    }
                    maxLength={20}
                    placeholder="Live atau 12"
                  />
                </div>

                <div className="side-menu-form-field">
                  <label htmlFor="sort_order">
                    Urutan
                  </label>

                  <input
                    id="sort_order"
                    name="sort_order"
                    type="number"
                    min="1"
                    step="1"
                    value={form.sort_order}
                    onChange={
                      handleInputChange
                    }
                    placeholder="1"
                    required
                  />
                </div>

                <div className="side-menu-form-field">
                  <label>
                    Status
                  </label>

                  <label className="side-menu-checkbox">
                    <input
                      name="is_active"
                      type="checkbox"
                      checked={
                        form.is_active
                      }
                      onChange={
                        handleInputChange
                      }
                    />

                    <span>
                      Menu aktif
                    </span>
                  </label>
                </div>
              </div>

              {modalErrorMessage ? (
                <div className="side-menu-modal-error">
                  {modalErrorMessage}
                </div>
              ) : null}

              <footer className="side-menu-modal-footer">
                <button
                  type="button"
                  className="side-menu-button secondary"
                  onClick={closeModal}
                  disabled={saving}
                >
                  Batal
                </button>

                <button
                  type="submit"
                  className="side-menu-button primary"
                  disabled={saving}
                >
                  {saving
                    ? "Menyimpan..."
                    : isEditing
                      ? "Simpan Perubahan"
                      : "Tambah Menu"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  )
}