"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Footer } from "@/components/footer"
import { Header } from "@/components/header"
import { Navbar } from "@/components/navbar"
import { Sidebar } from "@/components/sidebar"

export function AppShell({ children }) {
  const pathname = usePathname()
  const router = useRouter()

  const [isChecking, setIsChecking] =
    useState(true)

  const isLoginPage = pathname === "/login"

  useEffect(() => {
    let isMounted = true

    async function checkSession() {
      if (isLoginPage) {
        if (isMounted) {
          setIsChecking(false)
        }

        return
      }

      try {
        const response = await fetch(
          "/api/auth/me",
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          }
        )

        if (!response.ok) {
          const nextPath =
            encodeURIComponent(pathname)

          router.replace(
            `/login?next=${nextPath}`
          )

          return
        }

        if (isMounted) {
          setIsChecking(false)
        }
      } catch (error) {
        console.error(
          "Pemeriksaan session gagal:",
          error
        )

        router.replace("/login")
      }
    }

    checkSession()

    return () => {
      isMounted = false
    }
  }, [isLoginPage, pathname, router])

  if (isLoginPage) {
    return children
  }

  if (isChecking) {
    return (
      <div className="auth-loading-page">
        <div className="auth-loading-spinner" />

        <strong>
          Memeriksa session pengguna...
        </strong>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <Sidebar />

      <main className="workspace">
        <Header />
        <Navbar />

        <div className="content-area">
          {children}
        </div>

        <Footer />
      </main>
    </div>
  )
}