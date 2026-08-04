import {
  MAX_VEHICLE_IMPORT_FILE_BYTES,
  MAX_VEHICLE_IMPORT_ROWS,
  VEHICLE_IMPORT_HEADERS,
  normalizeVehicleImportHeader,
} from "./import-validation"

import {
  assertSafeCellValue,
  assertSafeWorksheetCell,
  assertSafeWorksheetRow,
  assertSafeZipDataRange,
  assertSafeZipDirectory,
  assertSafeZipEntryMetadata,
  inflateRawWithLimit,
  MAX_XLSX_SHARED_STRINGS,
  MAX_XLSX_XML_ENTRY_BYTES,
  MAX_SPREADSHEET_CELL_CHARACTERS,
} from "../shared/spreadsheet-safety.js"

const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50
const ZIP_CENTRAL_FILE_SIGNATURE = 0x02014b50
const ZIP_END_SIGNATURE = 0x06054b50

const HEADER_ALIASES = new Map([
  ["kode_unit_kerja", "kode_unit_kerja"],
  ["kode_uker", "kode_unit_kerja"],
  ["codeuker", "kode_unit_kerja"],
  ["unit_kerja", "kode_unit_kerja"],
  ["jenis_kendaraan", "jenis_kendaraan"],
  ["jenis", "jenis_kendaraan"],
  ["merk_kendaraan", "merk_kendaraan"],
  ["merk", "merk_kendaraan"],
  ["merek_kendaraan", "merk_kendaraan"],
  ["merek", "merk_kendaraan"],
  ["nomor_kendaraan", "nomor_kendaraan"],
  ["nomor_polisi", "nomor_kendaraan"],
  ["nomor_polisi_kendaraan", "nomor_kendaraan"],
  ["nopol", "nomor_kendaraan"],
  ["plat_nomor", "nomor_kendaraan"],
  ["status", "status"],
  ["status_kendaraan", "status"],
])

function decodeUtf8(bytes) {
  return new TextDecoder("utf-8").decode(bytes)
}

function getFileExtension(fileName) {
  const normalized = String(fileName || "").toLowerCase()
  const dotIndex = normalized.lastIndexOf(".")
  return dotIndex >= 0 ? normalized.slice(dotIndex) : ""
}

function isBlankRow(row) {
  return !Array.isArray(row) || row.every((value) => String(value ?? "").trim() === "")
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || ""
  const candidates = [",", ";", "\t"]
  let selected = ","
  let highestCount = -1

  candidates.forEach((candidate) => {
    let count = 0
    let quoted = false

    for (let index = 0; index < firstLine.length; index += 1) {
      const char = firstLine[index]

      if (char === '"') {
        if (quoted && firstLine[index + 1] === '"') {
          index += 1
        } else {
          quoted = !quoted
        }
      } else if (!quoted && char === candidate) {
        count += 1
      }
    }

    if (count > highestCount) {
      selected = candidate
      highestCount = count
    }
  })

  return selected
}

function parseCsv(text) {
  const delimiter = detectDelimiter(text)
  const rows = []
  let row = []
  let value = ""
  let quoted = false
  let encounteredCells = 0

  function appendValue({ trimCarriageReturn = false } = {}) {
    const safeValue = trimCarriageReturn ? value.replace(/\r$/, "") : value
    encounteredCells += 1
    assertSafeWorksheetCell(row.length, encounteredCells)
    assertSafeCellValue(safeValue)
    row.push(safeValue)
    value = ""
  }

  function appendRow() {
    assertSafeWorksheetRow(rows.length + 1, rows.length + 1)
    rows.push(row)
    row = []
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          value += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        value += char
        if (value.length > MAX_SPREADSHEET_CELL_CHARACTERS) {
          assertSafeCellValue(value)
        }
      }
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      appendValue()
    } else if (char === "\n") {
      appendValue({ trimCarriageReturn: true })
      appendRow()
    } else {
      value += char
      if (value.length > MAX_SPREADSHEET_CELL_CHARACTERS) {
        assertSafeCellValue(value)
      }
    }
  }

  if (quoted) {
    throw new Error("Format CSV tidak valid karena terdapat tanda kutip yang belum ditutup.")
  }

  if (value.length > 0 || row.length > 0) {
    appendValue({ trimCarriageReturn: true })
    appendRow()
  }

  return rows
}

function findZipEnd(view) {
  const minimumOffset = Math.max(0, view.byteLength - 65557)

  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_SIGNATURE) return offset
  }

  throw new Error("Struktur file XLSX tidak valid atau rusak.")
}

function readZipDirectory(buffer) {
  const view = new DataView(buffer)
  const endOffset = findZipEnd(view)
  const entryCount = view.getUint16(endOffset + 10, true)
  const centralOffset = view.getUint32(endOffset + 16, true)
  const decoder = new TextDecoder("utf-8")
  const entries = new Map()
  let offset = centralOffset

  assertSafeZipDirectory({
    bufferByteLength: buffer.byteLength,
    entryCount,
    centralOffset,
    endOffset,
  })

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > endOffset) {
      throw new Error("Direktori file XLSX terpotong atau tidak lengkap.")
    }

    if (view.getUint32(offset, true) !== ZIP_CENTRAL_FILE_SIGNATURE) {
      throw new Error("Direktori file XLSX tidak dapat dibaca.")
    }

    const flags = view.getUint16(offset + 8, true)
    const compressionMethod = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const fileNameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    const nextOffset = offset + 46 + fileNameLength + extraLength + commentLength

    if (nextOffset > endOffset) {
      throw new Error("Metadata entri file XLSX melewati batas direktori.")
    }

    assertSafeZipEntryMetadata({
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      bufferByteLength: buffer.byteLength,
    })

    const fileNameBytes = new Uint8Array(buffer, offset + 46, fileNameLength)
    const fileName = decoder.decode(fileNameBytes).replace(/\\/g, "/")

    if (entries.has(fileName)) {
      throw new Error("File XLSX memiliki nama entri internal yang duplikat.")
    }

    entries.set(fileName, {
      flags,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    })

    offset = nextOffset
  }

  return entries
}



async function readZipEntry(buffer, entries, fileName) {
  const entry = entries.get(fileName)
  if (!entry) return null

  if ((entry.flags & 0x1) !== 0) {
    throw new Error("File XLSX yang diproteksi kata sandi tidak dapat diproses.")
  }

  assertSafeZipEntryMetadata({
    compressedSize: entry.compressedSize,
    uncompressedSize: entry.uncompressedSize,
    localHeaderOffset: entry.localHeaderOffset,
    bufferByteLength: buffer.byteLength,
    maximumUncompressedBytes: MAX_XLSX_XML_ENTRY_BYTES,
  })

  const view = new DataView(buffer)
  const localOffset = entry.localHeaderOffset

  if (view.getUint32(localOffset, true) !== ZIP_LOCAL_FILE_SIGNATURE) {
    throw new Error("Data internal file XLSX tidak valid.")
  }

  const fileNameLength = view.getUint16(localOffset + 26, true)
  const extraLength = view.getUint16(localOffset + 28, true)
  const dataOffset = localOffset + 30 + fileNameLength + extraLength

  assertSafeZipDataRange({
    dataOffset,
    compressedSize: entry.compressedSize,
    bufferByteLength: buffer.byteLength,
  })

  const compressed = new Uint8Array(buffer, dataOffset, entry.compressedSize)
  let output

  if (entry.compressionMethod === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      throw new Error("Ukuran entri XLSX tanpa kompresi tidak konsisten.")
    }
    output = compressed.slice()
  } else if (entry.compressionMethod === 8) {
    output = await inflateRawWithLimit(compressed, MAX_XLSX_XML_ENTRY_BYTES)
  } else {
    throw new Error("Metode kompresi file XLSX tidak didukung.")
  }

  if (output.byteLength !== entry.uncompressedSize) {
    throw new Error("Ukuran hasil ekstraksi XLSX tidak sesuai metadata file.")
  }

  return output
}

function parseXml(xmlText, label) {
  const document = new DOMParser().parseFromString(xmlText, "application/xml")

  if (document.querySelector("parsererror")) {
    throw new Error(`${label} pada file XLSX tidak valid.`)
  }

  return document
}

function getElementsByLocalName(parent, localName) {
  return Array.from(parent.getElementsByTagNameNS("*", localName))
}

function resolveFirstWorksheetPath(workbookXml, relationshipsXml, entries) {
  if (workbookXml && relationshipsXml) {
    const workbook = parseXml(workbookXml, "Workbook")
    const relationships = parseXml(relationshipsXml, "Relasi workbook")
    const firstSheet = getElementsByLocalName(workbook, "sheet")[0]
    const relationshipId =
      firstSheet?.getAttribute("r:id") ||
      firstSheet?.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "id"
      )

    if (relationshipId) {
      const relationship = getElementsByLocalName(
        relationships,
        "Relationship"
      ).find((item) => item.getAttribute("Id") === relationshipId)
      const target = relationship?.getAttribute("Target") || ""

      if (target) {
        const normalizedTarget = target.startsWith("/")
          ? target.slice(1)
          : `xl/${target.replace(/^\.\//, "")}`

        if (entries.has(normalizedTarget)) return normalizedTarget
      }
    }
  }

  return (
    Array.from(entries.keys())
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
      .sort()[0] || null
  )
}

function parseSharedStrings(xmlText) {
  if (!xmlText) return []

  const document = parseXml(xmlText, "Shared strings")
  const items = getElementsByLocalName(document, "si")

  if (items.length > MAX_XLSX_SHARED_STRINGS) {
    throw new Error(
      `Shared strings terlalu banyak. Maksimal ${MAX_XLSX_SHARED_STRINGS} nilai.`
    )
  }

  return items.map((item) => {
    const value = getElementsByLocalName(item, "t")
      .map((textNode) => textNode.textContent || "")
      .join("")
    assertSafeCellValue(value)
    return value
  })
}

function columnReferenceToIndex(reference) {
  const letters = String(reference || "").match(/^[A-Z]+/i)?.[0] || "A"
  let index = 0

  for (const letter of letters.toUpperCase()) {
    index = index * 26 + letter.charCodeAt(0) - 64
  }

  return Math.max(0, index - 1)
}

function parseWorksheet(xmlText, sharedStrings) {
  const document = parseXml(xmlText, "Worksheet")
  const matrix = []
  const rowElements = getElementsByLocalName(document, "row")
  let encounteredCells = 0

  rowElements.forEach((rowElement, rowPosition) => {
    const declaredRow = Number(rowElement.getAttribute("r"))
    const rowNumber = Number.isSafeInteger(declaredRow) && declaredRow > 0
      ? declaredRow
      : rowPosition + 1

    assertSafeWorksheetRow(rowNumber, rowPosition + 1)

    const rowIndex = rowNumber - 1
    const row = matrix[rowIndex] || []

    getElementsByLocalName(rowElement, "c").forEach((cell) => {
      encounteredCells += 1
      const columnIndex = columnReferenceToIndex(cell.getAttribute("r"))
      assertSafeWorksheetCell(columnIndex, encounteredCells)

      const type = cell.getAttribute("t") || ""
      const valueNode = getElementsByLocalName(cell, "v")[0]
      let value = valueNode?.textContent || ""

      if (type === "s") {
        const sharedStringIndex = Number(value)
        if (
          !Number.isSafeInteger(sharedStringIndex) ||
          sharedStringIndex < 0 ||
          sharedStringIndex >= sharedStrings.length
        ) {
          throw new Error("Referensi shared string pada worksheet tidak valid.")
        }
        value = sharedStrings[sharedStringIndex]
      } else if (type === "inlineStr") {
        value = getElementsByLocalName(cell, "t")
          .map((item) => item.textContent || "")
          .join("")
      } else if (type === "b") {
        value = value === "1" ? "TRUE" : "FALSE"
      }

      assertSafeCellValue(value)
      row[columnIndex] = value
    })

    matrix[rowIndex] = row
  })

  return matrix
}

async function parseXlsx(buffer) {
  const entries = readZipDirectory(buffer)
  const workbookBytes = await readZipEntry(buffer, entries, "xl/workbook.xml")
  const relationshipsBytes = await readZipEntry(
    buffer,
    entries,
    "xl/_rels/workbook.xml.rels"
  )
  const worksheetPath = resolveFirstWorksheetPath(
    workbookBytes ? decodeUtf8(workbookBytes) : "",
    relationshipsBytes ? decodeUtf8(relationshipsBytes) : "",
    entries
  )

  if (!worksheetPath) {
    throw new Error("File XLSX tidak memiliki worksheet yang dapat dibaca.")
  }

  const [worksheetBytes, sharedStringBytes] = await Promise.all([
    readZipEntry(buffer, entries, worksheetPath),
    readZipEntry(buffer, entries, "xl/sharedStrings.xml"),
  ])

  if (!worksheetBytes) {
    throw new Error("Worksheet pertama pada file XLSX tidak dapat dibaca.")
  }

  const sharedStrings = parseSharedStrings(
    sharedStringBytes ? decodeUtf8(sharedStringBytes) : ""
  )

  return parseWorksheet(decodeUtf8(worksheetBytes), sharedStrings)
}

function findHeaderRow(matrix) {
  return matrix.findIndex((row) => {
    if (!Array.isArray(row)) return false

    const headers = new Set(
      row.map((value) => {
        const normalized = normalizeVehicleImportHeader(value)
        return HEADER_ALIASES.get(normalized) || normalized
      })
    )

    return VEHICLE_IMPORT_HEADERS.every((header) => headers.has(header))
  })
}

function matrixToVehicleRows(matrix) {
  const headerRowIndex = findHeaderRow(matrix)

  if (headerRowIndex < 0) {
    throw new Error(
      `Header tidak sesuai. Gunakan kolom: ${VEHICLE_IMPORT_HEADERS.join(", ")}.`
    )
  }

  const headerRow = matrix[headerRowIndex]
  const columnMap = new Map()

  headerRow.forEach((value, index) => {
    const normalized = normalizeVehicleImportHeader(value)
    const canonical = HEADER_ALIASES.get(normalized) || normalized
    if (VEHICLE_IMPORT_HEADERS.includes(canonical) && !columnMap.has(canonical)) {
      columnMap.set(canonical, index)
    }
  })

  const rows = []

  for (let rowIndex = headerRowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const sourceRow = matrix[rowIndex] || []
    if (isBlankRow(sourceRow)) continue

    const row = { _row_number: rowIndex + 1 }
    VEHICLE_IMPORT_HEADERS.forEach((header) => {
      row[header] = sourceRow[columnMap.get(header)] ?? ""
    })
    rows.push(row)
  }

  if (rows.length > MAX_VEHICLE_IMPORT_ROWS) {
    throw new Error(
      `Maksimal ${MAX_VEHICLE_IMPORT_ROWS} baris dalam satu kali upload.`
    )
  }

  return rows
}

export async function parseVehicleSpreadsheet(file) {
  if (!(file instanceof File)) {
    throw new Error("Pilih file kendaraan terlebih dahulu.")
  }

  if (file.size <= 0) {
    throw new Error("File yang dipilih kosong.")
  }

  if (file.size > MAX_VEHICLE_IMPORT_FILE_BYTES) {
    throw new Error("Ukuran file maksimal 5 MB.")
  }

  const extension = getFileExtension(file.name)

  if (![".xlsx", ".csv"].includes(extension)) {
    throw new Error("Format file harus XLSX atau CSV.")
  }

  let matrix

  if (extension === ".csv") {
    const text = (await file.text()).replace(/^\uFEFF/, "")
    matrix = parseCsv(text)
  } else {
    matrix = await parseXlsx(await file.arrayBuffer())
  }

  return matrixToVehicleRows(matrix)
}
