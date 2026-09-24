import { deflateRawSync } from "node:zlib"

// Minimal in-memory XLSX inputs for parser/API tests, never delivered as templates.
export function xlsxFixture(sheets) {
  const files = {
    "xl/workbook.xml": `<workbook><sheets>${Object.keys(sheets).map((name, i) => `<sheet name="${name}" r:id="rId${i}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships>${Object.keys(sheets).map((_, i) => `<Relationship Id="rId${i}" Target="worksheets/sheet${i}.xml"/>`).join("")}</Relationships>`,
  }
  const escape = v => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  Object.values(sheets).forEach((rows, i) => {
    files[`xl/worksheets/sheet${i}.xml`] = `<worksheet><sheetData>${rows.map((values, r) => `<row r="${r + 1}">${values.map((v, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`
  })
  const chunks = [], entries = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const bytes = Buffer.from(text), compressed = deflateRawSync(bytes), n = Buffer.from(name)
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(n.length, 26)
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(8, 10); entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(n.length, 28); entry.writeUInt32LE(offset, 42)
    chunks.push(local, n, compressed); entries.push(entry, n); offset += local.length + n.length + compressed.length
  }
  const directory = Buffer.concat(entries), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length / 2, 8); end.writeUInt16LE(entries.length / 2, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, directory, end])
}
