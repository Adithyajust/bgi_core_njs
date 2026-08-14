import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { createQrMatrix } from "./qr-code.js"

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN_X = 39.5
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2
const BOTTOM_LIMIT = 790

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

function formatNumber(value) {
  return new Intl.NumberFormat("id-ID").format(Number(value || 0))
}

function formatCurrency(value) {
  return `Rp ${formatNumber(Math.round(Number(value || 0)))}`
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

function breakWord(word, maxWidth, size, bold) {
  const output = []
  let current = ""
  for (const character of word) {
    const candidate = `${current}${character}`
    if (current && measureText(candidate, size, bold) > maxWidth) {
      output.push(current)
      current = character
    } else {
      current = candidate
    }
  }
  if (current) output.push(current)
  return output
}

function wrapText(value, maxWidth, size, bold = false) {
  const paragraphs = normalizeText(value).split("\n")
  const lines = []

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push("")
    } else {
      let current = ""
      for (const rawWord of words) {
        const fragments = measureText(rawWord, size, bold) > maxWidth
          ? breakWord(rawWord, maxWidth, size, bold)
          : [rawWord]
        for (const word of fragments) {
          const candidate = current ? `${current} ${word}` : word
          if (current && measureText(candidate, size, bold) > maxWidth) {
            lines.push(current)
            current = word
          } else {
            current = candidate
          }
        }
      }
      if (current) lines.push(current)
    }
    if (paragraphIndex < paragraphs.length - 1 && lines.at(-1) !== "") lines.push("")
  })

  return lines.length ? lines : [""]
}

function parseJpegDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("Asset logo PDF harus berupa JPEG yang valid.")
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
  throw new Error("Dimensi JPEG logo tidak dapat dibaca.")
}

class PdfBuilder {
  constructor() {
    this.objects = []
  }

  reserveObject() {
    this.objects.push(null)
    return this.objects.length
  }

  setObject(id, value) {
    this.objects[id - 1] = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "binary")
  }

  addObject(value) {
    const id = this.reserveObject()
    this.setObject(id, value)
    return id
  }

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
        Buffer.from(`${index + 1} 0 obj\n`, "binary"),
        object,
        Buffer.from("\nendobj\n", "binary"),
      ])
      chunks.push(chunk)
      byteLength += chunk.length
    })

    const xrefOffset = byteLength
    const xref = [`xref\n0 ${this.objects.length + 1}\n`, "0000000000 65535 f \n"]
    for (let index = 1; index <= this.objects.length; index += 1) {
      xref.push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`)
    }
    const trailer = [
      `trailer\n<< /Size ${this.objects.length + 1} /Root ${rootId} 0 R`,
      infoId ? ` /Info ${infoId} 0 R` : "",
      ` >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    ].join("")

    chunks.push(Buffer.from(xref.join("") + trailer, "binary"))
    return Buffer.concat(chunks)
  }
}

class PageCanvas {
  constructor() {
    this.commands = []
  }

  push(command) {
    this.commands.push(command)
  }

  strokeColor(gray = 0) {
    this.push(`${gray} G`)
  }

  fillColor(gray = 0) {
    this.push(`${gray} g`)
  }

  lineWidth(width = 1) {
    this.push(`${width} w`)
  }

  line(x1, top1, x2, top2) {
    this.push(`${x1.toFixed(2)} ${(PAGE_HEIGHT - top1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE_HEIGHT - top2).toFixed(2)} l S`)
  }

  rect(x, top, width, height, options = {}) {
    const operator = options.fill && options.stroke ? "B" : options.fill ? "f" : "S"
    this.push(`${x.toFixed(2)} ${(PAGE_HEIGHT - top - height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re ${operator}`)
  }

  text(x, top, value, options = {}) {
    const size = options.size || 9
    const font = options.bold ? "/F2" : "/F1"
    const width = options.width || null
    let targetX = x
    if (width && options.align === "center") {
      targetX = x + Math.max(0, (width - measureText(value, size, Boolean(options.bold))) / 2)
    } else if (width && options.align === "right") {
      targetX = x + Math.max(0, width - measureText(value, size, Boolean(options.bold)))
    }
    const baseline = PAGE_HEIGHT - top - size
    this.push(`BT ${font} ${size.toFixed(2)} Tf 1 0 0 1 ${targetX.toFixed(2)} ${baseline.toFixed(2)} Tm (${escapePdfString(value)}) Tj ET`)
  }

  image(name, x, top, width, height) {
    this.push(`q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${(PAGE_HEIGHT - top - height).toFixed(2)} cm /${name} Do Q`)
  }

  toBuffer() {
    return Buffer.from(this.commands.join("\n"), "binary")
  }
}

function drawTextLines(canvas, lines, x, top, options = {}) {
  const size = options.size || 8
  const lineHeight = options.lineHeight || size * 1.25
  lines.forEach((line, index) => {
    canvas.text(x, top + index * lineHeight, line, options)
  })
  return lines.length * lineHeight
}

function cellLines(value, width, options = {}) {
  return wrapText(value, Math.max(8, width - (options.paddingX || 6) * 2), options.size || 7.5, Boolean(options.bold))
}

function drawSimpleTableRow(canvas, columns, top, options = {}) {
  const paddingX = options.paddingX ?? 5
  const paddingY = options.paddingY ?? 4
  const fontSize = options.fontSize ?? 7.3
  const lineHeight = options.lineHeight ?? 9.2
  const processed = columns.map((column) => {
    const lines = Array.isArray(column.lines)
      ? column.lines.flatMap((line) => cellLines(line, column.width, { paddingX, size: fontSize, bold: column.bold }))
      : cellLines(column.text ?? "-", column.width, { paddingX, size: fontSize, bold: column.bold })
    return { ...column, lines }
  })
  const lineCount = Math.max(...processed.map((column) => column.lines.length), 1)
  const height = Math.max(options.minimumHeight || 20, paddingY * 2 + lineCount * lineHeight)

  let x = MARGIN_X
  processed.forEach((column) => {
    if (options.header) {
      canvas.fillColor(0.94)
      canvas.rect(x, top, column.width, height, { fill: true })
      canvas.fillColor(0)
    }
    canvas.rect(x, top, column.width, height)
    const align = column.align || (options.header ? "center" : "left")
    const textTop = top + paddingY
    column.lines.forEach((line, index) => {
      canvas.text(x + paddingX, textTop + index * lineHeight, line, {
        size: fontSize,
        bold: column.bold || options.header,
        width: column.width - paddingX * 2,
        align,
      })
    })
    x += column.width
  })

  return height
}

function drawFormHeader(canvas, logo) {
  const top = 24
  const topHeight = 42
  const titleHeight = 17
  const logoWidth = 130
  const companyWidth = 248

  canvas.lineWidth(0.75)
  canvas.strokeColor(0.35)
  canvas.rect(MARGIN_X, top, CONTENT_WIDTH, topHeight + titleHeight)
  canvas.line(MARGIN_X, top + topHeight, MARGIN_X + CONTENT_WIDTH, top + topHeight)
  canvas.line(MARGIN_X + logoWidth, top, MARGIN_X + logoWidth, top + topHeight)
  canvas.line(MARGIN_X + logoWidth + companyWidth, top, MARGIN_X + logoWidth + companyWidth, top + topHeight)
  canvas.line(MARGIN_X + logoWidth + companyWidth, top + topHeight / 2, MARGIN_X + CONTENT_WIDTH, top + topHeight / 2)
  canvas.strokeColor(0)

  if (logo) {
    const maxWidth = logoWidth - 16
    const maxHeight = topHeight - 10
    const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height)
    const width = logo.width * scale
    const height = logo.height * scale
    canvas.image("Im1", MARGIN_X + (logoWidth - width) / 2, top + (topHeight - height) / 2, width, height)
  } else {
    canvas.text(MARGIN_X, top + 13, "BGI", { size: 16, bold: true, width: logoWidth, align: "center" })
  }

  canvas.text(MARGIN_X + logoWidth, top + 14, "PT. BRINGIN GIGANTARA", {
    size: 11,
    bold: true,
    width: companyWidth,
    align: "center",
  })
  canvas.text(MARGIN_X + logoWidth + companyWidth + 6, top + 6, "BG-KLY-FRM-002-01", { size: 6.8 })
  canvas.text(MARGIN_X + logoWidth + companyWidth + 6, top + topHeight / 2 + 6, "Revisi 03", { size: 6.8 })
  canvas.text(MARGIN_X, top + topHeight + 4.5, "FORM SURAT TUGAS", {
    size: 9,
    bold: true,
    width: CONTENT_WIDTH,
    align: "center",
  })

  return top + topHeight + titleHeight
}

function drawQr(canvas, verificationUrl, x, top, size) {
  const matrix = createQrMatrix(verificationUrl)
  const quietZone = 4
  const count = matrix.length + quietZone * 2
  const moduleSize = size / count
  canvas.fillColor(1)
  canvas.rect(x, top, size, size, { fill: true })
  canvas.fillColor(0)
  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = 0; column < matrix.length; column += 1) {
      if (!matrix[row][column]) continue
      canvas.rect(
        x + (column + quietZone) * moduleSize,
        top + (row + quietZone) * moduleSize,
        moduleSize + 0.08,
        moduleSize + 0.08,
        { fill: true }
      )
    }
  }
}

function createPdfInfo(builder, letterNo) {
  const date = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)
  return builder.addObject(`<< /Title (${escapePdfString(`Surat Tugas ${letterNo}`)}) /Author (PT. BRINGIN GIGANTARA) /Creator (CRO Replenish) /Producer (CRO Internal PDF Generator) /CreationDate (D:${date}+07'00') >>`)
}

export async function generateAssignmentLetterPdf({
  letter,
  verificationUrl,
  logoPath = path.join(process.cwd(), "public", "bgi-logo-surat-tugas-pdf.jpg"),
}) {
  const payload = letter?.payload
  const workOrder = payload?.work_order
  if (!payload || !workOrder) throw new Error("Snapshot Surat Tugas tidak tersedia.")

  const approved = letter.status === "DISETUJUI"
  const preparatory = letter.status === "MENUNGGU_PERSETUJUAN"
  if (!letter.payload_valid || (!approved && !preparatory) || (approved && !letter.approval_valid)) {
    throw new Error("Surat Tugas belum valid untuk dibentuk menjadi PDF.")
  }
  if (approved && !verificationUrl) throw new Error("URL verifikasi QR tidak tersedia.")

  let logoBuffer = null
  let logo = null
  try {
    logoBuffer = await fs.readFile(logoPath)
    logo = parseJpegDimensions(logoBuffer)
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }

  const pages = []
  let canvas = null
  let cursorY = 0

  function newPage({ continuation = false } = {}) {
    canvas = new PageCanvas()
    pages.push(canvas)
    cursorY = drawFormHeader(canvas, logo) + 14
    if (continuation) {
      canvas.text(MARGIN_X, cursorY, `Lanjutan Surat Tugas ${payload.letter_no}`, {
        size: 7.5,
        bold: true,
        width: CONTENT_WIDTH,
        align: "right",
      })
      cursorY += 16
    }
  }

  function ensureSpace(height, continuationTitle = null) {
    if (cursorY + height <= BOTTOM_LIMIT) return
    newPage({ continuation: true })
    if (continuationTitle) {
      canvas.text(MARGIN_X, cursorY, continuationTitle, { size: 9, bold: true })
      cursorY += 17
    }
  }

  newPage()

  canvas.text(MARGIN_X, cursorY, "SURAT TUGAS", {
    size: 14,
    bold: true,
    width: CONTENT_WIDTH,
    align: "center",
  })
  const titleWidth = measureText("SURAT TUGAS", 14, true)
  canvas.line((PAGE_WIDTH - titleWidth) / 2, cursorY + 17, (PAGE_WIDTH + titleWidth) / 2, cursorY + 17)
  cursorY += 22
  canvas.text(MARGIN_X, cursorY, `Nomor: ${payload.letter_no}`, {
    size: 9,
    width: CONTENT_WIDTH,
    align: "center",
  })
  cursorY += 24

  const opening = `Sehubungan dengan pelaksanaan kegiatan Replenish ATM/CRM berdasarkan Work Order ${workOrder.number}, dengan ini menugaskan personel berikut:`
  const openingLines = wrapText(opening, CONTENT_WIDTH, 8.7)
  drawTextLines(canvas, openingLines, MARGIN_X, cursorY, { size: 8.7, lineHeight: 11 })
  cursorY += openingLines.length * 11 + 9

  const teamColumns = [
    { text: "No.", width: 28, align: "center" },
    { text: "Nama / NIP", width: 170 },
    { text: "Jabatan", width: 142 },
    { text: "Peran", width: CONTENT_WIDTH - 340 },
  ]
  ensureSpace(46, "Daftar Personel Pelaksana")
  cursorY += drawSimpleTableRow(canvas, teamColumns, cursorY, { header: true, fontSize: 7.4, minimumHeight: 21 })

  const teamRows = [
    ...(payload.team || []).map((member, index) => [
      String(index + 1),
      `${member.name || "-"}\n${member.nip || "-"}`,
      member.position || "-",
      titleCase(member.role),
    ]),
    [
      String((payload.team || []).length + 1),
      workOrder.escort_name || "-",
      "Petugas Pengawalan",
      "Pengawalan",
    ],
  ]

  for (const row of teamRows) {
    const columns = teamColumns.map((column, index) => ({
      ...column,
      text: row[index],
      align: index === 0 ? "center" : "left",
      bold: index === 1,
    }))
    const predicted = Math.max(...columns.map((column) => cellLines(column.text, column.width, { size: 7.3, bold: column.bold }).length)) * 9.2 + 8
    if (cursorY + predicted > BOTTOM_LIMIT) {
      newPage({ continuation: true })
      canvas.text(MARGIN_X, cursorY, "Daftar Personel Pelaksana", { size: 9, bold: true })
      cursorY += 17
      cursorY += drawSimpleTableRow(canvas, teamColumns, cursorY, { header: true, fontSize: 7.4, minimumHeight: 21 })
    }
    cursorY += drawSimpleTableRow(canvas, columns, cursorY, { fontSize: 7.3, minimumHeight: 21 })
  }

  cursorY += 12
  ensureSpace(94, "Ringkasan Pelaksanaan")
  const summaryItems = [
    ["Unit Kerja", `${workOrder.unit?.code || "-"} - ${workOrder.unit?.name || "-"}`],
    ["Tanggal Pelaksanaan", formatDate(workOrder.schedule_date)],
    ["Waktu", `${workOrder.departure_time || "-"}-${workOrder.estimated_finish_time || "-"}`],
    ["Kendaraan", workOrder.vehicle?.label || "-"],
    ["Prioritas", titleCase(workOrder.priority)],
    ["Total Nominal", formatCurrency(workOrder.total_requested_amount)],
  ]
  const summaryRowHeight = 26
  for (let index = 0; index < summaryItems.length; index += 2) {
    const top = cursorY
    const cellWidth = CONTENT_WIDTH / 2
    for (let side = 0; side < 2; side += 1) {
      const item = summaryItems[index + side]
      const x = MARGIN_X + side * cellWidth
      canvas.rect(x, top, cellWidth, summaryRowHeight)
      canvas.text(x + 6, top + 6, item[0], { size: 7, width: 100 })
      const valueLines = wrapText(item[1], cellWidth - 116, 7.3, true)
      drawTextLines(canvas, valueLines.slice(0, 2), x + 108, top + 6, { size: 7.3, bold: true, lineHeight: 9 })
    }
    cursorY += summaryRowHeight
  }

  cursorY += 15
  ensureSpace(45, "Rangkaian Titik Pelaksanaan")
  canvas.text(MARGIN_X, cursorY, "Rangkaian Titik Pelaksanaan", { size: 9.5, bold: true })
  cursorY += 17

  const pointColumns = [
    { text: "No.", width: 28, align: "center" },
    { text: "TID / SN", width: 78 },
    { text: "Lokasi", width: 143 },
    { text: "Aktivitas", width: 70 },
    { text: "Pagu / Denom", width: 104 },
    { text: "Nominal", width: CONTENT_WIDTH - 423 },
  ]
  cursorY += drawSimpleTableRow(canvas, pointColumns, cursorY, { header: true, fontSize: 7, minimumHeight: 22 })

  for (const point of payload.points || []) {
    const paguDenom = point.activity_type === "PENGOSONGAN"
      ? "-"
      : `${formatNumber(point.pagu)} lembar / ${formatNumber(point.denomination)}${point.required_cassettes ? `\n${point.required_cassettes} kaset` : ""}`
    const values = [
      String(point.sequence_no),
      `${point.tid || "-"}\n${point.serial_number || "-"}`,
      point.location || "-",
      titleCase(point.activity_type),
      paguDenom,
      point.requested_amount === null ? "-" : formatCurrency(point.requested_amount),
    ]
    const columns = pointColumns.map((column, index) => ({
      ...column,
      text: values[index],
      bold: index === 1,
      align: index === 0 ? "center" : "left",
    }))
    const predicted = Math.max(...columns.map((column) => cellLines(column.text, column.width, { size: 6.8, bold: column.bold }).length)) * 8.6 + 8
    if (cursorY + predicted > BOTTOM_LIMIT) {
      newPage({ continuation: true })
      canvas.text(MARGIN_X, cursorY, "Rangkaian Titik Pelaksanaan", { size: 9.5, bold: true })
      cursorY += 17
      cursorY += drawSimpleTableRow(canvas, pointColumns, cursorY, { header: true, fontSize: 7, minimumHeight: 22 })
    }
    cursorY += drawSimpleTableRow(canvas, columns, cursorY, { fontSize: 6.8, lineHeight: 8.6, minimumHeight: 22 })
  }

  if (workOrder.route_notes || workOrder.notes) {
    cursorY += 14
    const noteParts = []
    if (workOrder.route_notes) noteParts.push(`Rute/Instruksi: ${workOrder.route_notes}`)
    if (workOrder.notes) noteParts.push(`Catatan: ${workOrder.notes}`)
    const noteLines = wrapText(noteParts.join("\n"), CONTENT_WIDTH - 14, 7.5)
    const noteHeight = Math.max(44, noteLines.length * 9.5 + 24)
    ensureSpace(noteHeight + 20, "Instruksi dan Catatan")
    canvas.text(MARGIN_X, cursorY, "Instruksi dan Catatan", { size: 9.5, bold: true })
    cursorY += 17
    canvas.rect(MARGIN_X, cursorY, CONTENT_WIDTH, noteHeight)
    drawTextLines(canvas, noteLines, MARGIN_X + 7, cursorY + 7, { size: 7.5, lineHeight: 9.5 })
    cursorY += noteHeight
  }

  cursorY += 15
  const closing = "Surat tugas ini agar dilaksanakan dengan penuh tanggung jawab, mengikuti prosedur keamanan, dan dilaporkan sesuai ketentuan operasional yang berlaku."
  const closingLines = wrapText(closing, CONTENT_WIDTH, 8.3)
  ensureSpace(closingLines.length * 10.5 + 150)
  drawTextLines(canvas, closingLines, MARGIN_X, cursorY, { size: 8.3, lineHeight: 10.5 })
  cursorY += closingLines.length * 10.5 + 16

  const signatureHeight = 120
  ensureSpace(signatureHeight + 28)
  const leftWidth = CONTENT_WIDTH - 190
  canvas.text(MARGIN_X, cursorY, "Integritas Dokumen", { size: 8, bold: true })
  cursorY += 14
  canvas.fillColor(0.97)
  canvas.rect(MARGIN_X, cursorY, leftWidth, 45, { fill: true })
  canvas.fillColor(0)
  canvas.rect(MARGIN_X, cursorY, leftWidth, 45)
  const hashLines = wrapText(letter.document_hash, leftWidth - 12, 6.6)
  drawTextLines(canvas, hashLines, MARGIN_X + 6, cursorY + 7, { size: 6.6, lineHeight: 8 })
  canvas.text(MARGIN_X, cursorY + 52, "Pindai QR untuk memverifikasi dokumen asli pada aplikasi.", { size: 6.8 })

  const signerX = MARGIN_X + leftWidth + 20
  const signerWidth = CONTENT_WIDTH - leftWidth - 20
  if (approved) {
    canvas.text(signerX, cursorY - 14, "Disetujui secara elektronik,", { size: 7.5, width: signerWidth, align: "center" })
    const qrSize = 76
    drawQr(canvas, verificationUrl, signerX + (signerWidth - qrSize) / 2, cursorY + 2, qrSize)
    canvas.text(signerX, cursorY + 82, letter.approved_by_name || "-", { size: 8, bold: true, width: signerWidth, align: "center" })
    canvas.line(signerX + 12, cursorY + 93, signerX + signerWidth - 12, cursorY + 93)
    canvas.text(signerX, cursorY + 96, letter.approved_by_position || "Pejabat Approver Replenish", { size: 6.8, width: signerWidth, align: "center" })
    const signerMeta = `${letter.approved_by_nip ? `NIP ${letter.approved_by_nip} - ` : ""}${formatDateTime(letter.approved_at)}`
    const signerMetaLines = wrapText(signerMeta, signerWidth, 6.2)
    drawTextLines(canvas, signerMetaLines.slice(0, 2), signerX, cursorY + 107, { size: 6.2, lineHeight: 7.5, width: signerWidth, align: "center" })
  } else {
    canvas.text(signerX, cursorY - 14, "Status dokumen", { size: 7.5, width: signerWidth, align: "center" })
    canvas.rect(signerX + 18, cursorY + 12, signerWidth - 36, 54)
    canvas.text(signerX + 18, cursorY + 27, "MENUNGGU PERSETUJUAN", { size: 8, bold: true, width: signerWidth - 36, align: "center" })
    canvas.text(signerX + 18, cursorY + 43, "Dokumen persiapan sebelum Work Order diajukan.", { size: 6.7, width: signerWidth - 36, align: "center" })
    canvas.text(signerX, cursorY + 84, letter.created_by_name || "Pembuat Work Order", { size: 8, bold: true, width: signerWidth, align: "center" })
    canvas.line(signerX + 12, cursorY + 95, signerX + signerWidth - 12, cursorY + 95)
    canvas.text(signerX, cursorY + 99, "Dokumen belum memiliki QR approval", { size: 6.5, width: signerWidth, align: "center" })
  }
  cursorY += signatureHeight

  canvas.line(MARGIN_X, cursorY, MARGIN_X + CONTENT_WIDTH, cursorY)
  canvas.text(MARGIN_X, cursorY + 5, payload.letter_no, { size: 6.2 })
  canvas.text(MARGIN_X, cursorY + 5, `Work Order ${workOrder.number}`, { size: 6.2, width: CONTENT_WIDTH, align: "center" })
  canvas.text(MARGIN_X, cursorY + 5, `Hash ${String(letter.document_hash).slice(0, 16)}...`, { size: 6.2, width: CONTENT_WIDTH, align: "right" })

  const builder = new PdfBuilder()
  const pagesId = builder.reserveObject()
  const regularFontId = builder.addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
  const boldFontId = builder.addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
  let imageId = null
  if (logoBuffer && logo) {
    imageId = builder.addStream(
      `/Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
      logoBuffer
    )
  }

  const pageIds = []
  for (const page of pages) {
    const contentId = builder.addStream("", page.toBuffer())
    const xObject = imageId ? ` /XObject << /Im1 ${imageId} 0 R >>` : ""
    const pageId = builder.addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >>${xObject} >> /Contents ${contentId} 0 R >>`)
    pageIds.push(pageId)
  }

  builder.setObject(pagesId, `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`)
  const catalogId = builder.addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R /PageLayout /SinglePage >>`)
  const infoId = createPdfInfo(builder, payload.letter_no)
  return builder.finish(catalogId, infoId)
}

export function hashPdfBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex")
}
