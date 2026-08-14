"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"

import { createQrSvg } from "@/modules/replenish/qr-code"

function replenishCompatibilityUrl(url) {
  const rawUrl = String(url || "")
  const [pathname, rawQuery = ""] = rawUrl.split("?", 2)
  const match = pathname.match(
    /^\/api\/transactions\/replenish\/(\d+)\/(key-handover|surat-tugas(?:\/pdf)?)\/?$/
  )
  if (!match) return null

  const [, workOrderId, resourcePath] = match
  const resource = resourcePath === "key-handover"
    ? "key-handover"
    : resourcePath === "surat-tugas/pdf"
      ? "surat-tugas-pdf"
      : "surat-tugas"
  const params = new URLSearchParams(rawQuery)
  params.set("resource", resource)
  return `/api/transactions/replenish/${workOrderId}?${params.toString()}`
}

async function requestJson(url, options = {}) {
  const fetchOptions = {
    credentials: "include",
    cache: "no-store",
    ...options,
  }
  let response = await fetch(url, fetchOptions)
  let contentType = response.headers.get("content-type") || ""

  if (response.status === 404 && !contentType.includes("application/json")) {
    const compatibilityUrl = replenishCompatibilityUrl(url)
    if (compatibilityUrl) {
      response = await fetch(compatibilityUrl, fetchOptions)
      contentType = response.headers.get("content-type") || ""
    }
  }

  if (!contentType.includes("application/json")) {
    throw new Error(`Endpoint tidak mengembalikan JSON. Status ${response.status}.`)
  }
  const result = await response.json()
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Permintaan gagal diproses.")
  }
  return result
}

function formatCurrency(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function formatNumber(value) {
  return new Intl.NumberFormat("id-ID").format(Number(value || 0))
}

function formatDate(value) {
  if (!value) return "-"
  const raw = String(value).slice(0, 10)
  const [year, month, day] = raw.split("-")
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

function LetterDocument({ letter, verificationUrl }) {
  const payload = letter?.payload
  const workOrder = payload?.work_order
  const qrSvg = useMemo(
    () => letter?.status === "DISETUJUI" && verificationUrl
      ? createQrSvg(verificationUrl, { quietZone: 4 })
      : "",
    [letter?.status, verificationUrl]
  )
  const approved = letter?.status === "DISETUJUI"

  if (!payload || !workOrder) return null

  return (
    <article className="assignment-letter-paper">
      <header className="assignment-letter-form-header">
        <div className="assignment-letter-form-header__top">
          <div className="assignment-letter-form-header__logo">
            <Image
              src="/bgi-logo-surat-tugas.png"
              alt="Logo BGI"
              width={360}
              height={117}
              priority
            />
          </div>
          <div className="assignment-letter-form-header__company">
            <strong>PT. BRINGIN GIGANTARA</strong>
          </div>
          <div className="assignment-letter-form-header__meta">
            <div>BG-KLY-FRM-002-01</div>
            <div>Revisi 03</div>
          </div>
        </div>
        <div className="assignment-letter-form-header__title">FORM SURAT TUGAS</div>
      </header>

      <section className="assignment-letter-title">
        <h1>SURAT TUGAS</h1>
        <p>Nomor: {payload.letter_no}</p>
      </section>

      <p className="assignment-letter-opening">
        Sehubungan dengan pelaksanaan kegiatan Replenish ATM/CRM berdasarkan Work Order
        <strong> {workOrder.number}</strong>, dengan ini menugaskan personel berikut:
      </p>

      <table className="assignment-letter-team-table">
        <thead>
          <tr>
            <th>No.</th>
            <th>Nama / NIP</th>
            <th>Jabatan</th>
            <th>Peran</th>
          </tr>
        </thead>
        <tbody>
          {(payload.team || []).map((member, index) => (
            <tr key={`${member.employee_id}-${member.role}`}>
              <td>{index + 1}</td>
              <td><strong>{member.name}</strong><br /><span>{member.nip || "-"}</span></td>
              <td>{member.position || "-"}</td>
              <td>{titleCase(member.role)}</td>
            </tr>
          ))}
          <tr>
            <td>{(payload.team || []).length + 1}</td>
            <td><strong>{workOrder.escort_name || "-"}</strong></td>
            <td>Petugas Pengawalan</td>
            <td>Pengawalan</td>
          </tr>
        </tbody>
      </table>

      <section className="assignment-letter-summary">
        <div><span>Unit Kerja</span><strong>{workOrder.unit?.code} · {workOrder.unit?.name}</strong></div>
        <div><span>Tanggal Pelaksanaan</span><strong>{formatDate(workOrder.schedule_date)}</strong></div>
        <div><span>Waktu</span><strong>{workOrder.departure_time}–{workOrder.estimated_finish_time}</strong></div>
        <div><span>Kendaraan</span><strong>{workOrder.vehicle?.label || "-"}</strong></div>
        <div><span>Prioritas</span><strong>{titleCase(workOrder.priority)}</strong></div>
        <div><span>Total Nominal</span><strong>{formatCurrency(workOrder.total_requested_amount)}</strong></div>
      </section>

      <section className="assignment-letter-points">
        <h2>Rangkaian Titik Pelaksanaan</h2>
        <table>
          <thead>
            <tr>
              <th>No.</th>
              <th>TID / SN</th>
              <th>Lokasi</th>
              <th>Aktivitas</th>
              <th>Pagu / Denom</th>
              <th>Nominal</th>
            </tr>
          </thead>
          <tbody>
            {(payload.points || []).map((point) => (
              <tr key={`${point.machine_id}-${point.sequence_no}`}>
                <td>{point.sequence_no}</td>
                <td><strong>{point.tid || "-"}</strong><br /><span>{point.serial_number || "-"}</span></td>
                <td>{point.location || "-"}</td>
                <td>{titleCase(point.activity_type)}</td>
                <td>
                  {point.activity_type === "PENGOSONGAN"
                    ? "-"
                    : `${formatNumber(point.pagu)} lembar / ${formatNumber(point.denomination)}`}
                  {point.required_cassettes ? <><br /><span>{point.required_cassettes} kaset</span></> : null}
                </td>
                <td>{point.requested_amount === null ? "-" : formatCurrency(point.requested_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {(workOrder.route_notes || workOrder.notes) ? (
        <section className="assignment-letter-notes">
          <h2>Instruksi dan Catatan</h2>
          {workOrder.route_notes ? <p><strong>Rute/Instruksi:</strong> {workOrder.route_notes}</p> : null}
          {workOrder.notes ? <p><strong>Catatan:</strong> {workOrder.notes}</p> : null}
        </section>
      ) : null}

      <p className="assignment-letter-closing">
        Surat tugas ini agar dilaksanakan dengan penuh tanggung jawab, mengikuti prosedur keamanan,
        dan dilaporkan sesuai ketentuan operasional yang berlaku.
      </p>

      <section className="assignment-letter-signature">
        <div className="assignment-letter-verification-copy">
          <span>Integritas Dokumen</span>
          <code>{letter.document_hash}</code>
          <small>Pindai QR untuk memverifikasi dokumen asli pada aplikasi.</small>
        </div>
        <div className="assignment-letter-signer">
          <p>{approved ? "Disetujui secara elektronik," : "Dokumen persiapan Work Order"}</p>
          {approved && qrSvg ? (
            <div className="assignment-letter-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          ) : (
            <div className="assignment-letter-awaiting-signature">Menunggu persetujuan</div>
          )}
          <strong>{approved ? (letter.approved_by_name || "-") : (letter.created_by_name || "Pembuat Work Order")}</strong>
          <span>{approved ? (letter.approved_by_position || "Pejabat Approver Replenish") : "Surat Tugas sebelum pengajuan approval"}</span>
          <small>{approved ? `${letter.approved_by_nip ? `NIP ${letter.approved_by_nip} · ` : ""}${formatDateTime(letter.approved_at)}` : "QR approval akan terbentuk setelah Work Order disetujui."}</small>
        </div>
      </section>

      <footer className="assignment-letter-footer">
        <span>{payload.letter_no}</span>
        <span>Work Order {workOrder.number}</span>
        <span>Hash {letter.document_hash.slice(0, 16)}…</span>
      </footer>
    </article>
  )
}

export default function AssignmentLetterPage() {
  const params = useParams()
  const workOrderId = params?.id
  const [data, setData] = useState(null)
  const [storedPdf, setStoredPdf] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [confirmingPrint, setConfirmingPrint] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setError("")
      try {
        // Pemeriksaan pertama hanya membaca metadata file pada storage.
        // Jika PDF sudah ada, halaman tidak mengambil snapshot Surat Tugas dari database lagi.
        const storedResult = await requestJson(
          `/api/transactions/replenish/${workOrderId}/surat-tugas/pdf?status=1`
        )
        if (!active) return

        if (storedResult.data?.exists) {
          setStoredPdf(storedResult.data)
          setData(null)
          return
        }

        const result = await requestJson(
          `/api/transactions/replenish/${workOrderId}/surat-tugas`
        )
        if (active) setData(result.data)
      } catch (loadError) {
        if (active) setError(loadError.message)
      } finally {
        if (active) setLoading(false)
      }
    }

    if (workOrderId) load()
    return () => {
      active = false
    }
  }, [workOrderId])

  async function generatePdfAndPrint() {
    setGenerating(true)
    setMessage("")
    setError("")

    try {
      const result = await requestJson(
        `/api/transactions/replenish/${workOrderId}/surat-tugas/pdf`,
        { method: "POST" }
      )
      setStoredPdf(result.data)
      setData(null)
      setMessage("PDF Surat Tugas hasil approval dibuka. Setelah selesai mencetak, kembali ke halaman ini dan konfirmasi hasil cetak.")

      const printWindow = window.open(result.data.pdf_url, "_blank")
      if (printWindow) {
        try { printWindow.opener = null } catch { /* browser may block opener assignment */ }
      } else {
        setError("Popup PDF diblokir browser. Izinkan popup lalu gunakan tombol Cetak Surat Tugas kembali.")
      }
    } catch (generateError) {
      setError(generateError.message)
    } finally {
      setGenerating(false)
    }
  }

  async function confirmPrinted() {
    if (!storedPdf || confirmingPrint) return
    if (!window.confirm("Konfirmasi bahwa Surat Tugas sudah berhasil dicetak?")) return

    setConfirmingPrint(true)
    setMessage("")
    setError("")
    try {
      const result = await requestJson(
        `/api/transactions/replenish/${workOrderId}/surat-tugas/pdf`,
        { method: "PATCH" }
      )
      setStoredPdf(result.data)
      setMessage(result.message)
    } catch (confirmError) {
      setError(confirmError.message)
    } finally {
      setConfirmingPrint(false)
    }
  }

  const letter = data?.assignment_letter
  const canGeneratePdf = Boolean(data?.permissions?.can_print)
  const canPrepareDocument = Boolean(storedPdf?.can_prepare ?? data?.permissions?.can_prepare)
  const documentLabel = storedPdf?.letter_no || data?.work_order?.work_order_no

  return (
    <div className="simple-page assignment-letter-page">
      <section className="page-heading-card assignment-letter-toolbar no-print">
        <div>
          <p className="eyebrow">Replenish ATM/CRM</p>
          <h2>Surat Tugas</h2>
          <p>{documentLabel || "Surat Tugas Work Order Replenish."}</p>
        </div>
        <div>
          <Link href="/transactions/replenish" className="replenish-button secondary">Kembali</Link>
          {storedPdf && canPrepareDocument ? (
            <>
              <a
                href={storedPdf.pdf_url}
                target="_blank"
                rel="noreferrer"
                className="replenish-button primary"
              >
                Cetak Surat Tugas
              </a>
              {!storedPdf.printed ? (
                <button
                  type="button"
                  className="replenish-button secondary"
                  onClick={confirmPrinted}
                  disabled={confirmingPrint}
                >
                  {confirmingPrint ? "Menyimpan Konfirmasi..." : "Konfirmasi Sudah Dicetak"}
                </button>
              ) : null}
            </>
          ) : canGeneratePdf ? (
            <button
              type="button"
              className="replenish-button primary"
              onClick={generatePdfAndPrint}
              disabled={generating}
            >
              {generating ? "Membentuk PDF..." : "Bentuk PDF & Cetak Surat Tugas"}
            </button>
          ) : null}
        </div>
      </section>

      {message ? <div className="replenish-alert success no-print">{message}</div> : null}
      {error ? <div className="replenish-alert error no-print">{error}</div> : null}
      {letter?.status === "MENUNGGU_PERSETUJUAN" && canPrepareDocument ? (
        <div className="replenish-alert success no-print">
          Surat Tugas persiapan sudah selesai dan valid. Kembali ke Detail Work Order untuk scan kunci lalu ajukan. Surat Tugas baru dicetak setelah Manager Operasional / Asisten Manager CRO menyetujui Work Order.
        </div>
      ) : null}
      {(storedPdf || data) && !canPrepareDocument ? (
        <div className="replenish-alert warning no-print">
          Persiapan Surat Tugas dilakukan oleh Admin CRO pembuat Work Order. Manager Operasional / Asisten Manager CRO melakukan pemeriksaan approval; pencetakan dilakukan Admin CRO setelah Work Order disetujui.
        </div>
      ) : null}

      {loading ? (
        <div className="replenish-empty-card">Memeriksa file Surat Tugas...</div>
      ) : storedPdf ? (
        <section className="assignment-letter-stored-pdf">
          <div className="assignment-letter-stored-pdf__info no-print">
            <div>
              <span>File tersimpan</span>
              <strong>{storedPdf.file_name}</strong>
            </div>
            <div>
              <span>Dibentuk pada</span>
              <strong>{formatDateTime(storedPdf.generated_at)}</strong>
            </div>
            <div>
              <span>Status Cetak</span>
              <strong>{storedPdf.printed ? `Sudah dicetak · ${formatDateTime(storedPdf.printed_at)}` : "Belum dikonfirmasi"}</strong>
            </div>
            <div>
              <span>Hash PDF</span>
              <code>{storedPdf.pdf_hash}</code>
            </div>
          </div>
          <iframe
            key={storedPdf.pdf_hash}
            src={`${storedPdf.pdf_url}#toolbar=1&navpanes=0&view=FitH`}
            className="assignment-letter-pdf-viewer"
            title={`PDF Surat Tugas ${storedPdf.letter_no || ""}`}
          />
          <p className="assignment-letter-pdf-fallback no-print">
            Jika viewer PDF tidak tampil pada perangkat ini, {" "}
            <a href={storedPdf.pdf_url} target="_blank" rel="noreferrer">
              buka file PDF Surat Tugas pada tab baru
            </a>.
          </p>
        </section>
      ) : !letter ? (
        <section className="assignment-letter-empty no-print">
          <h3>Surat Tugas belum tersedia</h3>
          <p>Surat Tugas belum dapat dibentuk dari status Work Order saat ini.</p>
        </section>
      ) : (
        <>
          <section className={`assignment-letter-status-card no-print ${letter.status === "DISETUJUI" ? "approved" : ""}`}>
            <div>
              <span>Status Surat Tugas</span>
              <strong>{letter.status === "DISETUJUI" ? "Disetujui Otomatis" : "Menunggu Persetujuan"}</strong>
            </div>
            <div>
              <span>Nomor Surat</span>
              <strong>{letter.letter_no}</strong>
            </div>
            <div>
              <span>Integritas</span>
              <strong>{letter.payload_valid && (letter.status !== "DISETUJUI" || letter.approval_valid) ? "Valid" : "Tidak Valid"}</strong>
            </div>
          </section>
          <LetterDocument letter={letter} verificationUrl={data.verification_url} />
        </>
      )}
    </div>
  )
}
