"use client"

import Image from "next/image"
import Link from "next/link"
import {
  usePathname,
  useRouter,
} from "next/navigation"
import {
  useEffect,
  useState,
} from "react"
import {
  mapDatabaseSidebarRoutes,
} from "@/lib/routes"

async function fetchSidebarRoutes(signal) {
  const response = await fetch(
    "/api/navigation",
    {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal,
    }
  )

  const contentType =
    response.headers.get(
      "content-type"
    ) || ""

  if (
    !contentType.includes(
      "application/json"
    )
  ) {
    const error = new Error(
      `Navigation API menghasilkan status ${response.status}.`
    )

    error.status = response.status

    throw error
  }

  const result = await response.json()

  if (response.status === 401) {
    const error = new Error(
      result.message ||
        "Session telah berakhir."
    )

    error.status = 401

    throw error
  }

  if (
    !response.ok ||
    !result.success ||
    !Array.isArray(result.data)
  ) {
    const error = new Error(
      result.message ||
        "Gagal mengambil sidebar."
    )

    error.status = response.status

    throw error
  }

  return mapDatabaseSidebarRoutes(
    result.data
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  const [routes, setRoutes] =
    useState([])

  const [isLoading, setIsLoading] =
    useState(true)

  const [errorMessage, setErrorMessage] =
    useState("")

  const [reloadKey, setReloadKey] =
    useState(0)

  /*
   * Listener perubahan menu.
   * State hanya berubah saat event benar-benar dipanggil.
   */
  useEffect(() => {
    function handleSidebarUpdated() {
      setReloadKey(
        (currentValue) =>
          currentValue + 1
      )
    }

    window.addEventListener(
      "sidebar-menu-updated",
      handleSidebarUpdated
    )

    return () => {
      window.removeEventListener(
        "sidebar-menu-updated",
        handleSidebarUpdated
      )
    }
  }, [])

  /*
   * Pengambilan data menu.
   * Perubahan state berjalan setelah Promise selesai.
   */
  useEffect(() => {
    let isCancelled = false

    const controller =
      new AbortController()

    fetchSidebarRoutes(
      controller.signal
    )
      .then((sidebarRoutes) => {
        if (isCancelled) {
          return
        }

        setRoutes(sidebarRoutes)
        setErrorMessage("")
      })
      .catch((error) => {
        if (
          isCancelled ||
          error?.name === "AbortError"
        ) {
          return
        }

        if (error?.status === 401) {
          router.replace("/login")
          return
        }

        console.error(
          "Gagal mengambil sidebar:",
          error
        )

        setRoutes([])

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Gagal mengambil sidebar."
        )
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      isCancelled = true
      controller.abort()
    }
  }, [reloadKey, router])

  function handleRetry() {
    setIsLoading(true)
    setErrorMessage("")

    setReloadKey(
      (currentValue) =>
        currentValue + 1
    )
  }

  return (
    <aside className="sidebar">
      <Link
        href="/dashboard"
        className="brand-block"
        aria-label="Ke dashboard"
      >
        <Image
          src="/logos.png"
          alt="Logo Perusahaan"
          width={52}
          height={52}
          className="brand-logo"
          priority
        />

        <div>
          <strong>
            BGI Core Application
          </strong>

          <p>Corporate Portal</p>
        </div>
      </Link>

      <nav
        className="nav-menu"
        aria-label="Sidebar navigation"
      >
        {isLoading ? (
          <div className="sidebar-menu-status">
            Memuat menu...
          </div>
        ) : null}

        {!isLoading &&
        errorMessage ? (
          <div className="sidebar-menu-error">
            <p>{errorMessage}</p>

            <button
              type="button"
              onClick={handleRetry}
            >
              Coba lagi
            </button>
          </div>
        ) : null}

        {!isLoading &&
        !errorMessage &&
        routes.length === 0 ? (
          <div className="sidebar-menu-status">
            Tidak ada menu yang dapat
            diakses.
          </div>
        ) : null}

        {!isLoading &&
          !errorMessage &&
          routes.map((item) => {
            const Icon = item.icon

            const isActive =
              pathname === item.href ||
              pathname.startsWith(
                `${item.href}/`
              )

            return (
              <Link
                className={
                  isActive
                    ? "nav-item active"
                    : "nav-item"
                }
                href={item.href}
                key={item.href}
              >
                <Icon className="nav-icon" />

                <span>
                  {item.label}
                </span>

                {item.badge ? (
                  <b className="nav-badge">
                    {item.badge}
                  </b>
                ) : null}
              </Link>
            )
          })}
      </nav>

      <div className="sidebar-card">
        <span className="status-dot" />

        <p>Core Cash Management system</p>

        <strong>
          Operational 99.98%
        </strong>

        <button type="button">
          View uptime
        </button>
      </div>
    </aside>
  )
}