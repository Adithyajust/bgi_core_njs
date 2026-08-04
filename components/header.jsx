"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useAppBootstrap } from "@/components/app-bootstrap-context"

function createInitials(fullName) {
  if (!fullName) {
    return "US"
  }

  const names = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (names.length === 1) {
    return names[0]
      .slice(0, 2)
      .toUpperCase()
  }

  return (
    names[0][0] +
    names[names.length - 1][0]
  ).toUpperCase()
}

function displayValue(value, fallback = "-") {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) {
    return fallback
  }

  return String(value)
}

function ProfileAvatar({
  photo,
  initials,
  className = "",
}) {
  const [failedPhoto, setFailedPhoto] =
    useState("")

  const showPhoto = Boolean(photo) && failedPhoto !== photo

  return (
    <div
      className={`profile-avatar ${className}`.trim()}
      aria-hidden="true"
    >
      {showPhoto ? (
        <Image
          src={photo}
          alt=""
          width={54}
          height={54}
          sizes="54px"
          unoptimized
          onError={() => setFailedPhoto(photo)}
        />
      ) : (
        <span>{initials}</span>
      )}

      <i className="profile-online-dot" />
    </div>
  )
}

function ProfileDetail({ label, value }) {
  return (
    <div className="profile-detail-row">
      <span>{label}</span>
      <strong title={displayValue(value)}>
        {displayValue(value)}
      </strong>
    </div>
  )
}

export function Header() {
  const router = useRouter()
  const profileMenuRef = useRef(null)
  const { user } = useAppBootstrap()
  const isLoading = false
  const [isLoggingOut, setIsLoggingOut] =
    useState(false)
  const [isProfileOpen, setIsProfileOpen] =
    useState(false)

  useEffect(() => {
    function handlePointerDown(event) {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(
          event.target
        )
      ) {
        setIsProfileOpen(false)
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsProfileOpen(false)
      }
    }

    document.addEventListener(
      "mousedown",
      handlePointerDown
    )
    document.addEventListener(
      "keydown",
      handleKeyDown
    )

    return () => {
      document.removeEventListener(
        "mousedown",
        handlePointerDown
      )
      document.removeEventListener(
        "keydown",
        handleKeyDown
      )
    }
  }, [])

  const profileName =
    user?.pegawai?.nama ||
    user?.fullName ||
    user?.username ||
    "User"

  const initials = useMemo(
    () => createInitials(profileName),
    [profileName]
  )

  const unitKerja =
    user?.pegawai?.unitKerja?.namaUker ||
    user?.ukerName ||
    (user?.roleCode === "SUPER_ADMIN"
      ? "Seluruh unit kerja"
      : null)

  const profileEmail =
    user?.pegawai?.email || user?.email

  async function handleLogout() {
    if (isLoggingOut) {
      return
    }

    try {
      setIsLoggingOut(true)
      setIsProfileOpen(false)

      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      })
    } catch (error) {
      console.error(
        "Logout error:",
        error
      )
    } finally {
      router.replace("/login")
      router.refresh()
      setIsLoggingOut(false)
    }
  }

  function openChangePassword() {
    setIsProfileOpen(false)
    router.push("/change-password")
  }

  return (
    <header className="app-header">
      <div className="header-copy">
        <p className="eyebrow">
          Corporate Cash Management
        </p>

        <h1>
          Operation Control Center
        </h1>

        <p>
          Monitoring operasional,
          transaksi, approval, cabang,
          dan laporan dalam satu
          dashboard.
        </p>
      </div>

      <div className="header-actions">
        <label className="search-box header-search">
          <span>⌕</span>

          <input
            placeholder="Cari nasabah, transaksi, rekening, laporan..."
            aria-label="Pencarian"
          />
        </label>

        <button
          className="ghost-button"
          type="button"
        >
          Export
        </button>

        <button
          className="primary-button"
          type="button"
        >
          New Approval
        </button>

        <div
          className="profile-menu-wrapper"
          ref={profileMenuRef}
        >
          <button
            className={`user-menu profile-menu-trigger${
              isProfileOpen ? " is-open" : ""
            }`}
            type="button"
            aria-label="Buka informasi profil pengguna"
            aria-haspopup="dialog"
            aria-expanded={isProfileOpen}
            onClick={() =>
              setIsProfileOpen(
                (current) => !current
              )
            }
            disabled={isLoading}
          >
            <ProfileAvatar
              photo={user?.pegawai?.foto}
              initials={
                isLoading ? "..." : initials
              }
            />

            <span className="user-menu-copy">
              <strong>
                {isLoading
                  ? "Memuat user..."
                  : profileName}
              </strong>

              <span>
                {isLoading
                  ? "Memuat role..."
                  : user?.roleName || "-"}
              </span>
            </span>

            <span
              className="profile-menu-chevron"
              aria-hidden="true"
            >
              ▾
            </span>
          </button>

          {isProfileOpen && user ? (
            <section
              className="profile-dropdown"
              role="dialog"
              aria-label="Informasi profil pengguna"
            >
              <div className="profile-dropdown-head">
                <ProfileAvatar
                  photo={user?.pegawai?.foto}
                  initials={initials}
                  className="profile-avatar-large"
                />

                <div>
                  <strong>{profileName}</strong>
                  <span>
                    {displayValue(
                      user?.roleName
                    )}
                  </span>
                  <small>
                    <i /> Akun aktif
                  </small>
                </div>
              </div>

              <div className="profile-detail-list">
                <ProfileDetail
                  label="Username"
                  value={user?.username}
                />
                <ProfileDetail
                  label="NIP"
                  value={user?.pegawai?.nip}
                />
                <ProfileDetail
                  label="Jabatan"
                  value={
                    user?.pegawai?.jabatan
                  }
                />
                <ProfileDetail
                  label="Unit kerja"
                  value={unitKerja}
                />
                <ProfileDetail
                  label="Email"
                  value={profileEmail}
                />
                <ProfileDetail
                  label="No. handphone"
                  value={
                    user?.pegawai?.handphone
                  }
                />
              </div>

              <div className="profile-dropdown-actions">
                <button
                  type="button"
                  onClick={openChangePassword}
                >
                  Ubah Password
                </button>

                <button
                  className="profile-logout-action"
                  type="button"
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                >
                  {isLoggingOut
                    ? "Keluar..."
                    : "Logout"}
                </button>
              </div>
            </section>
          ) : null}
        </div>

        <button
          className="ghost-button logout-button"
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
        >
          {isLoggingOut
            ? "Keluar..."
            : "Logout"}
        </button>
      </div>
    </header>
  )
}
