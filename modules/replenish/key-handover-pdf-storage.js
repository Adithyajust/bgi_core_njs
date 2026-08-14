import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

const PRIVATE_PDF_DIRECTORY = path.join(
  process.cwd(),
  "storage",
  "private",
  "replenish",
  "key-handover"
)

function normalizeWorkOrderId(value) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("ID work order PDF Serah Terima Kunci tidak valid.")
  return id
}

function fileStem(workOrderId) {
  return `work-order-${normalizeWorkOrderId(workOrderId)}`
}

export function getKeyHandoverPdfPaths(workOrderId) {
  const stem = fileStem(workOrderId)
  return {
    directory: PRIVATE_PDF_DIRECTORY,
    pdfPath: path.join(PRIVATE_PDF_DIRECTORY, `${stem}.pdf`),
    metadataPath: path.join(PRIVATE_PDF_DIRECTORY, `${stem}.json`),
  }
}

function normalizeTemplateVersion(value) {
  const version = Number(value)
  return Number.isSafeInteger(version) && version > 0 ? version : 1
}

function normalizeMetadata(metadata, expectedWorkOrderId) {
  if (!metadata || typeof metadata !== "object") return null
  const workOrderId = normalizeWorkOrderId(expectedWorkOrderId)
  if (Number(metadata.work_order_id) !== workOrderId) return null
  if (!/^[0-9a-f]{64}$/i.test(String(metadata.document_hash || ""))) return null
  if (!/^[0-9a-f]{64}$/i.test(String(metadata.pdf_hash || ""))) return null
  return {
    schema_version: 1,
    template_version: normalizeTemplateVersion(metadata.template_version),
    work_order_id: workOrderId,
    receipt_no: String(metadata.receipt_no || "").trim(),
    codeuker: String(metadata.codeuker || "").trim().toUpperCase(),
    owner_user_id: Number(metadata.owner_user_id) || null,
    document_hash: String(metadata.document_hash).toLowerCase(),
    pdf_hash: String(metadata.pdf_hash).toLowerCase(),
    generated_at: String(metadata.generated_at || ""),
    generated_by: Number(metadata.generated_by) || null,
    file_name: `${fileStem(workOrderId)}.pdf`,
  }
}

export async function readStoredKeyHandoverPdf(workOrderId, { includeBuffer = false } = {}) {
  const paths = getKeyHandoverPdfPaths(workOrderId)
  try {
    const [rawMetadata, stat] = await Promise.all([
      fs.readFile(paths.metadataPath, "utf8"),
      fs.stat(paths.pdfPath),
    ])
    if (!stat.isFile() || stat.size < 100) return null
    const metadata = normalizeMetadata(JSON.parse(rawMetadata), workOrderId)
    if (!metadata) return null

    const buffer = includeBuffer ? await fs.readFile(paths.pdfPath) : null
    if (buffer) {
      const actualHash = crypto.createHash("sha256").update(buffer).digest("hex")
      if (actualHash !== metadata.pdf_hash) {
        const integrityError = new Error("Integritas file PDF Serah Terima Kunci tidak valid.")
        integrityError.code = "KEY_HANDOVER_PDF_INTEGRITY"
        throw integrityError
      }
    }

    return { ...metadata, size: stat.size, buffer }
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null
    throw error
  }
}

export async function writeStoredKeyHandoverPdf(
  workOrderId,
  pdfBuffer,
  metadata,
  { replaceTemplate = false, replaceDocumentForTemplateUpgrade = false } = {}
) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length < 100 || !pdfBuffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error("Buffer PDF Serah Terima Kunci tidak valid.")
  }

  const existing = await readStoredKeyHandoverPdf(workOrderId)
  const incomingHash = String(metadata?.document_hash || "").toLowerCase()
  const incomingTemplateVersion = normalizeTemplateVersion(metadata?.template_version)
  if (existing) {
    // Snapshot bisnis tetap immutable. Penggantian hanya diizinkan bila hash snapshot
    // sama dan versi template cetakan memang dinaikkan.
    const validTemplateUpgrade = Boolean(
      replaceTemplate
      && replaceDocumentForTemplateUpgrade
      && existing.template_version < incomingTemplateVersion
    )
    if (existing.document_hash !== incomingHash && !validTemplateUpgrade) {
      const staleError = new Error("PDF Serah Terima Kunci yang tersimpan tidak cocok dengan snapshot saat ini.")
      staleError.code = "KEY_HANDOVER_PDF_IMMUTABLE_MISMATCH"
      throw staleError
    }
    if (!replaceTemplate || existing.template_version >= incomingTemplateVersion) return existing
  }

  const normalized = normalizeMetadata({ ...metadata, work_order_id: workOrderId }, workOrderId)
  if (!normalized) throw new Error("Metadata PDF Serah Terima Kunci tidak valid.")

  const paths = getKeyHandoverPdfPaths(workOrderId)
  await fs.mkdir(paths.directory, { recursive: true })
  const token = `${process.pid}-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`
  const temporaryPdfPath = `${paths.pdfPath}.${token}.tmp`
  const temporaryMetadataPath = `${paths.metadataPath}.${token}.tmp`
  const backupPdfPath = `${paths.pdfPath}.${token}.bak`
  const backupMetadataPath = `${paths.metadataPath}.${token}.bak`
  const replacingExisting = Boolean(
    existing
    && replaceTemplate
    && existing.template_version < incomingTemplateVersion
  )
  let pdfBackedUp = false
  let metadataBackedUp = false
  let pdfInstalled = false
  let metadataInstalled = false

  try {
    await fs.writeFile(temporaryPdfPath, pdfBuffer, { flag: "wx" })
    await fs.writeFile(temporaryMetadataPath, `${JSON.stringify(normalized, null, 2)}\n`, { flag: "wx" })

    // Windows tidak mengizinkan fs.rename() menimpa file tujuan yang sudah ada.
    // Pindahkan pasangan lama ke backup, pasang pasangan baru, dan pulihkan
    // keduanya jika salah satu operasi pemasangan gagal.
    if (replacingExisting) {
      await fs.rename(paths.pdfPath, backupPdfPath)
      pdfBackedUp = true
      await fs.rename(paths.metadataPath, backupMetadataPath)
      metadataBackedUp = true
    }

    try {
      await fs.rename(temporaryPdfPath, paths.pdfPath)
      pdfInstalled = true
      await fs.rename(temporaryMetadataPath, paths.metadataPath)
      metadataInstalled = true
    } catch (error) {
      if (!replacingExisting && error?.code === "EEXIST") {
        return existing || readStoredKeyHandoverPdf(workOrderId)
      }
      throw error
    }
  } catch (error) {
    if (metadataInstalled) await fs.unlink(paths.metadataPath).catch(() => {})
    if (pdfInstalled) await fs.unlink(paths.pdfPath).catch(() => {})
    if (metadataBackedUp) await fs.rename(backupMetadataPath, paths.metadataPath).catch(() => {})
    if (pdfBackedUp) await fs.rename(backupPdfPath, paths.pdfPath).catch(() => {})
    throw error
  } finally {
    await Promise.allSettled([
      fs.unlink(temporaryPdfPath),
      fs.unlink(temporaryMetadataPath),
      fs.unlink(backupPdfPath),
      fs.unlink(backupMetadataPath),
    ])
  }

  const stored = await readStoredKeyHandoverPdf(workOrderId, { includeBuffer: true })
  if (!stored) throw new Error("File PDF Serah Terima Kunci gagal disimpan secara atomik.")
  return { ...stored, buffer: null }
}

export function canAccessStoredKeyHandoverPdf(metadata, scope) {
  if (!metadata || !scope) return false
  if (scope.isSuperAdmin) return true
  return Boolean(scope.codeUker) && metadata.codeuker === String(scope.codeUker).trim().toUpperCase()
}
