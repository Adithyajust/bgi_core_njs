"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAppBootstrap } from "@/components/app-bootstrap-context"

export function Navbar() {
  const pathname = usePathname()
  const { navbar } = useAppBootstrap()
  const routes = Array.isArray(navbar) ? navbar : []

  if (routes.length === 0) return null

  return (
    <nav className="top-navbar" aria-label="Main navigation">
      <div className="navbar-scroll">
        {routes.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`)

          return (
            <Link
              className={isActive ? "navbar-item active" : "navbar-item"}
              href={item.href}
              key={item.href}
            >
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
