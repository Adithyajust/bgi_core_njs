import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

const PRIVATE_PDF_DIRECTORY = path.join(
  process.cwd(),
  "storage",
  "private",
  "replenish",
  "surat-tugas"
)

function normalizeWorkOrderId(value) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("ID work order PDF tidak valid.")
  return id
}

function fileStem(workOrderId) {
  return `work-order-${normalizeWorkOrderId(workOrderId)}`
}

export function getAssignmentLetterPdfPaths(workOrderId) {
  const stem = fileStem(workOrderId)
  return {
    directory: PRIVATE_PDF_DIRECTORY,
    pdfPath: path.join(PRIVATE_PDF_DIRECTORY, `${stem}.pdf`),
    metadataPath: path.join(PRIVATE_PDF_DIRECTORY, `${stem}.json`),
  }
}

function normalizeMetadata(metadata, expectedWorkOrderId) {
  if (!metadata || typeof metadata !== "object") return null
  const workOrderId = normalizeWorkOrderId(expectedWorkOrderId)
  if (Number(metadata.work_order_id) !== workOrderId) return null
  if (!/^[0-9a-f]{64}$/i.test(String(metadata.document_hash || ""))) return null
  if (!/^[0-9a-f]{64}$/i.test(String(metadata.pdf_hash || ""))) return null
  return {
    schema_version: 1,
    work_order_id: workOrderId,
    letter_no: String(metadata.letter_no || "").trim(),
    codeuker: String(metadata.codeuker || "").trim().toUpperCase(),
    document_hash: String(metadata.document_hash).toLowerCase(),
    pdf_hash: String(metadata.pdf_hash).toLowerCase(),
    generated_at: String(metadata.generated_at || ""),
    generated_by: Number(metadata.generated_by) || null,
    file_name: `${fileStem(workOrderId)}.pdf`,
  }
}

export async function readStoredAssignmentLetterPdf(workOrderId, { includeBuffer = false } = {}) {
  const paths = getAssignmentLetterPdfPaths(workOrderId)
  try {
    const [rawMetadata, stat] = await Promise.all([
      fs.readFile(paths.metadataPath, "utf8"),
      fs.stat(paths.pdfPath),
    ])
    if (!stat.isFile() || stat.size < 100) return null
    const metadata = normalizeMetadata(JSON.parse(rawMetadata), workOrderId)
    if (!metadata) return null
    return {
      ...metadata,
      size: stat.size,
      buffer: includeBuffer ? await fs.readFile(paths.pdfPath) : null,
    }
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null
    throw error
  }
}

export async function writeStoredAssignmentLetterPdf(workOrderId, pdfBuffer, metadata, { overwrite = false } = {}) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length < 100 || !pdfBuffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error("Buffer PDF Surat Tugas tidak valid.")
  }

  const existing = await readStoredAssignmentLetterPdf(workOrderId)
  if (existing && (!overwrite || existing.document_hash === String(metadata?.document_hash || "").toLowerCase())) {
    return existing
  }

  const paths = getAssignmentLetterPdfPaths(workOrderId)
  await fs.mkdir(paths.directory, { recursive: true })

  const token = `${process.pid}-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`
  const temporaryPdfPath = `${paths.pdfPath}.${token}.tmp`
  const temporaryMetadataPath = `${paths.metadataPath}.${token}.tmp`
  const normalized = normalizeMetadata({ ...metadata, work_order_id: workOrderId }, workOrderId)
  if (!normalized) throw new Error("Metadata PDF Surat Tugas tidak valid.")

  try {
    await fs.writeFile(temporaryPdfPath, pdfBuffer, { flag: "wx" })
    await fs.writeFile(temporaryMetadataPath, `${JSON.stringify(normalized, null, 2)}\n`, { flag: "wx" })

    async function moveIntoPlace(source, target) {
      try {
        await fs.rename(source, target)
      } catch (error) {
        if (!overwrite || !["EEXIST", "EPERM"].includes(error?.code)) throw error
        await fs.rm(target, { force: true })
        await fs.rename(source, target)
      }
    }

    await moveIntoPlace(temporaryPdfPath, paths.pdfPath)
    await moveIntoPlace(temporaryMetadataPath, paths.metadataPath)
  } finally {
    await Promise.allSettled([
      fs.unlink(temporaryPdfPath),
      fs.unlink(temporaryMetadataPath),
    ])
  }

  const stored = await readStoredAssignmentLetterPdf(workOrderId)
  if (!stored) throw new Error("File PDF Surat Tugas gagal disimpan secara atomik.")
  return stored
}

export function canAccessStoredAssignmentLetterPdf(metadata, scope) {
  if (!metadata || !scope) return false
  if (scope.isSuperAdmin) return true
  return Boolean(scope.codeUker) && metadata.codeuker === String(scope.codeUker).trim().toUpperCase()
}
