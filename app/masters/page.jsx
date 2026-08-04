"use client"

import Link from "next/link"

const masterMenus = [
  {
    title: "Master Uker",
    description:
      "Kelola data unit kerja, kode unit kerja, alamat, dan informasi operasional.",
    href: "/masters/uker",
  },
  {
    title: "Master Kanwil",
    description: "Kelola kode, nama, dan status Kanwil.",
    href: "/masters/kanwil",
  },
  {
    title: "Master Cabang",
    description: "Kelola Cabang dan relasinya ke Kanwil.",
    href: "/masters/cabang",
  },
  {
    title: "Master Merk",
    description: "Kelola kode, nama, dan status Merk mesin.",
    href: "/masters/merk",
  },
  {
    title: "Master Tipe Mesin",
    description: "Kelola jenis dan model mesin berdasarkan Merk.",
    href: "/masters/tipe-mesin",
  },
  {
    title: "Master Mesin",
    description: "Kelola data mesin dan cabang pengelolanya.",
    href: "/masters/mesin",
  },
  {
    title: "Master Pegawai",
    description: "Kelola data pegawai pada unit kerja atau cabang.",
    href: "/masters/pegawai",
  },
  {
    title: "Master Project",
    description:
      "Kelola data project, customer, unit kerja, Project Manager, status, dan progress pekerjaan.",
    href: "/masters/project",
  },
  {
    title: "Master Kendaraan",
    description:
      "Kelola kendaraan operasional berdasarkan unit kerja, jenis, merk, nomor kendaraan, dan status.",
    href: "/masters/kendaraan",
  },
]

export default function MastersPage() {
  return (
    <div className="simple-page">
      <section className="page-heading-card">
        <p className="eyebrow">Master Data</p>
        <h2>Pengelolaan data master</h2>
        <p>
          Pilih modul master yang akan dikelola. Data Kanwil menjadi induk
          bagi Cabang. Merk menjadi induk untuk jenis dan model mesin yang
          digunakan saat mendaftarkan SN pada Master Mesin.
        </p>
      </section>

      <section className="settings-grid masters-grid">
        {masterMenus.map((item) => (
          <article className="settings-card" key={item.href}>
            <strong>{item.title}</strong>
            <p>{item.description}</p>

            <Link href={item.href} className="settings-card-link">
              Kelola Data
            </Link>
          </article>
        ))}
      </section>
    </div>
  )
}
