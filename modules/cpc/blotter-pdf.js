import fs from "node:fs"

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 24
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

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
    throw new Error("Asset logo Blotter CPC harus berupa JPEG yang valid.")
  }
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue }
    const marker = buffer[offset + 1]
    offset += 2
    if (marker === 0xd8 || marker === 0xd9) continue
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) break
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) }
    }
    offset += length
  }
  throw new Error("Dimensi JPEG logo Blotter CPC tidak dapat dibaca.")
}

function loadLogo() {
  try {
    const buffer = fs.readFileSync(new URL("../../public/bgi-logo-surat-tugas-pdf.jpg", import.meta.url))
    return { buffer, ...parseJpegDimensions(buffer) }
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Number(value || 0))
}

function formatDate(value) {
  const raw = String(value || "").slice(0, 10)
  const [year, month, day] = raw.split("-")
  return year && month && day ? `${day}/${month}/${year}` : "-"
}

function formatTime(value) {
  const raw = String(value || "")
  const match = raw.match(/T(\d{2}:\d{2})/) || raw.match(/\b(\d{2}:\d{2})\b/)
  return match?.[1] || "-"
}

function truncate(value, maxLength) {
  const text = normalizeText(value)
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(1, maxLength - 3))}...`
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
      const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "binary"), object, Buffer.from("\nendobj\n", "binary")])
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
  constructor() { this.commands = ["0.55 w", "0 G"] }
  text(x, top, value, { size = 7, bold = false, width = null, align = "left" } = {}) {
    let targetX = x
    if (width && align === "center") targetX = x + Math.max(0, (width - measureText(value, size, bold)) / 2)
    if (width && align === "right") targetX = x + Math.max(0, width - measureText(value, size, bold))
    const y = PAGE_HEIGHT - top - size
    this.commands.push(`BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${targetX.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfString(value)}) Tj ET`)
  }
  line(x1, top1, x2, top2) {
    this.commands.push(`${x1.toFixed(2)} ${(PAGE_HEIGHT - top1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE_HEIGHT - top2).toFixed(2)} l S`)
  }
  rect(x, top, width, height) {
    this.commands.push(`${x.toFixed(2)} ${(PAGE_HEIGHT - top - height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`)
  }
  image(name, x, top, width, height) {
    this.commands.push(`q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${(PAGE_HEIGHT - top - height).toFixed(2)} cm /${name} Do Q`)
  }
  toBuffer() { return Buffer.from(this.commands.join("\n"), "binary") }
}

function drawHeader(canvas, logo) {
  const top = 26
  const h = 42
  const logoW = 155
  const metaW = 112
  const companyW = CONTENT_WIDTH - logoW - metaW
  const companyX = MARGIN + logoW
  const metaX = companyX + companyW

  canvas.rect(MARGIN, top, CONTENT_WIDTH, h)
  canvas.line(companyX, top, companyX, top + h)
  canvas.line(metaX, top, metaX, top + h)
  canvas.line(metaX, top + 14, MARGIN + CONTENT_WIDTH, top + 14)
  canvas.line(metaX, top + 28, MARGIN + CONTENT_WIDTH, top + 28)

  if (logo) {
    const scale = Math.min((logoW - 30) / logo.width, (h - 12) / logo.height)
    const w = logo.width * scale
    const hh = logo.height * scale
    canvas.image("Im1", MARGIN + (logoW - w) / 2, top + (h - hh) / 2, w, hh)
  } else {
    canvas.text(MARGIN, top + 12, "bgi", { size: 18, bold: true, width: logoW, align: "center" })
  }

  canvas.text(companyX, top + 13, "PT BRINGIN GIGANTARA", { size: 12, bold: true, width: companyW, align: "center" })
  canvas.text(metaX + 5, top + 3.5, "BG-KLY-FRM-004-02", { size: 6.4, bold: true })
  canvas.text(metaX + 5, top + 17.5, "REVISI 03", { size: 6.4, bold: true })
  canvas.text(metaX + 5, top + 31.5, "01 Januari 2020", { size: 6.1 })

  canvas.text(MARGIN, top + h + 5, "FORM ATM BLOTTER TRANSACTION", { size: 8.2, bold: true, width: CONTENT_WIDTH, align: "center" })
  canvas.text(MARGIN, top + h + 19, "ATM BLOTTER TRANSACTION", { size: 7, bold: true, width: CONTENT_WIDTH, align: "center" })
}

function drawInfo(canvas, detail, point, pageNo, totalPages) {
  const top = 102
  const leftW = 326
  const rightX = MARGIN + leftW + 8
  const labelW = 58
  const valueX = rightX + labelW
  canvas.text(MARGIN, top, "REPLENISHMENT", { size: 7, bold: true })
  canvas.text(MARGIN + CONTENT_WIDTH - 65, top, `Hal ${pageNo}/${totalPages}`, { size: 6.3, width: 65, align: "right" })

  const rows = [
    ["NO", detail.work_order_no],
    ["MACHINE", `${point.kategori_mesin || "ATM/CRM"} - ${point.sn || "-"}`],
    ["TERM. ID", point.tid || "-"],
    ["LOCATION", point.lokasi || "-"],
    ["DATE", formatDate(detail.schedule_date)],
  ]
  rows.forEach(([label, value], index) => {
    const y = top + index * 11
    canvas.text(rightX, y, label, { size: 6.2, bold: true })
    canvas.text(rightX + labelW - 7, y, ":", { size: 6.2 })
    canvas.text(valueX, y, truncate(value, 37), { size: 6.2 })
  })
}

function drawTable(canvas, { x, top, columns, rows, rowHeight = 16, headerHeight = 18, fontSize = 5.8 }) {
  const width = columns.reduce((sum, column) => sum + column.width, 0)
  const height = headerHeight + rows.length * rowHeight
  canvas.rect(x, top, width, height)
  let cx = x
  columns.forEach((column, index) => {
    if (index > 0) canvas.line(cx, top, cx, top + height)
    canvas.text(cx + 2, top + 5, column.label, { size: fontSize, bold: true, width: column.width - 4, align: column.align || "center" })
    cx += column.width
  })
  canvas.line(x, top + headerHeight, x + width, top + headerHeight)
  rows.forEach((row, rowIndex) => {
    const y = top + headerHeight + rowIndex * rowHeight
    if (rowIndex > 0) canvas.line(x, y, x + width, y)
    let cellX = x
    columns.forEach((column) => {
      const raw = row[column.key] ?? ""
      canvas.text(cellX + 2, y + 4, truncate(raw, column.maxLength || 28), {
        size: fontSize,
        width: column.width - 4,
        align: column.cellAlign || "left",
      })
      cellX += column.width
    })
  })
  return top + height
}

function drawReplenishment(canvas, detail, point, cassettes, tidAsset = null) {
  const top = 162
  const columns = [
    { key: "cassette", label: "CASSETTE", width: 54, maxLength: 12 },
    { key: "seal", label: "SEAL NO.", width: 75, maxLength: 18 },
    { key: "serial", label: "CASSETTE NO.", width: 72, maxLength: 17 },
    { key: "denom", label: "DENOM", width: 58, cellAlign: "right" },
    { key: "amount", label: "AMOUNT", width: 78, cellAlign: "right" },
    { key: "pieces", label: "PIECES", width: 46, cellAlign: "right" },
    { key: "packed", label: "PACKED BY", width: 82, maxLength: 20 },
    { key: "time", label: "TIME", width: 34, cellAlign: "center" },
    { key: "date", label: "DATE", width: 48, cellAlign: "center" },
  ]
  const rows = []
  for (let i = 1; i <= 4; i += 1) {
    const cassette = cassettes.find((item) => Number(item.cassette_no) === i)
    rows.push({
      cassette: `CASSETTE ${i}`,
      seal: cassette?.seal_no || "",
      serial: cassette?.cassette_serial || "",
      denom: cassette ? formatNumber(cassette.denomination_value) : "",
      amount: cassette ? formatNumber(cassette.amount) : "",
      pieces: cassette ? formatNumber(cassette.sheets_count) : "",
      packed: cassette?.packed_by_name || "",
      time: cassette ? formatTime(cassette.sealed_at || cassette.packed_at) : "",
      date: cassette ? formatDate(cassette.sealed_at || cassette.packed_at) : "",
    })
  }
  rows.push({
    cassette: "DIVERT",
    seal: tidAsset?.reject_cassette_seal_no || "",
    serial: tidAsset?.reject_cassette_serial || "",
    denom: tidAsset ? formatNumber(0) : "",
    amount: tidAsset ? formatNumber(0) : "",
    pieces: tidAsset ? formatNumber(0) : "",
    packed: tidAsset?.prepared_by_name || "",
    time: tidAsset ? formatTime(tidAsset.prepared_at) : "",
    date: tidAsset ? formatDate(tidAsset.prepared_at) : "",
  })
  return drawTable(canvas, { x: MARGIN, top, columns, rows, rowHeight: 17, headerHeight: 18, fontSize: 5.5 })
}

function drawReturnedSection(canvas, startTop) {
  const titleTop = startTop + 14
  canvas.text(MARGIN, titleTop, "ACTUAL CASH COUNTED RETURNED CASSETTE", { size: 6.8, bold: true })
  canvas.text(MARGIN + CONTENT_WIDTH - 180, titleTop, "TGL. SETTLEMENT:", { size: 6.2, bold: true })
  const columns = [
    { key: "cassette", label: "CASSETTE NO.", width: 88 },
    { key: "seal", label: "SEAL NO.", width: 82 },
    { key: "denom", label: "DENOM", width: 62 },
    { key: "amount", label: "AMOUNT", width: 82 },
    { key: "pieces", label: "PIECES", width: 55 },
    { key: "counted", label: "COUNTED BY", width: 82 },
    { key: "time", label: "TIME", width: 42 },
    { key: "date", label: "DATE", width: 54 },
  ]
  const rows = [1,2,3,4].map((n) => ({ cassette: `CASSETTE ${n}` }))
  rows.push({ cassette: "DIVERT" }, { cassette: "TOTAL" })
  return drawTable(canvas, { x: MARGIN, top: titleTop + 13, columns, rows, rowHeight: 14, headerHeight: 17, fontSize: 5.3 })
}

function drawRecapAndBillCount(canvas, startTop) {
  const titleTop = startTop + 14
  const leftW = 292
  const gap = 14
  canvas.text(MARGIN, titleTop, "RECAPITULATION MONEY JAM", { size: 6.5, bold: true, width: leftW, align: "center" })
  canvas.text(MARGIN + leftW + gap, titleTop, "BILL COUNT", { size: 6.5, bold: true, width: CONTENT_WIDTH - leftW - gap, align: "center" })

  const leftColumns = [
    { key: "no", label: "No", width: 24, cellAlign: "center" },
    { key: "date", label: "Tanggal", width: 62 },
    { key: "seal", label: "Seal No.", width: 70 },
    { key: "d50", label: "50 Lbr", width: 38, cellAlign: "right" },
    { key: "d100", label: "100 Lbr", width: 42, cellAlign: "right" },
    { key: "custody", label: "Custody", width: 56 },
  ]
  const leftRows = Array.from({ length: 7 }, (_, index) => ({ no: String(index + 1) }))
  leftRows.push({ no: "", date: "TOTAL" })
  drawTable(canvas, { x: MARGIN, top: titleTop + 12, columns: leftColumns, rows: leftRows, rowHeight: 13, headerHeight: 16, fontSize: 5.1 })

  const rightX = MARGIN + leftW + gap
  const rightColumns = [
    { key: "cassette", label: "", width: 72 },
    { key: "bill", label: "BILL/DISP.", width: 64, cellAlign: "right" },
    { key: "remaining", label: "REMAINING", width: 68, cellAlign: "right" },
    { key: "pieces", label: "PIECES", width: 50, cellAlign: "right" },
  ]
  const rightRows = [1,2,3,4].map((n) => ({ cassette: `CASSETTE ${n}` }))
  rightRows.push({ cassette: "TOTAL" })
  drawTable(canvas, { x: rightX, top: titleTop + 12, columns: rightColumns, rows: rightRows, rowHeight: 16, headerHeight: 16, fontSize: 5.1 })

  return titleTop + 12 + 16 + leftRows.length * 13
}

function drawNoteAndSignatures(canvas, startTop, detail, point) {
  let y = startTop + 15
  canvas.text(MARGIN, y, "Note", { size: 6.2, bold: true })
  y += 12
  for (let i = 0; i < 3; i += 1) canvas.line(MARGIN + 18, y + i * 10, MARGIN + CONTENT_WIDTH, y + i * 10)
  y += 42

  const half = (CONTENT_WIDTH - 10) / 2
  const leftX = MARGIN
  const rightX = MARGIN + half + 10
  const boxH = 112
  canvas.rect(leftX, y, half, boxH)
  canvas.rect(rightX, y, half, boxH)
  canvas.text(leftX + 6, y + 5, "Counted/Balance ATM Replenish", { size: 5.5, bold: true })
  canvas.text(rightX + 6, y + 5, "Counted/Balance ATM Return", { size: 5.5, bold: true })

  const roleW = half / 3
  for (const x of [leftX, rightX]) {
    canvas.line(x + roleW, y, x + roleW, y + boxH)
    canvas.line(x + roleW * 2, y, x + roleW * 2, y + boxH)
    canvas.text(x, y + 78, "Custody", { size: 5.4, width: roleW, align: "center" })
    canvas.text(x + roleW, y + 78, "Driver", { size: 5.4, width: roleW, align: "center" })
    canvas.text(x + roleW * 2, y + 78, "CPC", { size: 5.4, width: roleW, align: "center" })
    canvas.line(x + 12, y + 70, x + roleW - 12, y + 70)
    canvas.line(x + roleW + 12, y + 70, x + roleW * 2 - 12, y + 70)
    canvas.line(x + roleW * 2 + 12, y + 70, x + roleW * 3 - 12, y + 70)
    canvas.text(x, y + 99, "MO / Ass.Manager", { size: 5.2, width: half, align: "center" })
  }

  const custody = (detail.team || []).find((member) => member.member_role === "CUSTODY")
  canvas.text(leftX + 2, y + 88, truncate(custody?.nama || "", 18), { size: 5, width: roleW - 4, align: "center" })
  canvas.text(MARGIN, y + boxH + 7, `RANGKAP KE 1 / 2 / 3 : ATM/ADMIN/CPC - ${point.tid || "-"}`, { size: 5.6, bold: true })
}

function buildPage(detail, point, cassettes, tidAsset, logo, pageNo, totalPages) {
  const canvas = new PageCanvas()
  drawHeader(canvas, logo)
  drawInfo(canvas, detail, point, pageNo, totalPages)
  const afterReplenishment = drawReplenishment(canvas, detail, point, cassettes, tidAsset)
  const afterReturned = drawReturnedSection(canvas, afterReplenishment)
  const afterRecap = drawRecapAndBillCount(canvas, afterReturned)
  drawNoteAndSignatures(canvas, afterRecap, detail, point)
  return canvas.toBuffer()
}

export function generateCpcBlotterPdf(detail) {
  const packing = detail?.cpc_packing
  if (!detail?.id || !detail?.work_order_no || !packing?.batch || packing.batch.status !== "DISETUJUI") {
    throw new Error("Blotter hanya dapat dibuat dari packing CPC yang sudah disetujui.")
  }
  if (!packing?.summary?.all_complete) {
    throw new Error("Packing CPC belum lengkap.")
  }

  const grouped = new Map()
  for (const item of packing.items || []) {
    const pointId = Number(item.work_order_point_id)
    if (!grouped.has(pointId)) grouped.set(pointId, [])
    grouped.get(pointId).push(item)
  }

  const tidAssets = new Map()
  for (const asset of packing.tid_assets || []) {
    tidAssets.set(Number(asset.work_order_point_id), asset)
  }

  const points = (detail.points || []).filter((point) =>
    grouped.has(Number(point.id)) || tidAssets.has(Number(point.id))
  )
  if (points.length === 0) throw new Error("Tidak ada kaset CPC yang dapat dicetak ke Blotter.")

  const logo = loadLogo()
  const builder = new PdfBuilder()
  const fontRegular = builder.addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
  const fontBold = builder.addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
  let imageObject = null
  if (logo) {
    imageObject = builder.addStream(
      `/Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
      logo.buffer
    )
  }

  const pagesObject = builder.reserveObject()
  const pageObjects = []
  points.forEach((point, index) => {
    const content = buildPage(
      detail,
      point,
      grouped.get(Number(point.id)) || [],
      tidAssets.get(Number(point.id)) || null,
      logo,
      index + 1,
      points.length
    )
    const contentObject = builder.addStream("", content)
    const resources = `<< /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >>${imageObject ? ` /XObject << /Im1 ${imageObject} 0 R >>` : ""} >>`
    const pageObject = builder.addObject(`<< /Type /Page /Parent ${pagesObject} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources ${resources} /Contents ${contentObject} 0 R >>`)
    pageObjects.push(pageObject)
  })

  builder.setObject(pagesObject, `<< /Type /Pages /Count ${pageObjects.length} /Kids [${pageObjects.map((id) => `${id} 0 R`).join(" ")}] >>`)
  const catalogObject = builder.addObject(`<< /Type /Catalog /Pages ${pagesObject} 0 R >>`)
  const infoObject = builder.addObject(`<< /Title (${escapePdfString(`ATM Blotter Transaction ${detail.work_order_no}`)}) /Author (PT BRINGIN GIGANTARA) /Subject (CPC Replenishment Packing) >>`)
  return builder.finish(catalogObject, infoObject)
}
