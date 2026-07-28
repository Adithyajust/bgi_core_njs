"use client"

import { useRouter } from "next/navigation"

const settingsMenus = [
  {
    title: "User Role & Access",
    description: "Kelola user, role, password, status akun, dan akses menu.",
    href: "/settings/user-role",
  },
  {
    title: "Approval Rules",
    description: "Atur alur, level, dan batas kewenangan approval.",
    href: null,
  },
  {
    title: "Risk Threshold",
    description: "Kelola parameter dan batas indikator risiko.",
    href: null,
  },
  {
    title: "Notification Channel",
    description: "Atur kanal dan penerima notifikasi aplikasi.",
    href: null,
  },
  {
    title: "Side Menu",
    description: "Tambah, ubah, hapus, dan urutkan menu sidebar.",
    href: "/settings/side-menu",
  },
]

export default function SettingsPage() {
  const router = useRouter()

  function handleConfigure(item) {
    if (!item.href) {
      return
    }

    router.push(item.href)
  }

  return (
    <div className="simple-page">
      <section className="page-heading-card">
        <p className="eyebrow">Settings</p>
        <h2>Konfigurasi portal</h2>
        <p>
          Kelola role, hak akses, notifikasi approval, integrasi core banking,
          dan parameter risk engine.
        </p>
      </section>

      <section className="settings-grid">
        {settingsMenus.map((item) => (
          <article className="settings-card" key={item.title}>
            <strong>{item.title}</strong>
            <p>{item.description}</p>

            <button
              type="button"
              onClick={() => handleConfigure(item)}
              disabled={!item.href}
              title={!item.href ? "Modul belum tersedia" : undefined}
            >
              {item.href ? "Configure" : "Coming Soon"}
            </button>
          </article>
        ))}
      </section>
    </div>
  )
}
