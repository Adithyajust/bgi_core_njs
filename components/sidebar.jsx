"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useMemo } from "react"
import { useAppBootstrap } from "@/components/app-bootstrap-context"
import { mapDatabaseSidebarRoutes } from "@/lib/routes"

export function Sidebar() {
  const pathname = usePathname()
  const { sidebar } = useAppBootstrap()
  const routes = useMemo(
    () => mapDatabaseSidebarRoutes(Array.isArray(sidebar) ? sidebar : []),
    [sidebar]
  )

  return (
    <aside className="sidebar">
      <Link href="/dashboard" className="brand-block" aria-label="Ke dashboard">
        <Image
          src="/logos.png"
          alt="Logo Perusahaan"
          width={52}
          height={52}
          className="brand-logo"
          priority
        />
        <div>
          <strong>BGI Core Application</strong>
          <p>Corporate Portal</p>
        </div>
      </Link>

      <nav className="nav-menu" aria-label="Sidebar navigation">
        {routes.length === 0 ? (
          <div className="sidebar-menu-status">Tidak ada menu yang dapat diakses.</div>
        ) : null}

        {routes.map((item) => {
          const Icon = item.icon
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`)

          return (
            <Link
              className={isActive ? "nav-item active" : "nav-item"}
              href={item.href}
              key={item.href}
            >
              <Icon className="nav-icon" />
              <span>{item.label}</span>
              {item.badge ? <b className="nav-badge">{item.badge}</b> : null}
            </Link>
          )
        })}
      </nav>

      <div className="sidebar-card">
        <span className="status-dot" />
        <p>Core Cash Management system</p>
        <strong>Operational 99.98%</strong>
        <button type="button">View uptime</button>
      </div>
    </aside>
  )
}
