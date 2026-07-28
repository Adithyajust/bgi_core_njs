"use client";

import { useRouter } from "next/navigation";

const settingsMenus = [
  {
    title: "User Role & Access",
    href: null,
  },
  {
    title: "Approval Rules",
    href: null,
  },
  {
    title: "Risk Threshold",
    href: null,
  },
  {
    title: "Notification Channel",
    href: null,
  },
  {
    title: "Side Menu",
    href: "/settings/side-menu",
  },
];

export default function SettingsPage() {
  const router = useRouter();

  function handleConfigure(item) {
    if (!item.href) {
      return;
    }

    router.push(item.href);
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

            <p>
              Konfigurasi modul {item.title.toLowerCase()}.
            </p>

            <button
              type="button"
              onClick={() => handleConfigure(item)}
            >
              Configure
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}