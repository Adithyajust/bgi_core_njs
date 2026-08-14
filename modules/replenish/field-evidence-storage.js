import "server-only"

import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

export const FIELD_EVIDENCE_MAX_BYTES = 3 * 1024 * 1024

const IMAGE_TYPES = Object.freeze({
  "image/jpeg": {
    extension: "jpg",
    valid: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  },
  "image/png": {
    extension: "png",
    valid: (buffer) => {
      const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      return buffer.length >= signature.length && signature.every((byte, index) => buffer[index] === byte)
    },
  },
  "image/webp": {
    extension: "webp",
    valid: (buffer) => buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP",
  },
})

function storageDirectory() {
  return path.join(process.cwd(), "storage", "private", "replenish", "field-evidence")
}

export function isSafeFieldEvidenceFileName(fileName) {
  return typeof fileName === "string"
    && /^[a-f0-9-]+\.(jpg|png|webp)$/i.test(fileName)
    && path.basename(fileName) === fileName
}

export function prepareFieldEvidence(evidence) {
  const dataUrl = typeof evidence?.dataUrl === "string" ? evidence.dataUrl.trim() : ""
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=\s]+)$/.exec(dataUrl)
  if (!match) return { error: "Foto bukti wajib berformat JPG, PNG, atau WebP.", data: null }

  const type = IMAGE_TYPES[match[1]]
  let buffer
  try {
    buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64")
  } catch {
    return { error: "Data foto bukti tidak valid.", data: null }
  }

  if (!buffer.length || buffer.length > FIELD_EVIDENCE_MAX_BYTES) {
    return { error: "Ukuran foto bukti wajib antara 1 byte dan 3 MB.", data: null }
  }
  if (!type.valid(buffer)) {
    return { error: "Isi foto bukti tidak sesuai dengan format gambarnya.", data: null }
  }

  return {
    error: null,
    data: {
      buffer,
      extension: type.extension,
      mimeType: match[1],
      size: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      originalName: String(evidence?.fileName || "bukti-lapangan").trim().slice(0, 255),
    },
  }
}

export async function saveFieldEvidence(prepared) {
  const directory = storageDirectory()
  await mkdir(directory, { recursive: true, mode: 0o750 })
  const fileName = `${randomUUID()}.${prepared.extension}`
  await writeFile(path.join(directory, fileName), prepared.buffer, { flag: "wx", mode: 0o640 })
  return fileName
}

export async function readFieldEvidence(fileName) {
  if (!isSafeFieldEvidenceFileName(fileName)) throw new Error("Nama file bukti tidak valid.")
  return readFile(path.join(storageDirectory(), fileName))
}

export async function deleteFieldEvidence(fileName) {
  if (!isSafeFieldEvidenceFileName(fileName)) return false
  try {
    await unlink(path.join(storageDirectory(), fileName))
    return true
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}
