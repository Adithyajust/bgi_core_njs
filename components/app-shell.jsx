"use client"

import { useCallback, useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { AppBootstrapProvider } from "@/components/app-bootstrap-context"
import { Footer } from "@/components/footer"
import { Header } from "@/components/header"
import { Navbar } from "@/components/navbar"
import { Sidebar } from "@/components/sidebar"

async function fetchBootstrap(signal) {
  const response = await fetch("/api/bootstrap", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    signal,
  })

  const contentType = response.headers.get("content-type") || ""
  if (!contentType.includes("application/json")) {
    const error = new Error(`Bootstrap menghasilkan respons non-JSON (HTTP ${response.status}).`)
    error.status = response.status
    throw error
  }

  const result = await response.json()
  if (!response.ok || !result.success) {
    const error = new Error(result.message || "Gagal memuat aplikasi.")
    error.status = response.status
    throw error
  }

  return result.data
}

export function AppShell({ children }) {
  const pathname = usePathname()
  const router = useRouter()
  const isLoginPage = pathname === "/login"

  const [bootstrap, setBootstrap] = useState(null)
  const [isChecking, setIsChecking] = useState(!isLoginPage)
  const [errorMessage, setErrorMessage] = useState("")
  const [reloadKey, setReloadKey] = useState(0)

  const reloadBootstrap = useCallback(() => {
    setIsChecking(true)
    setErrorMessage("")
    setReloadKey((value) => value + 1)
  }, [])

  useEffect(() => {
    if (isLoginPage) {
      return undefined
    }

    const controller = new AbortController()

    fetchBootstrap(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setBootstrap(data)
          setErrorMessage("")
        }
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === "AbortError") return

        if (error?.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`)
          return
        }

        console.error("Pemeriksaan session gagal:", error)
        setErrorMessage(error instanceof Error ? error.message : "Gagal memuat aplikasi.")
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsChecking(false)
      })

    return () => controller.abort()
  }, [isLoginPage, pathname, reloadKey, router])

  useEffect(() => {
    function handleSidebarUpdated() {
      reloadBootstrap()
    }

    window.addEventListener("sidebar-menu-updated", handleSidebarUpdated)
    return () => window.removeEventListener("sidebar-menu-updated", handleSidebarUpdated)
  }, [reloadBootstrap])

  if (isLoginPage) return children

  if (isChecking) {
    return (
      <div className="auth-loading-page">
        <div className="auth-loading-spinner" />
        <strong>Memeriksa session pengguna...</strong>
      </div>
    )
  }

  if (!bootstrap || errorMessage) {
    return (
      <div className="auth-loading-page">
        <strong>{errorMessage || "Data awal aplikasi tidak tersedia."}</strong>
        <button type="button" className="primary-button" onClick={reloadBootstrap}>
          Coba lagi
        </button>
      </div>
    )
  }

  return (
    <AppBootstrapProvider value={{ ...bootstrap, reloadBootstrap }}>
      <div className="app-shell">
        <Sidebar />
        <main className="workspace">
          <Header />
          <Navbar />
          <div className="content-area">{children}</div>
          <Footer />
        </main>
      </div>
    </AppBootstrapProvider>
  )
}
