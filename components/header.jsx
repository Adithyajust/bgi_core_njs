"use client"

import {
  useEffect,
  useMemo,
  useState,
} from "react"
import { useRouter } from "next/navigation"

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

export function Header() {
  const router = useRouter()

  const [user, setUser] =
    useState(null)

  const [isLoading, setIsLoading] =
    useState(true)

  const [isLoggingOut, setIsLoggingOut] =
    useState(false)

  useEffect(() => {
    let isMounted = true

    async function loadCurrentUser() {
      try {
        const response = await fetch(
          "/api/auth/me",
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          }
        )

        const result =
          await response.json()

        if (response.status === 401) {
          router.replace("/login")
          return
        }

        if (
          !response.ok ||
          !result.success
        ) {
          throw new Error(
            result.message ||
              "Gagal mengambil data user."
          )
        }

        if (isMounted) {
          setUser(result.data)
        }
      } catch (error) {
        console.error(
          "Gagal membaca user:",
          error
        )
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadCurrentUser()

    return () => {
      isMounted = false
    }
  }, [router])

  const initials = useMemo(
    () =>
      createInitials(
        user?.fullName
      ),
    [user?.fullName]
  )

  async function handleLogout() {
    if (isLoggingOut) {
      return
    }

    try {
      setIsLoggingOut(true)

      await fetch(
        "/api/auth/logout",
        {
          method: "POST",
          credentials: "include",
        }
      )
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
          className="user-menu"
          aria-label="Profil pengguna"
        >
          <div className="profile-chip">
            {isLoading ? "..." : initials}
          </div>

          <div className="user-menu-copy">
            <strong>
              {isLoading
                ? "Memuat user..."
                : user?.fullName ||
                  user?.username ||
                  "User"}
            </strong>

            <span>
              {isLoading
                ? "Memuat role..."
                : user?.roleName || "-"}
            </span>
          </div>
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