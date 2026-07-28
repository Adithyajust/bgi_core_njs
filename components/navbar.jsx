"use client"

import Link from "next/link"
import {
  usePathname,
  useRouter,
} from "next/navigation"
import {
  useEffect,
  useState,
} from "react"

export function Navbar() {
  const pathname = usePathname()
  const router = useRouter()

  const [routes, setRoutes] =
    useState([])

  useEffect(() => {
    let isMounted = true

    async function loadNavbar() {
      try {
        const response = await fetch(
          "/api/navbar",
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
          !result.success ||
          !Array.isArray(result.data)
        ) {
          throw new Error(
            result.message ||
              "Gagal mengambil navbar."
          )
        }

        if (isMounted) {
          setRoutes(result.data)
        }
      } catch (error) {
        console.error(
          "Gagal mengambil navbar:",
          error
        )
      }
    }

    loadNavbar()

    return () => {
      isMounted = false
    }
  }, [router])

  if (routes.length === 0) {
    return null
  }

  return (
    <nav
      className="top-navbar"
      aria-label="Main navigation"
    >
      <div className="navbar-scroll">
        {routes.map((item) => {
          const isActive =
            pathname === item.href ||
            pathname.startsWith(
              `${item.href}/`
            )

          return (
            <Link
              className={
                isActive
                  ? "navbar-item active"
                  : "navbar-item"
              }
              href={item.href}
              key={item.href}
            >
              <strong>
                {item.label}
              </strong>

              <span>
                {item.description}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}