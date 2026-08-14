import crypto from "node:crypto"
import fs from "node:fs"

import { hasReplenishReachedApproval } from "./constants.js"
import { createQrMatrix } from "./qr-code.js"

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN_X = 36
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2
const BOTTOM = 800

// Naikkan hanya jika layout/cetakan PDF berubah. Snapshot bisnis tetap memakai hash yang sama.
export const KEY_HANDOVER_PDF_TEMPLATE_VERSION = 5

function normalizeText(value) {
  return String(value ?? "-")
    .replace(/[–—]/g, "-")
    .replace(/·/g, "-")
    .replace(/…/g, "...")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E\n]/g, "?")
}

function escapePdfString(value) {
  return normalizeText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n")
}


function charWidth(character, bold = false) {
  if (character === " ") return 0.278
  if (/[ilI.,:;'!|]/.test(character)) return 0.278
  if (/[mwMW@%&]/.test(character)) return bold ? 0.91 : 0.86
  if (/[A-Z]/.test(character)) return bold ? 0.69 : 0.66
  if (/[0-9]/.test(character)) return 0.556
  return bold ? 0.54 : 0.5
}

function measureText(value, size, bold = false) {
  return [...normalizeText(value)].reduce((sum, character) => sum + charWidth(character, bold), 0) * size
}

function parseJpegDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("Asset logo PDF Serah Terima Kunci harus berupa JPEG yang valid.")
  }

  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]
    offset += 2
    if (marker === 0xd8 || marker === 0xd9) continue
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) break
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      }
    }
    offset += length
  }
  throw new Error("Dimensi JPEG logo Serah Terima Kunci tidak dapat dibaca.")
}

function loadFormHeaderLogo() {
  try {
    const buffer = fs.readFileSync(new URL("../../public/bgi-logo-surat-tugas-pdf.jpg", import.meta.url))
    const dimensions = parseJpegDimensions(buffer)
    return { buffer, ...dimensions }
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

function truncate(value, maxLength) {
  const normalized = normalizeText(value)
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(1, maxLength - 3))}...`
}

function normalizeDocumentWorkflowStatus(status) {
  const normalized = String(status || "").trim().toUpperCase()
  // Status Work Order terus bergerak setelah approval (misalnya menjadi
  // KASET_DALAM_PERSIAPAN). Perubahan status proses tersebut bukan perubahan
  // bukti Serah Terima Kunci. Untuk hash dokumen, seluruh status pasca-approval
  // dipatok ke DISETUJUI agar snapshot verifikasi tetap immutable/stabil.
  return hasReplenishReachedApproval(normalized) ? "DISETUJUI" : normalized
}

function stableItem(item) {
  return {
    sequence_no: Number(item?.sequence_no) || 0,
    work_order_point_id: Number(item?.work_order_point_id) || null,
    machine_id: Number(item?.machine_id) || null,
    tid: String(item?.tid || ""),
    sn: String(item?.sn || ""),
    lokasi: String(item?.lokasi || ""),
    machine_key_mapping_id: Number(item?.machine_key_mapping_id) || null,
    position: String(item?.position || ""),
    barcode_snapshot: String(item?.barcode_snapshot || ""),
    scanned_at: String(item?.scanned_at || ""),
    scanned_by: Number(item?.scanned_by) || null,
    scanned_by_name: String(item?.scanned_by_name || ""),
  }
}

export function createKeyHandoverDocumentPayload(snapshot) {
  if (!snapshot?.id || !snapshot?.work_order_no || !snapshot?.receipt_no) {
    throw new Error("Snapshot Serah Terima Kunci belum lengkap.")
  }
  if (!snapshot?.summary?.all_scanned) {
    throw new Error("Serah Terima Kunci belum memiliki scan lengkap.")
  }
  if (!snapshot?.verification_token || !snapshot?.handover_approved_at || !snapshot?.handover_approved_by) {
    throw new Error("Serah Terima Kunci belum memiliki QR approval.")
  }

  const items = (snapshot.items || [])
    .map(stableItem)
    .sort((a, b) => a.sequence_no - b.sequence_no || Number(a.machine_id) - Number(b.machine_id))

  if (items.length === 0 || items.some((item) => !item.barcode_snapshot || !item.scanned_at)) {
    throw new Error("Snapshot Serah Terima Kunci mengandung item yang belum diverifikasi.")
  }

  return {
    schema_version: 2,
    document_type: "REPLENISH_KEY_HANDOVER",
    work_order: {
      id: Number(snapshot.id),
      work_order_no: String(snapshot.work_order_no),
      status: normalizeDocumentWorkflowStatus(snapshot.status),
      created_by: Number(snapshot.created_by) || null,
      created_by_name: String(snapshot.created_by_name || ""),
      codeuker: String(snapshot.codeuker || "").trim().toUpperCase(),
      nama_uker: String(snapshot.nama_uker || ""),
      schedule_date: String(snapshot.schedule_date || ""),
      departure_time: String(snapshot.departure_time || ""),
    },
    handover: {
      handover_id: Number(snapshot.handover_id) || null,
      receipt_no: String(snapshot.receipt_no),
      verified_at: String(snapshot.verified_at || ""),
      verified_by: Number(snapshot.verified_by) || null,
      verified_by_name: String(snapshot.verified_by_name || ""),
      verification_token: String(snapshot.verification_token || "").toLowerCase(),
      approved_at: String(snapshot.handover_approved_at || ""),
      approved_by: Number(snapshot.handover_approved_by) || null,
      approved_by_name: String(snapshot.handover_approved_by_name || ""),
      giver_name: String(snapshot.giver_name || snapshot.verified_by_name || ""),
      giver_nip: String(snapshot.giver_nip || ""),
      giver_position: String(snapshot.giver_position || "Admin CRO"),
      custody_id: Number(snapshot.custody_id) || null,
      custody_nip: String(snapshot.custody_nip || ""),
      custody_name: String(snapshot.custody_name || ""),
      recipient_name: String(snapshot.recipient_name || snapshot.custody_name || ""),
      recipient_nip: String(snapshot.recipient_nip || snapshot.custody_nip || ""),
      recipient_position: String(snapshot.recipient_position || "Custody"),
    },
    items,
  }
}

export function hashKeyHandoverDocument(snapshotOrPayload) {
  const payload = snapshotOrPayload?.document_type === "REPLENISH_KEY_HANDOVER"
    ? {
      ...snapshotOrPayload,
      work_order: {
        ...(snapshotOrPayload.work_order || {}),
        status: normalizeDocumentWorkflowStatus(snapshotOrPayload.work_order?.status),
      },
    }
    : createKeyHandoverDocumentPayload(snapshotOrPayload)
  return crypto.createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex")
}

export function hashKeyHandoverPdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100) throw new Error("Buffer PDF Serah Terima Kunci tidak valid.")
  return crypto.createHash("sha256").update(buffer).digest("hex")
}

export function createKeyHandoverApprovalHash({
  documentHash,
  verificationToken,
  approvedBy,
  approvedAt,
}) {
  const normalizedDocumentHash = String(documentHash || "").trim().toLowerCase()
  const normalizedToken = String(verificationToken || "").trim().toLowerCase()
  const normalizedApprovedAt = String(approvedAt || "").trim()
  if (
    !/^[0-9a-f]{64}$/.test(normalizedDocumentHash)
    || !/^[0-9a-f-]{36}$/.test(normalizedToken)
    || !Number(approvedBy)
    || !normalizedApprovedAt
  ) {
    throw new Error("Data approval QR Serah Terima Kunci tidak valid.")
  }
  return crypto.createHash("sha256")
    .update(`${normalizedDocumentHash}|${normalizedToken}|${Number(approvedBy)}|${normalizedApprovedAt}`, "utf8")
    .digest("hex")
}

class PdfBuilder {
  constructor() { this.objects = [] }
  reserveObject() { this.objects.push(null); return this.objects.length }
  setObject(id, value) { this.objects[id - 1] = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "binary") }
  addObject(value) { const id = this.reserveObject(); this.setObject(id, value); return id }
  addStream(dictionary, stream) {
    const body = Buffer.isBuffer(stream) ? stream : Buffer.from(String(stream), "binary")
    return this.addObject(Buffer.concat([
      Buffer.from(`<< ${dictionary} /Length ${body.length} >>\nstream\n`, "binary"),
      body,
      Buffer.from("\nendstream", "binary"),
    ]))
  }
  finish(rootId, infoId = null) {
    const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")]
    const offsets = [0]
    let byteLength = chunks[0].length
    this.objects.forEach((object, index) => {
      if (!object) throw new Error(`Objek PDF ${index + 1} belum diisi.`)
      offsets.push(byteLength)
      const chunk = Buffer.concat([
        Buffer.from(`${index + 1} 0 obj\n`, "binary"), object, Buffer.from("\nendobj\n", "binary"),
      ])
      chunks.push(chunk)
      byteLength += chunk.length
    })
    const xrefOffset = byteLength
    const xref = [`xref\n0 ${this.objects.length + 1}\n`, "0000000000 65535 f \n"]
    for (let i = 1; i <= this.objects.length; i += 1) xref.push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`)
    chunks.push(Buffer.from(`${xref.join("")}trailer\n<< /Size ${this.objects.length + 1} /Root ${rootId} 0 R${infoId ? ` /Info ${infoId} 0 R` : ""} >>\nstartxref\n${xrefOffset}\n%%EOF\n`, "binary"))
    return Buffer.concat(chunks)
  }
}

class PageCanvas {
  constructor() { this.commands = [] }
  text(x, top, value, { size = 8, bold = false, width = null, align = "left" } = {}) {
    let targetX = x
    if (width && align === "center") {
      targetX = x + Math.max(0, (width - measureText(value, size, bold)) / 2)
    } else if (width && align === "right") {
      targetX = x + Math.max(0, width - measureText(value, size, bold))
    }
    const y = PAGE_HEIGHT - top - size
    this.commands.push(`BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${targetX.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfString(value)}) Tj ET`)
  }
  line(x1, top1, x2, top2) {
    this.commands.push(`${x1.toFixed(2)} ${(PAGE_HEIGHT - top1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE_HEIGHT - top2).toFixed(2)} l S`)
  }
  rect(x, top, width, height) {
    this.commands.push(`${x.toFixed(2)} ${(PAGE_HEIGHT - top - height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`)
  }
  fillRect(x, top, width, height, gray = 0) {
    this.commands.push(`${Number(gray).toFixed(2)} g ${x.toFixed(2)} ${(PAGE_HEIGHT - top - height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f 0 G`)
  }
  image(name, x, top, width, height) {
    this.commands.push(`q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${(PAGE_HEIGHT - top - height).toFixed(2)} cm /${name} Do Q`)
  }
  toBuffer() { return Buffer.from(this.commands.join("\n"), "binary") }
}

function drawQr(canvas, verificationUrl, x, top, size) {
  const matrix = createQrMatrix(verificationUrl)
  const quietZone = 4
  const count = matrix.length + quietZone * 2
  const moduleSize = size / count
  canvas.fillRect(x, top, size, size, 1)
  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = 0; column < matrix.length; column += 1) {
      if (!matrix[row][column]) continue
      canvas.fillRect(
        x + (column + quietZone) * moduleSize,
        top + (row + quietZone) * moduleSize,
        moduleSize + 0.08,
        moduleSize + 0.08,
        0
      )
    }
  }
}

function drawFormHeader(canvas, logo) {
  const top = 24
  const topHeight = 42
  const titleHeight = 17
  const logoWidth = 134
  const metaWidth = 108
  const companyWidth = CONTENT_WIDTH - logoWidth - metaWidth
  const companyX = MARGIN_X + logoWidth
  const metaX = companyX + companyWidth

  canvas.rect(MARGIN_X, top, CONTENT_WIDTH, topHeight + titleHeight)
  canvas.line(MARGIN_X, top + topHeight, MARGIN_X + CONTENT_WIDTH, top + topHeight)
  canvas.line(companyX, top, companyX, top + topHeight)
  canvas.line(metaX, top, metaX, top + topHeight)
  canvas.line(metaX, top + topHeight / 2, MARGIN_X + CONTENT_WIDTH, top + topHeight / 2)

  if (logo) {
    const maxWidth = logoWidth - 22
    const maxHeight = topHeight - 12
    const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height)
    const width = logo.width * scale
    const height = logo.height * scale
    canvas.image("Im1", MARGIN_X + (logoWidth - width) / 2, top + (topHeight - height) / 2, width, height)
  } else {
    canvas.text(MARGIN_X, top + 13, "BGI", { size: 16, bold: true, width: logoWidth, align: "center" })
  }

  canvas.text(companyX, top + 14, "PT BRINGIN GIGANTARA", {
    size: 11,
    bold: true,
    width: companyWidth,
    align: "center",
  })
  canvas.text(metaX + 5, top + 6, "BG-KLY-FRM-022-02", { size: 6.6, bold: true })
  canvas.text(metaX + 5, top + topHeight / 2 + 6, "Revisi 02", { size: 6.8, bold: true })
  canvas.text(MARGIN_X, top + topHeight + 4.6, "FORM BERITA ACARA SERAH TERIMA KUNCI TOMBAK ATM/CRM DENGAN CUSTODY KEMBALI", {
    size: 7.2,
    bold: true,
    width: CONTENT_WIDTH,
    align: "center",
  })

  return top + topHeight + titleHeight
}

function drawHeader(canvas, payload, pageNumber, totalPages, logo) {
  const { work_order: wo, handover } = payload
  let y = drawFormHeader(canvas, logo) + 12

  canvas.text(MARGIN_X, y, "BERITA ACARA SERAH TERIMA KUNCI", {
    size: 13,
    bold: true,
    width: CONTENT_WIDTH,
    align: "center",
  })
  y += 21
  canvas.text(MARGIN_X, y, `No. ${handover.receipt_no}`, { size: 9, bold: true })
  canvas.text(MARGIN_X, y, `Hal ${pageNumber}/${totalPages}`, { size: 7, width: CONTENT_WIDTH, align: "right" })
  y += 17
  canvas.line(MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y)

  const leftX = MARGIN_X
  const rightX = 312
  y += 15
  canvas.text(leftX, y, `Work Order : ${wo.work_order_no}`, { size: 8 })
  canvas.text(rightX, y, `Unit Kerja : ${wo.codeuker} - ${truncate(wo.nama_uker, 30)}`, { size: 8 })
  y += 14
  canvas.text(leftX, y, `Jadwal     : ${wo.schedule_date || "-"} ${wo.departure_time || ""}`, { size: 8 })
  canvas.text(rightX, y, `Penerima   : ${truncate(handover.recipient_name || "-", 32)}`, { size: 8 })
  y += 14
  canvas.text(leftX, y, `Verifikasi : ${handover.verified_at || "-"}`, { size: 8 })
  canvas.text(rightX, y, `Penyerah   : ${truncate(handover.giver_name || "-", 32)}`, { size: 8 })
  return y + 24
}

const COLUMNS = [
  { label: "No", width: 24, max: 3 },
  { label: "TID", width: 55, max: 12 },
  { label: "SN", width: 74, max: 17 },
  { label: "Lokasi", width: 135, max: 30 },
  { label: "Matrix", width: 55, max: 12 },
  { label: "Barcode", width: 130, max: 29 },
]

function drawTableHeader(canvas, top) {
  let x = MARGIN_X
  const height = 22
  for (const column of COLUMNS) {
    canvas.rect(x, top, column.width, height)
    canvas.text(x + 4, top + 6, column.label, { size: 7, bold: true })
    x += column.width
  }
  return top + height
}

function drawItemRow(canvas, top, item) {
  const values = [
    item.sequence_no,
    item.tid || "-",
    item.sn || "-",
    item.lokasi || "-",
    item.position || "-",
    item.barcode_snapshot || "-",
  ]
  let x = MARGIN_X
  const height = 23
  COLUMNS.forEach((column, index) => {
    canvas.rect(x, top, column.width, height)
    canvas.text(x + 4, top + 6.5, truncate(values[index], column.max), { size: index === 5 ? 6.2 : 7 })
    x += column.width
  })
  return top + height
}

function drawSignatures(canvas, top, payload, verificationUrl) {
  const safeTop = Math.min(top, BOTTOM - 126)
  const gap = 76
  const sideWidth = (CONTENT_WIDTH - gap) / 2
  const rightX = MARGIN_X + sideWidth + gap
  const { handover } = payload
  const partyUrl = (party) => `${verificationUrl}${verificationUrl.includes("?") ? "&" : "?"}party=${party}`

  canvas.text(MARGIN_X, safeTop, "Petugas Penyerah", { size: 8.5, bold: true, width: sideWidth, align: "center" })
  canvas.text(rightX, safeTop, "Custody / Penerima", { size: 8.5, bold: true, width: sideWidth, align: "center" })

  const qrSize = 62
  const giverQrX = MARGIN_X + (sideWidth - qrSize) / 2
  const recipientQrX = rightX + (sideWidth - qrSize) / 2
  drawQr(canvas, partyUrl("giver"), giverQrX, safeTop + 11, qrSize)
  drawQr(canvas, partyUrl("recipient"), recipientQrX, safeTop + 11, qrSize)
  canvas.text(MARGIN_X, safeTop + 75, "QR Penyerah", { size: 5.8, bold: true, width: sideWidth, align: "center" })
  canvas.text(rightX, safeTop + 75, "QR Penerima", { size: 5.8, bold: true, width: sideWidth, align: "center" })

  canvas.line(MARGIN_X + 8, safeTop + 87, MARGIN_X + sideWidth - 8, safeTop + 87)
  canvas.line(rightX + 8, safeTop + 87, rightX + sideWidth - 8, safeTop + 87)
  canvas.text(MARGIN_X, safeTop + 92, truncate(handover.giver_name || "-", 40), {
    size: 8.2, bold: true, width: sideWidth, align: "center",
  })
  canvas.text(MARGIN_X, safeTop + 104, truncate(handover.giver_position || "Admin CRO", 42), {
    size: 7.2, width: sideWidth, align: "center",
  })
  canvas.text(MARGIN_X, safeTop + 115, handover.giver_nip ? `NIP ${truncate(handover.giver_nip, 30)}` : "NIP -", {
    size: 6.7, width: sideWidth, align: "center",
  })
  canvas.text(rightX, safeTop + 92, truncate(handover.recipient_name || "-", 40), {
    size: 8.2, bold: true, width: sideWidth, align: "center",
  })
  canvas.text(rightX, safeTop + 104, truncate(handover.recipient_position || "Custody", 42), {
    size: 7.2, width: sideWidth, align: "center",
  })
  canvas.text(rightX, safeTop + 115, handover.recipient_nip ? `NIP ${truncate(handover.recipient_nip, 30)}` : "NIP -", {
    size: 6.7, width: sideWidth, align: "center",
  })
}

export function generateKeyHandoverPdf(snapshot, { verificationUrl } = {}) {
  if (!verificationUrl) throw new Error("URL verifikasi QR Serah Terima Kunci tidak tersedia.")
  const payload = createKeyHandoverDocumentPayload(snapshot)
  const itemsPerPage = 20
  const pages = []
  for (let offset = 0; offset < payload.items.length; offset += itemsPerPage) {
    pages.push(payload.items.slice(offset, offset + itemsPerPage))
  }
  if (pages.length === 0) pages.push([])

  const builder = new PdfBuilder()
  const fontRegular = builder.addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
  const fontBold = builder.addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
  const logo = loadFormHeaderLogo()
  const imageId = logo
    ? builder.addStream(
      `/Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
      logo.buffer
    )
    : null
  const pagesId = builder.reserveObject()
  const pageIds = []

  pages.forEach((items, pageIndex) => {
    const canvas = new PageCanvas()
    let y = drawHeader(canvas, payload, pageIndex + 1, pages.length, logo)
    y = drawTableHeader(canvas, y)
    items.forEach((item) => { y = drawItemRow(canvas, y, item) })
    if (pageIndex === pages.length - 1) drawSignatures(canvas, Math.max(y + 28, 650), payload, verificationUrl)

    const contentId = builder.addStream("", canvas.toBuffer())
    const xObject = imageId ? ` /XObject << /Im1 ${imageId} 0 R >>` : ""
    const pageId = builder.addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >>${xObject} >> /Contents ${contentId} 0 R >>`)
    pageIds.push(pageId)
  })

  builder.setObject(pagesId, `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`)
  const catalogId = builder.addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
  // CreationDate dibuat dari waktu verifikasi snapshot agar PDF untuk dokumen
  // yang sama menghasilkan bytes/hash yang sama pada retry atau request paralel.
  const creationDate = String(payload.handover.verified_at || "")
    .replace(/[^0-9]/g, "")
    .padEnd(14, "0")
    .slice(0, 14) || "19700101000000"
  const infoId = builder.addObject(`<< /Title (${escapePdfString(`Serah Terima Kunci ${payload.work_order.work_order_no}`)}) /Creator (CRO Replenish) /Producer (CRO Replenish) /CreationDate (D:${creationDate}) >>`)
  return builder.finish(catalogId, infoId)
}
