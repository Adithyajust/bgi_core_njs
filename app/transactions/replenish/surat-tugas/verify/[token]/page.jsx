import Link from "next/link"

import { getCurrentUser, getUserDataScope } from "@/lib/access-control"
import { connectDB } from "@/lib/mssql"
import { getAssignmentLetterByToken } from "@/modules/replenish/assignment-letter"

export const dynamic = "force-dynamic"

function formatCurrency(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function formatDate(value) {
  if (!value) return "-"
  const [year, month, day] = String(value).slice(0, 10).split("-")
  return year && month && day ? `${day}/${month}/${year}` : "-"
}

function formatDateTime(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(date)
}

function titleCase(value) {
  return String(value || "-")
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export default async function VerifyAssignmentLetterPage({ params }) {
  const { token } = await params
  const user = await getCurrentUser()
  const scope = getUserDataScope(user)
  const db = await connectDB()
  const letter = await getAssignmentLetterByToken(
    db,
    token,
    scope.isSuperAdmin ? null : scope.codeUker
  )
  const isValid = Boolean(
    letter &&
    letter.status === "DISETUJUI" &&
    letter.payload_valid &&
    letter.approval_valid
  )
  const workOrder = letter?.payload?.work_order

  return (
    <div className="simple-page assignment-verification-page">
      <section className={`assignment-verification-hero ${isValid ? "valid" : "invalid"}`}>
        <div className="assignment-verification-icon">{isValid ? "✓" : "!"}</div>
        <div>
          <p className="eyebrow">Verifikasi QR Surat Tugas</p>
          <h2>{isValid ? "Dokumen Valid" : "Dokumen Tidak Valid"}</h2>
          <p>
            {isValid
              ? "QR cocok dengan dokumen dan persetujuan yang tersimpan di sistem."
              : "Token tidak ditemukan, surat belum disetujui, atau integritas dokumen tidak cocok."}
          </p>
        </div>
      </section>

      {letter ? (
        <section className="assignment-verification-card">
          <div className="assignment-verification-grid">
            <article><span>Nomor Surat</span><strong>{letter.letter_no}</strong></article>
            <article><span>Work Order</span><strong>{letter.work_order_no}</strong></article>
            <article><span>Status</span><strong>{titleCase(letter.status)}</strong></article>
            <article><span>Unit Kerja</span><strong>{letter.codeuker} · {letter.nama_uker}</strong></article>
            <article><span>Tanggal Tugas</span><strong>{formatDate(workOrder?.schedule_date)}</strong></article>
            <article><span>Total Titik</span><strong>{workOrder?.total_points || 0} ATM/CRM</strong></article>
            <article><span>Total Nominal</span><strong>{formatCurrency(workOrder?.total_requested_amount)}</strong></article>
            <article><span>Disetujui Oleh</span><strong>{letter.approved_by_name || "-"}</strong></article>
            <article><span>Jabatan</span><strong>{letter.approved_by_position || "-"}</strong></article>
            <article><span>Waktu Persetujuan</span><strong>{formatDateTime(letter.approved_at)}</strong></article>
          </div>

          <div className="assignment-verification-hash">
            <span>SHA-256 Dokumen</span>
            <code>{letter.document_hash}</code>
            <span>SHA-256 Persetujuan</span>
            <code>{letter.approval_hash || "-"}</code>
          </div>

          <div className="assignment-verification-actions">
            <Link href={`/transactions/replenish/${letter.work_order_id}/surat-tugas`} className="replenish-button primary">
              Buka Surat Tugas
            </Link>
            <Link href="/transactions/replenish" className="replenish-button secondary">
              Daftar Work Order
            </Link>
          </div>
        </section>
      ) : (
        <section className="assignment-letter-empty">
          <h3>Token verifikasi tidak ditemukan</h3>
          <p>Pastikan QR berasal dari Surat Tugas yang diterbitkan oleh aplikasi.</p>
          <Link href="/transactions/replenish" className="replenish-button secondary">Kembali</Link>
        </section>
      )}
    </div>
  )
}
