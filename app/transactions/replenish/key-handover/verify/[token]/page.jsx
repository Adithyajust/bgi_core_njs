import Link from "next/link"

import { getCurrentUser, getUserDataScope } from "@/lib/access-control"
import { connectDB } from "@/lib/mssql"
import { getKeyHandoverVerification } from "@/modules/replenish/key-handover-verification"

export const dynamic = "force-dynamic"

function formatDate(value) {
  if (!value) return "-"
  const [year, month, day] = String(value).slice(0, 10).split("-")
  return year && month && day ? `${day}/${month}/${year}` : "-"
}

function formatDateTime(value) {
  if (!value) return "-"
  const date = new Date(String(value).replace(" ", "T"))
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(date)
}

export default async function VerifyKeyHandoverPage({ params, searchParams }) {
  const { token } = await params
  const query = await searchParams
  const party = query?.party === "giver" || query?.party === "recipient" ? query.party : null
  const partyLabel = party === "giver" ? "Penyerah" : party === "recipient" ? "Penerima" : null
  const user = await getCurrentUser()
  const scope = getUserDataScope(user)
  const db = await connectDB()
  const handover = await getKeyHandoverVerification(
    db,
    token,
    scope.isSuperAdmin ? null : scope.codeUker
  )
  const isValid = Boolean(handover?.valid)

  return (
    <div className="simple-page assignment-verification-page">
      <section className={`assignment-verification-hero ${isValid ? "valid" : "invalid"}`}>
        <div className="assignment-verification-icon">{isValid ? "✓" : "!"}</div>
        <div>
          <p className="eyebrow">Verifikasi QR Serah Terima Kunci{partyLabel ? ` · ${partyLabel}` : ""}</p>
          <h2>{isValid ? `QR ${partyLabel || "Dokumen"} Valid` : "Dokumen Tidak Valid"}</h2>
          <p>
            {isValid
              ? "QR cocok dengan PDF, approval Work Order, serta identitas penyerah dan penerima yang tersimpan."
              : "Token, approval, identitas pihak, atau integritas file PDF tidak cocok dengan data aplikasi."}
          </p>
        </div>
      </section>

      {handover ? (
        <section className="assignment-verification-card">
          <div className="assignment-verification-grid">
            <article><span>Nomor Berita Acara</span><strong>{handover.receipt_no || "-"}</strong></article>
            <article><span>Work Order</span><strong>{handover.work_order_no}</strong></article>
            <article><span>Unit Kerja</span><strong>{handover.codeuker} · {handover.nama_uker}</strong></article>
            <article><span>Tanggal Pelaksanaan</span><strong>{formatDate(handover.schedule_date)}</strong></article>
            <article><span>Jumlah Kunci</span><strong>{handover.total_keys} kunci</strong></article>
            <article><span>Waktu Verifikasi Kunci</span><strong>{formatDateTime(handover.verified_at)}</strong></article>
            <article><span>Petugas Penyerah</span><strong>{handover.giver_name || "-"}</strong></article>
            <article><span>Jabatan Penyerah</span><strong>{handover.giver_position || "-"}</strong></article>
            <article><span>NIP Penyerah</span><strong>{handover.giver_nip || "-"}</strong></article>
            <article><span>Custody / Penerima</span><strong>{handover.recipient_name || "-"}</strong></article>
            <article><span>Jabatan Penerima</span><strong>{handover.recipient_position || "-"}</strong></article>
            <article><span>NIP Penerima</span><strong>{handover.recipient_nip || "-"}</strong></article>
            <article><span>Disetujui Oleh</span><strong>{handover.approved_by_name || "-"}</strong></article>
            <article><span>Jabatan Approver</span><strong>{handover.approved_by_position || "-"}</strong></article>
            <article><span>Waktu Approval</span><strong>{formatDateTime(handover.approved_at)}</strong></article>
          </div>

          <div className="assignment-verification-hash">
            <span>SHA-256 Dokumen</span>
            <code>{handover.document_hash || "-"}</code>
            <span>SHA-256 Approval</span>
            <code>{handover.approval_hash || "-"}</code>
            <span>SHA-256 File PDF</span>
            <code>{handover.pdf_hash || "-"}</code>
          </div>

          <div className="assignment-verification-actions">
            <Link href="/transactions/replenish" className="replenish-button primary">
              Buka Daftar Work Order
            </Link>
          </div>
        </section>
      ) : (
        <section className="assignment-letter-empty">
          <h3>Token verifikasi tidak ditemukan</h3>
          <p>Pastikan QR berasal dari PDF Serah Terima Kunci yang diterbitkan aplikasi.</p>
          <Link href="/transactions/replenish" className="replenish-button secondary">Kembali</Link>
        </section>
      )}
    </div>
  )
}
