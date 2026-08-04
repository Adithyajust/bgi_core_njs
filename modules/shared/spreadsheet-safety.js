export const MAX_XLSX_XML_ENTRY_BYTES = 12 * 1024 * 1024
export const MAX_XLSX_ZIP_ENTRIES = 2048
export const MAX_XLSX_WORKSHEET_ROWS = 1000
export const MAX_XLSX_WORKSHEET_COLUMNS = 128
export const MAX_XLSX_WORKSHEET_CELLS = 12000
export const MAX_XLSX_SHARED_STRINGS = 20000
export const MAX_SPREADSHEET_CELL_CHARACTERS = 10000

export function assertSafeZipDirectory({
  bufferByteLength,
  entryCount,
  centralOffset,
  endOffset,
}) {
  if (!Number.isSafeInteger(entryCount) || entryCount < 0) {
    throw new Error("Jumlah entri file XLSX tidak valid.")
  }

  if (entryCount > MAX_XLSX_ZIP_ENTRIES) {
    throw new Error("File XLSX memiliki terlalu banyak entri internal.")
  }

  if (
    !Number.isSafeInteger(centralOffset) ||
    centralOffset < 0 ||
    centralOffset > endOffset ||
    endOffset > bufferByteLength
  ) {
    throw new Error("Direktori file XLSX berada di luar batas file.")
  }
}

export function assertSafeZipEntryMetadata({
  compressedSize,
  uncompressedSize,
  localHeaderOffset,
  bufferByteLength,
  maximumUncompressedBytes = MAX_XLSX_XML_ENTRY_BYTES,
}) {
  const numericValues = [compressedSize, uncompressedSize, localHeaderOffset]
  if (numericValues.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("Metadata entri file XLSX tidak valid.")
  }

  if ([compressedSize, uncompressedSize, localHeaderOffset].includes(0xffffffff)) {
    throw new Error("Format ZIP64 belum didukung. Simpan ulang file sebagai XLSX biasa.")
  }

  if (uncompressedSize > maximumUncompressedBytes) {
    throw new Error("Isi file XLSX terlalu besar untuk diproses.")
  }

  if (localHeaderOffset + 30 > bufferByteLength) {
    throw new Error("Header entri file XLSX berada di luar batas file.")
  }
}

export function assertSafeZipDataRange({ dataOffset, compressedSize, bufferByteLength }) {
  if (
    !Number.isSafeInteger(dataOffset) ||
    dataOffset < 0 ||
    !Number.isSafeInteger(compressedSize) ||
    compressedSize < 0 ||
    dataOffset + compressedSize > bufferByteLength
  ) {
    throw new Error("Data entri file XLSX berada di luar batas file.")
  }
}

export async function inflateRawWithLimit(bytes, maximumBytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "Browser ini belum mendukung pembacaan XLSX. Gunakan Chrome/Edge terbaru atau upload file CSV."
    )
  }

  const stream = new Blob([bytes]).stream().pipeThrough(
    new DecompressionStream("deflate-raw")
  )
  const reader = stream.getReader()
  const chunks = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) continue

      totalBytes += value.byteLength
      if (totalBytes > maximumBytes) {
        await reader.cancel("decompressed entry too large")
        throw new Error("Isi file XLSX terlalu besar untuk diproses.")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const output = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

export function assertSafeWorksheetRow(rowNumber, encounteredRows) {
  if (
    !Number.isSafeInteger(rowNumber) ||
    rowNumber <= 0 ||
    rowNumber > MAX_XLSX_WORKSHEET_ROWS ||
    encounteredRows > MAX_XLSX_WORKSHEET_ROWS
  ) {
    throw new Error(
      `Worksheet terlalu besar. Maksimal ${MAX_XLSX_WORKSHEET_ROWS} baris yang dapat dibaca.`
    )
  }
}

export function assertSafeWorksheetCell(columnIndex, encounteredCells) {
  if (
    !Number.isSafeInteger(columnIndex) ||
    columnIndex < 0 ||
    columnIndex >= MAX_XLSX_WORKSHEET_COLUMNS ||
    encounteredCells > MAX_XLSX_WORKSHEET_CELLS
  ) {
    throw new Error(
      `Worksheet terlalu lebar atau padat. Maksimal ${MAX_XLSX_WORKSHEET_COLUMNS} kolom dan ${MAX_XLSX_WORKSHEET_CELLS} sel.`
    )
  }
}

export function assertSafeCellValue(value) {
  if (String(value ?? "").length > MAX_SPREADSHEET_CELL_CHARACTERS) {
    throw new Error(
      `Nilai satu sel terlalu panjang. Maksimal ${MAX_SPREADSHEET_CELL_CHARACTERS} karakter.`
    )
  }
}
