"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"

const EMPTY_USER_FORM = {
  id: null,
  username: "",
  pegawai_id: "",
  full_name: "",
  email: "",
  password: "",
  role_id: "",
  codeuker: "",
  is_active: true,
}

const EMPTY_PASSWORD_FORM = {
  user_id: null,
  username: "",
  password: "",
  confirm_password: "",
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

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || ""

  if (!contentType.includes("application/json")) {
    throw new Error(`Endpoint tidak mengembalikan JSON. Status ${response.status}.`)
  }

  return response.json()
}

async function fetchUserRoleData(signal) {
  const response = await fetch("/api/settings/user-role", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    signal,
  })

  const result = await readJsonResponse(response)

  if (!response.ok || !result.success) {
    const error = new Error(result.message || "Gagal mengambil data user role.")
    error.status = response.status
    throw error
  }

  return result.data
}

function getErrorMessage(error, fallbackMessage) {
  return error instanceof Error ? error.message : fallbackMessage
}

function buildPermissionSelection(permissions, roleId) {
  return new Set(
    permissions
      .filter((permission) => Number(permission.role_id) === Number(roleId))
      .map((permission) => Number(permission.sidebar_route_id))
  )
}

export default function UserRoleMaintenancePage() {
  const router = useRouter()
  const toastTimerRef = useRef(null)

  const [activeTab, setActiveTab] = useState("users")
  const [data, setData] = useState({
    currentUserId: null,
    users: [],
    roles: [],
    menus: [],
    permissions: [],
    pegawai: [],
  })

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState("")

  const [searchText, setSearchText] = useState("")
  const [roleFilter, setRoleFilter] = useState("ALL")
  const [statusFilter, setStatusFilter] = useState("ALL")

  const [userModalOpen, setUserModalOpen] = useState(false)
  const [userForm, setUserForm] = useState(EMPTY_USER_FORM)
  const [userModalError, setUserModalError] = useState("")

  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [passwordForm, setPasswordForm] = useState(EMPTY_PASSWORD_FORM)
  const [passwordModalError, setPasswordModalError] = useState("")

  const [deleteUserTarget, setDeleteUserTarget] = useState(null)
  const [deletingUser, setDeletingUser] = useState(false)
  const [deleteUserError, setDeleteUserError] = useState("")

  const [selectedRoleId, setSelectedRoleId] = useState("")
  const [permissionSelection, setPermissionSelection] = useState(new Set())

  const [toast, setToast] = useState({
    open: false,
    type: "success",
    message: "",
  })

  const isEditing = userForm.id !== null

  function showToast(type, message) {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current)
    }

    setToast({
      open: true,
      type,
      message,
    })

    toastTimerRef.current = window.setTimeout(() => {
      setToast((currentToast) => ({
        ...currentToast,
        open: false,
      }))
      toastTimerRef.current = null
    }, type === "error" ? 5000 : 3500)
  }

  function applyLoadedData(loadedData) {
    const normalizedData = {
      currentUserId: loadedData.currentUserId,
      users: Array.isArray(loadedData.users) ? loadedData.users : [],
      roles: Array.isArray(loadedData.roles) ? loadedData.roles : [],
      menus: Array.isArray(loadedData.menus) ? loadedData.menus : [],
      permissions: Array.isArray(loadedData.permissions)
        ? loadedData.permissions
        : [],
      pegawai: Array.isArray(loadedData.pegawai) ? loadedData.pegawai : [],
    }

    setData(normalizedData)

    const nextRoleId =
      selectedRoleId ||
      String(normalizedData.roles.find((role) => role.role_code !== "SUPER_ADMIN")?.id || normalizedData.roles[0]?.id || "")

    setSelectedRoleId(nextRoleId)
    setPermissionSelection(
      buildPermissionSelection(normalizedData.permissions, nextRoleId)
    )
  }

  async function reloadData() {
    try {
      setLoading(true)
      setLoadError("")

      const loadedData = await fetchUserRoleData()
      applyLoadedData(loadedData)
      return true
    } catch (error) {
      console.error("Gagal memuat user role:", error)

      if (error?.status === 401) {
        router.replace("/login")
        return false
      }

      if (error?.status === 403) {
        router.replace("/forbidden")
        return false
      }

      const message = getErrorMessage(error, "Gagal mengambil data user role.")
      setLoadError(message)
      showToast("error", message)
      return false
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()

    fetchUserRoleData(controller.signal)
      .then((loadedData) => {
        if (!controller.signal.aborted) {
          const normalizedData = {
            currentUserId: loadedData.currentUserId,
            users: Array.isArray(loadedData.users) ? loadedData.users : [],
            roles: Array.isArray(loadedData.roles) ? loadedData.roles : [],
            menus: Array.isArray(loadedData.menus) ? loadedData.menus : [],
            permissions: Array.isArray(loadedData.permissions)
              ? loadedData.permissions
              : [],
            pegawai: Array.isArray(loadedData.pegawai) ? loadedData.pegawai : [],
          }

          setData(normalizedData)

          const initialRoleId = String(
            normalizedData.roles.find((role) => role.role_code !== "SUPER_ADMIN")?.id ||
              normalizedData.roles[0]?.id ||
              ""
          )

          setSelectedRoleId(initialRoleId)
          setPermissionSelection(
            buildPermissionSelection(normalizedData.permissions, initialRoleId)
          )
          setLoadError("")
        }
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === "AbortError") {
          return
        }

        if (error?.status === 401) {
          router.replace("/login")
          return
        }

        if (error?.status === 403) {
          router.replace("/forbidden")
          return
        }

        console.error("Gagal memuat user role:", error)
        setLoadError(getErrorMessage(error, "Gagal mengambil data user role."))
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => {
      controller.abort()
    }
  }, [router])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!userModalOpen && !passwordModalOpen && !deleteUserTarget) {
      return undefined
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    function handleEscape(event) {
      if (event.key !== "Escape" || saving || deletingUser) {
        return
      }

      setUserModalOpen(false)
      setPasswordModalOpen(false)
      setDeleteUserTarget(null)
      setUserModalError("")
      setPasswordModalError("")
      setDeleteUserError("")
    }

    window.addEventListener("keydown", handleEscape)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleEscape)
    }
  }, [deleteUserTarget, deletingUser, passwordModalOpen, saving, userModalOpen])

  const filteredUsers = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()

    return data.users.filter((user) => {
      const matchesKeyword =
        !keyword ||
        user.username?.toLowerCase().includes(keyword) ||
        user.full_name?.toLowerCase().includes(keyword) ||
        user.email?.toLowerCase().includes(keyword) ||
        user.pegawai_nip?.toLowerCase().includes(keyword) ||
        user.pegawai_nama?.toLowerCase().includes(keyword) ||
        user.pegawai_jabatan?.toLowerCase().includes(keyword) ||
        user.role_name?.toLowerCase().includes(keyword) ||
        user.codeuker?.toLowerCase().includes(keyword) ||
        user.uker_name?.toLowerCase().includes(keyword) ||
        user.pegawai_uker_name?.toLowerCase().includes(keyword)

      const matchesRole =
        roleFilter === "ALL" || user.role_code === roleFilter

      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "ACTIVE" && user.is_active) ||
        (statusFilter === "INACTIVE" && !user.is_active) ||
        (statusFilter === "LOCKED" && user.is_locked)

      return matchesKeyword && matchesRole && matchesStatus
    })
  }, [data.users, roleFilter, searchText, statusFilter])

  const summary = useMemo(() => {
    return {
      total: data.users.length,
      active: data.users.filter((user) => user.is_active).length,
      locked: data.users.filter((user) => user.is_locked).length,
      roleCount: data.roles.length,
    }
  }, [data.roles.length, data.users])

  const selectedRole = data.roles.find(
    (role) => Number(role.id) === Number(selectedRoleId)
  )

  const selectedUserFormRole = data.roles.find(
    (role) => Number(role.id) === Number(userForm.role_id)
  )

  const selectedPegawai = data.pegawai.find(
    (pegawai) => Number(pegawai.id) === Number(userForm.pegawai_id)
  )

  const requiresPegawai =
    selectedUserFormRole?.role_code !== "SUPER_ADMIN"

  const availablePegawai = data.pegawai.filter((pegawai) => {
    const isCurrentSelection =
      Number(pegawai.user_id) === Number(userForm.id)

    return (
      isCurrentSelection ||
      (Boolean(pegawai.status) && !pegawai.user_id)
    )
  })

  function openAddUserModal() {
    const defaultRole =
      data.roles.find((role) => role.role_code !== "SUPER_ADMIN") ||
      data.roles[0]

    setUserForm({
      ...EMPTY_USER_FORM,
      role_id: String(defaultRole?.id || ""),
    })
    setUserModalError("")
    setUserModalOpen(true)
  }

  function openEditUserModal(user) {
    setUserForm({
      id: user.id,
      username: user.username || "",
      pegawai_id: String(user.pegawai_id || ""),
      full_name: user.full_name || "",
      email: user.email || "",
      password: "",
      role_id: String(user.role_id || ""),
      codeuker: user.codeuker || "",
      is_active: Boolean(user.is_active),
    })
    setUserModalError("")
    setUserModalOpen(true)
  }

  function openPasswordModal(user) {
    setPasswordForm({
      user_id: user.id,
      username: user.username,
      password: "",
      confirm_password: "",
    })
    setPasswordModalError("")
    setPasswordModalOpen(true)
  }

  function closeUserModal() {
    if (saving) {
      return
    }

    setUserModalOpen(false)
    setUserModalError("")
    setUserForm(EMPTY_USER_FORM)
  }

  function closePasswordModal() {
    if (saving) {
      return
    }

    setPasswordModalOpen(false)
    setPasswordModalError("")
    setPasswordForm(EMPTY_PASSWORD_FORM)
  }

  function openDeleteUserModal(user) {
    setDeleteUserTarget(user)
    setDeleteUserError("")
  }

  function closeDeleteUserModal() {
    if (deletingUser) {
      return
    }

    setDeleteUserTarget(null)
    setDeleteUserError("")
  }

  async function handleDeleteUser() {
    if (!deleteUserTarget || deletingUser) {
      return
    }

    try {
      setDeletingUser(true)
      setDeleteUserError("")

      const response = await fetch("/api/settings/user-role", {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: deleteUserTarget.id,
        }),
      })

      const result = await readJsonResponse(response)

      if (!response.ok || !result.success) {
        const error = new Error(result.message || "User gagal dihapus.")
        error.status = response.status
        throw error
      }

      setDeleteUserTarget(null)
      await reloadData()
      showToast("success", result.message || "User berhasil dihapus.")
    } catch (error) {
      console.error("Gagal menghapus user:", error)

      if (error?.status === 401) {
        router.replace("/login")
        return
      }

      if (error?.status === 403) {
        router.replace("/forbidden")
        return
      }

      const message = getErrorMessage(error, "User gagal dihapus.")
      setDeleteUserError(message)
      showToast("error", message)
    } finally {
      setDeletingUser(false)
    }
  }

  function handleUserInput(event) {
    const { name, value, type, checked } = event.target

    setUserForm((currentForm) => ({
      ...currentForm,
      [name]: type === "checkbox" ? checked : value,
    }))
  }

  function handlePegawaiChange(event) {
    const pegawaiId = event.target.value
    const pegawai = data.pegawai.find(
      (item) => Number(item.id) === Number(pegawaiId)
    )

    setUserForm((currentForm) => ({
      ...currentForm,
      pegawai_id: pegawaiId,
      full_name: pegawai?.nama || "",
      email: pegawai?.email || "",
      codeuker: pegawai?.codeuker || "",
    }))
  }

  function handleRoleChange(event) {
    const roleId = event.target.value
    const role = data.roles.find(
      (item) => Number(item.id) === Number(roleId)
    )

    setUserForm((currentForm) => ({
      ...currentForm,
      role_id: roleId,
      codeuker:
        role?.role_code === "SUPER_ADMIN"
          ? ""
          : selectedPegawai?.codeuker || currentForm.codeuker || "",
    }))
  }

  async function handleUserSubmit(event) {
    event.preventDefault()

    try {
      setSaving(true)
      setUserModalError("")

      const payload = {
        id: userForm.id,
        username: userForm.username.trim().toLowerCase(),
        pegawai_id: userForm.pegawai_id
          ? Number(userForm.pegawai_id)
          : null,
        full_name: userForm.full_name.trim(),
        email: userForm.email.trim(),
        password: userForm.password,
        role_id: Number(userForm.role_id),
        codeuker: userForm.codeuker,
        is_active: userForm.is_active,
      }

      const response = await fetch("/api/settings/user-role", {
        method: isEditing ? "PUT" : "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      const result = await readJsonResponse(response)

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Data user gagal disimpan.")
      }

      setUserModalOpen(false)
      setUserForm(EMPTY_USER_FORM)
      await reloadData()
      showToast("success", result.message || "Data user berhasil disimpan.")
    } catch (error) {
      console.error("Gagal menyimpan user:", error)
      const message = getErrorMessage(error, "Data user gagal disimpan.")
      setUserModalError(message)
      showToast("error", message)
    } finally {
      setSaving(false)
    }
  }

  async function handlePasswordReset(event) {
    event.preventDefault()

    if (passwordForm.password !== passwordForm.confirm_password) {
      setPasswordModalError("Konfirmasi password tidak sama.")
      return
    }

    try {
      setSaving(true)
      setPasswordModalError("")

      const response = await fetch("/api/settings/user-role", {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "reset_password",
          user_id: passwordForm.user_id,
          password: passwordForm.password,
        }),
      })

      const result = await readJsonResponse(response)

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Password gagal direset.")
      }

      setPasswordModalOpen(false)
      setPasswordForm(EMPTY_PASSWORD_FORM)
      showToast("success", result.message || "Password berhasil direset.")

      if (result.data?.selfReset) {
        window.setTimeout(() => {
          router.replace("/login")
          router.refresh()
        }, 800)
      } else {
        await reloadData()
      }
    } catch (error) {
      console.error("Gagal reset password:", error)
      const message = getErrorMessage(error, "Password gagal direset.")
      setPasswordModalError(message)
      showToast("error", message)
    } finally {
      setSaving(false)
    }
  }

  async function handleUnlockUser(user) {
    const approved = window.confirm(`Buka kunci akun ${user.username}?`)

    if (!approved) {
      return
    }

    try {
      const response = await fetch("/api/settings/user-role", {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "unlock_user",
          user_id: user.id,
        }),
      })

      const result = await readJsonResponse(response)

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Kunci akun gagal dibuka.")
      }

      await reloadData()
      showToast("success", result.message || "Kunci akun berhasil dibuka.")
    } catch (error) {
      console.error("Gagal membuka akun:", error)
      showToast("error", getErrorMessage(error, "Kunci akun gagal dibuka."))
    }
  }

  function handleRoleSelection(event) {
    const roleId = event.target.value
    setSelectedRoleId(roleId)
    setPermissionSelection(buildPermissionSelection(data.permissions, roleId))
  }

  function togglePermission(menuId) {
    if (selectedRole?.role_code === "SUPER_ADMIN") {
      return
    }

    setPermissionSelection((currentSelection) => {
      const nextSelection = new Set(currentSelection)

      if (nextSelection.has(menuId)) {
        nextSelection.delete(menuId)
      } else {
        nextSelection.add(menuId)
      }

      return nextSelection
    })
  }

  async function savePermissions() {
    try {
      setSaving(true)

      const response = await fetch("/api/settings/user-role", {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "save_permissions",
          role_id: Number(selectedRoleId),
          menu_ids: [...permissionSelection],
        }),
      })

      const result = await readJsonResponse(response)

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Hak akses gagal disimpan.")
      }

      await reloadData()
      window.dispatchEvent(new Event("sidebar-menu-updated"))
      showToast("success", result.message || "Hak akses berhasil disimpan.")
    } catch (error) {
      console.error("Gagal menyimpan permission:", error)
      showToast("error", getErrorMessage(error, "Hak akses gagal disimpan."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="simple-page user-role-page">
      <section className="page-heading-card user-role-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>User Role & Access</h2>
          <p>
            Kelola akun pengguna, penempatan role, status akun, password, dan
            hak akses menu tanpa mengubah template aplikasi.
          </p>
        </div>

        <Link href="/settings" className="user-role-button secondary">
          Kembali
        </Link>
      </section>

      <section className="user-role-summary-grid">
        <article className="user-role-summary-card">
          <span>Total User</span>
          <strong>{summary.total}</strong>
          <p>Seluruh akun terdaftar</p>
        </article>

        <article className="user-role-summary-card green">
          <span>User Aktif</span>
          <strong>{summary.active}</strong>
          <p>Akun yang dapat login</p>
        </article>

        <article className="user-role-summary-card red">
          <span>Akun Terkunci</span>
          <strong>{summary.locked}</strong>
          <p>Perlu dibuka oleh admin</p>
        </article>

        <article className="user-role-summary-card orange">
          <span>Role Aktif</span>
          <strong>{summary.roleCount}</strong>
          <p>Role yang dapat digunakan</p>
        </article>
      </section>

      <section className="settings-card user-role-panel">
        <div className="user-role-tabs" role="tablist">
          <button
            type="button"
            className={activeTab === "users" ? "active" : ""}
            onClick={() => setActiveTab("users")}
          >
            Manajemen User
          </button>

          <button
            type="button"
            className={activeTab === "permissions" ? "active" : ""}
            onClick={() => setActiveTab("permissions")}
          >
            Hak Akses Role
          </button>
        </div>

        {loadError ? (
          <div className="user-role-alert error">
            <strong>Data gagal dimuat.</strong>
            <span>{loadError}</span>
          </div>
        ) : null}

        {activeTab === "users" ? (
          <>
            <div className="user-role-toolbar">
              <div className="user-role-filters">
                <input
                  type="search"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Cari nama, NIP, username, email, atau role..."
                />

                <select
                  value={roleFilter}
                  onChange={(event) => setRoleFilter(event.target.value)}
                >
                  <option value="ALL">Semua role</option>
                  {data.roles.map((role) => (
                    <option key={role.id} value={role.role_code}>
                      {role.role_name}
                    </option>
                  ))}
                </select>

                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="ALL">Semua status</option>
                  <option value="ACTIVE">Aktif</option>
                  <option value="INACTIVE">Tidak aktif</option>
                  <option value="LOCKED">Terkunci</option>
                </select>
              </div>

              <div className="user-role-toolbar-actions">
                <button
                  type="button"
                  className="user-role-button secondary"
                  onClick={() => reloadData()}
                  disabled={loading}
                >
                  {loading ? "Memuat..." : "Muat Ulang"}
                </button>

                <button
                  type="button"
                  className="user-role-button primary"
                  onClick={openAddUserModal}
                >
                  Tambah User
                </button>
              </div>
            </div>

            {loading ? (
              <div className="user-role-loading">Memuat data user...</div>
            ) : (
              <div className="user-role-table-wrapper">
                <table className="user-role-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Role</th>
                      <th>Unit Kerja</th>
                      <th>Status</th>
                      <th>Login Terakhir</th>
                      <th>Dibuat</th>
                      <th>Aksi</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="user-role-empty">
                          Data user tidak ditemukan.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((user) => {
                        const isCurrentUser =
                          Number(user.id) === Number(data.currentUserId)

                        return (
                          <tr key={user.id}>
                            <td>
                              <div className="user-role-user-cell">
                                <div className="user-role-avatar">
                                  {(user.full_name || user.username)
                                    .slice(0, 2)
                                    .toUpperCase()}
                                </div>

                                <div>
                                  <strong>
                                    {user.full_name}
                                    {isCurrentUser ? (
                                      <span className="user-role-self-label">
                                        Akun Anda
                                      </span>
                                    ) : null}
                                  </strong>
                                  <span>
                                    {user.pegawai_nip
                                      ? `NIP ${user.pegawai_nip} · @${user.username}`
                                      : `Akun sistem · @${user.username}`}
                                  </span>
                                  <small>
                                    {[user.pegawai_jabatan, user.email || "Tanpa email"]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </small>
                                </div>
                              </div>
                            </td>

                            <td>
                              <span className="user-role-role-badge">
                                {user.role_name}
                              </span>
                            </td>

                            <td>
                              <strong>{user.codeuker || "SEMUA"}</strong>
                              <br />
                              <small>
                                {user.uker_name ||
                                  user.pegawai_uker_name ||
                                  "Akses lintas unit kerja"}
                              </small>
                            </td>

                            <td>
                              <div className="user-role-status-stack">
                                <span
                                  className={
                                    user.is_active
                                      ? "user-role-status active"
                                      : "user-role-status inactive"
                                  }
                                >
                                  {user.is_active ? "Aktif" : "Tidak Aktif"}
                                </span>

                                {user.is_locked ? (
                                  <span className="user-role-status locked">
                                    Terkunci
                                  </span>
                                ) : null}
                              </div>
                            </td>

                            <td>{formatDate(user.last_login_at)}</td>
                            <td>{formatDate(user.created_at)}</td>

                            <td>
                              <div className="user-role-actions">
                                <button
                                  type="button"
                                  className="edit"
                                  onClick={() => openEditUserModal(user)}
                                >
                                  Edit
                                </button>

                                <button
                                  type="button"
                                  className="password"
                                  onClick={() => openPasswordModal(user)}
                                  disabled={deletingUser}
                                >
                                  Reset Password
                                </button>

                                <button
                                  type="button"
                                  className="delete"
                                  onClick={() => openDeleteUserModal(user)}
                                  disabled={
                                    deletingUser ||
                                    Number(user.id) === Number(data.currentUserId)
                                  }
                                  title={
                                    Number(user.id) === Number(data.currentUserId)
                                      ? "Akun yang sedang digunakan tidak dapat dihapus."
                                      : "Hapus akun user"
                                  }
                                >
                                  Hapus
                                </button>

                                {user.is_locked ? (
                                  <button
                                    type="button"
                                    className="unlock"
                                    onClick={() => handleUnlockUser(user)}
                                  >
                                    Buka Kunci
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="user-role-permission-layout">
            <aside className="user-role-role-selector">
              <label htmlFor="permission-role">Pilih Role</label>
              <select
                id="permission-role"
                value={selectedRoleId}
                onChange={handleRoleSelection}
              >
                {data.roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.role_name}
                  </option>
                ))}
              </select>

              <div className="user-role-role-description">
                <strong>{selectedRole?.role_name || "-"}</strong>
                <span>{selectedRole?.role_code || "-"}</span>
                <p>{selectedRole?.description || "Tidak ada deskripsi."}</p>
              </div>

              {selectedRole?.role_code === "SUPER_ADMIN" ? (
                <div className="user-role-alert info">
                  Super Admin selalu memperoleh seluruh menu aktif.
                </div>
              ) : (
                <div className="user-role-alert info">
                  Menu Dashboard selalu disertakan agar user mempunyai halaman
                  awal setelah login.
                </div>
              )}
            </aside>

            <div className="user-role-permission-panel">
              <div className="user-role-permission-header">
                <div>
                  <strong>Akses Menu Sidebar</strong>
                  <p>
                    Pilih menu yang dapat dilihat dan dibuka oleh role ini.
                  </p>
                </div>

                <button
                  type="button"
                  className="user-role-button primary"
                  onClick={savePermissions}
                  disabled={saving || !selectedRoleId}
                >
                  {saving ? "Menyimpan..." : "Simpan Hak Akses"}
                </button>
              </div>

              <div className="user-role-permission-grid">
                {data.menus.map((menu) => {
                  const checked =
                    selectedRole?.role_code === "SUPER_ADMIN" ||
                    permissionSelection.has(Number(menu.id))

                  return (
                    <label className="user-role-permission-card" key={menu.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={selectedRole?.role_code === "SUPER_ADMIN"}
                        onChange={() => togglePermission(Number(menu.id))}
                      />

                      <div>
                        <strong>{menu.label}</strong>
                        <span>{menu.href}</span>
                      </div>

                      {menu.badge ? <b>{menu.badge}</b> : null}
                    </label>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </section>

      {toast.open ? (
        <div className={`user-role-toast ${toast.type}`} role="status">
          <strong>{toast.type === "success" ? "Berhasil" : "Proses gagal"}</strong>
          <p>{toast.message}</p>
          <button
            type="button"
            aria-label="Tutup notifikasi"
            onClick={() => setToast((currentToast) => ({ ...currentToast, open: false }))}
          >
            ×
          </button>
        </div>
      ) : null}

      {userModalOpen ? (
        <div
          className="user-role-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeUserModal()
            }
          }}
        >
          <section className="user-role-modal" role="dialog" aria-modal="true">
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">User Management</p>
                <h3>{isEditing ? "Edit User" : "Tambah User"}</h3>
                <p>
                  {isEditing
                    ? "Perbarui relasi pegawai, role, dan status akun."
                    : "Pilih pegawai lalu tempatkan akun pada role yang sesuai."}
                </p>
              </div>

              <button type="button" onClick={closeUserModal} disabled={saving}>
                ×
              </button>
            </header>

            <form onSubmit={handleUserSubmit}>
              <div className="user-role-form-grid">
                <div className="user-role-form-field full">
                  <label htmlFor="pegawai_id">Pegawai</label>
                  <select
                    id="pegawai_id"
                    name="pegawai_id"
                    value={userForm.pegawai_id}
                    onChange={handlePegawaiChange}
                    required={requiresPegawai}
                  >
                    <option value="">
                      {requiresPegawai
                        ? "Pilih pegawai"
                        : "Akun sistem tanpa pegawai"}
                    </option>
                    {availablePegawai.map((pegawai) => (
                      <option key={pegawai.id} value={pegawai.id}>
                        {pegawai.nip || "Tanpa NIP"} - {pegawai.nama}
                        {pegawai.nama_uker ? ` (${pegawai.nama_uker})` : ""}
                      </option>
                    ))}
                  </select>
                  <small>
                    Identitas, email, jabatan, dan unit kerja mengikuti data master
                    pegawai. Satu pegawai hanya dapat memiliki satu akun.
                  </small>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="username">Username</label>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    value={userForm.username}
                    onChange={handleUserInput}
                    disabled={isEditing}
                    maxLength={50}
                    placeholder="contoh.user"
                    required
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="role_id">Role</label>
                  <select
                    id="role_id"
                    name="role_id"
                    value={userForm.role_id}
                    onChange={handleRoleChange}
                    disabled={
                      isEditing &&
                      Number(userForm.id) === Number(data.currentUserId)
                    }
                    required
                  >
                    <option value="">Pilih role</option>
                    {data.roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.role_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="full_name">Nama Lengkap</label>
                  <input
                    id="full_name"
                    name="full_name"
                    type="text"
                    value={userForm.full_name}
                    onChange={handleUserInput}
                    readOnly={Boolean(selectedPegawai)}
                    maxLength={100}
                    placeholder={
                      requiresPegawai
                        ? "Pilih pegawai terlebih dahulu"
                        : "Nama akun sistem"
                    }
                    required
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={userForm.email}
                    onChange={handleUserInput}
                    readOnly={Boolean(selectedPegawai)}
                    maxLength={150}
                    placeholder={
                      selectedPegawai
                        ? "Email mengikuti master pegawai"
                        : "user@perusahaan.co.id"
                    }
                  />
                </div>

                <div className="user-role-form-field">
                  <label>Jabatan</label>
                  <input
                    type="text"
                    value={selectedPegawai?.jabatan || "-"}
                    readOnly
                  />
                </div>

                <div className="user-role-form-field">
                  <label>Scope Unit Kerja</label>
                  <input
                    type="text"
                    value={
                      selectedUserFormRole?.role_code === "SUPER_ADMIN"
                        ? "SEMUA - Akses lintas unit kerja"
                        : selectedPegawai?.codeuker
                          ? `${selectedPegawai.codeuker} - ${selectedPegawai.nama_uker || ""}`
                          : "Pegawai belum memiliki unit kerja"
                    }
                    readOnly
                  />
                  <small>
                    Scope akses user non-Super Admin otomatis mengikuti unit kerja
                    pegawai.
                  </small>
                </div>

                {!isEditing ? (
                  <div className="user-role-form-field full">
                    <label htmlFor="password">Password Awal</label>
                    <input
                      id="password"
                      name="password"
                      type="password"
                      value={userForm.password}
                      onChange={handleUserInput}
                      maxLength={72}
                      placeholder="Minimal 10 karakter"
                      autoComplete="new-password"
                      required
                    />
                    <small>
                      Wajib memiliki huruf besar, huruf kecil, angka, dan
                      karakter khusus.
                    </small>
                  </div>
                ) : null}

                <label className="user-role-toggle-field full">
                  <input
                    name="is_active"
                    type="checkbox"
                    checked={userForm.is_active}
                    onChange={handleUserInput}
                    disabled={
                      isEditing &&
                      Number(userForm.id) === Number(data.currentUserId)
                    }
                  />
                  <span>
                    <strong>Akun Aktif</strong>
                    <small>User dapat login ketika status ini aktif.</small>
                  </span>
                </label>
              </div>

              {userModalError ? (
                <div className="user-role-alert error">{userModalError}</div>
              ) : null}

              <footer className="user-role-modal-footer">
                <button
                  type="button"
                  className="user-role-button secondary"
                  onClick={closeUserModal}
                  disabled={saving}
                >
                  Batal
                </button>

                <button
                  type="submit"
                  className="user-role-button primary"
                  disabled={saving}
                >
                  {saving ? "Menyimpan..." : isEditing ? "Simpan Perubahan" : "Tambah User"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}

      {deleteUserTarget ? (
        <div
          className="user-role-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDeleteUserModal()
            }
          }}
        >
          <section
            className="user-role-modal compact"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-user-title"
            aria-describedby="delete-user-description"
          >
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">Konfirmasi</p>
                <h3 id="delete-user-title">Hapus User?</h3>
                <p id="delete-user-description">
                  Akun, password, dan seluruh session login akan dihapus permanen.
                </p>
              </div>

              <button
                type="button"
                onClick={closeDeleteUserModal}
                disabled={deletingUser}
                aria-label="Tutup konfirmasi hapus user"
              >
                ×
              </button>
            </header>

            <div className="user-role-delete-content">
              <div className="user-role-delete-target">
                <span>User yang akan dihapus</span>
                <strong>@{deleteUserTarget.username}</strong>
                <small>
                  {deleteUserTarget.full_name || "Tanpa nama"} · {deleteUserTarget.role_name || "Tanpa role"}
                </small>
              </div>

              <p className="user-role-delete-warning">
                Data master pegawai tidak ikut dihapus. Setelah akun dihapus, pegawai dapat dihapus melalui halaman Master Pegawai.
              </p>

              {deleteUserError ? (
                <div className="user-role-alert error">{deleteUserError}</div>
              ) : null}
            </div>

            <footer className="user-role-modal-footer">
              <button
                type="button"
                className="user-role-button secondary"
                onClick={closeDeleteUserModal}
                disabled={deletingUser}
              >
                Batal
              </button>

              <button
                type="button"
                className="user-role-button danger"
                onClick={handleDeleteUser}
                disabled={deletingUser}
              >
                {deletingUser ? "Menghapus..." : "Ya, Hapus User"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {passwordModalOpen ? (
        <div
          className="user-role-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closePasswordModal()
            }
          }}
        >
          <section className="user-role-modal compact" role="dialog" aria-modal="true">
            <header className="user-role-modal-header">
              <div>
                <p className="eyebrow">Security</p>
                <h3>Reset Password</h3>
                <p>Atur password baru untuk akun @{passwordForm.username}.</p>
              </div>

              <button type="button" onClick={closePasswordModal} disabled={saving}>
                ×
              </button>
            </header>

            <form onSubmit={handlePasswordReset}>
              <div className="user-role-form-grid single">
                <div className="user-role-form-field">
                  <label htmlFor="new_password">Password Baru</label>
                  <input
                    id="new_password"
                    type="password"
                    value={passwordForm.password}
                    onChange={(event) =>
                      setPasswordForm((currentForm) => ({
                        ...currentForm,
                        password: event.target.value,
                      }))
                    }
                    maxLength={72}
                    autoComplete="new-password"
                    required
                  />
                </div>

                <div className="user-role-form-field">
                  <label htmlFor="confirm_password">Konfirmasi Password</label>
                  <input
                    id="confirm_password"
                    type="password"
                    value={passwordForm.confirm_password}
                    onChange={(event) =>
                      setPasswordForm((currentForm) => ({
                        ...currentForm,
                        confirm_password: event.target.value,
                      }))
                    }
                    maxLength={72}
                    autoComplete="new-password"
                    required
                  />
                </div>
              </div>

              {passwordModalError ? (
                <div className="user-role-alert error">{passwordModalError}</div>
              ) : null}

              <footer className="user-role-modal-footer">
                <button
                  type="button"
                  className="user-role-button secondary"
                  onClick={closePasswordModal}
                  disabled={saving}
                >
                  Batal
                </button>

                <button
                  type="submit"
                  className="user-role-button danger"
                  disabled={saving}
                >
                  {saving ? "Memproses..." : "Reset Password"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  )
}
