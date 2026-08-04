import { randomUUID } from "node:crypto"
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

export const PEGAWAI_PHOTO_MAX_BYTES = 2 * 1024 * 1024
export const PEGAWAI_PHOTO_PRIVATE_PREFIX = "/api/masters/pegawai/photo/"

const PHOTO_TYPES = {
  "image/jpeg": {
    extension: "jpg",
    isValid(buffer) {
      return (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
      )
    },
  },
  "image/png": {
    extension: "png",
    isValid(buffer) {
      const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      return (
        buffer.length >= signature.length &&
        signature.every((byte, index) => buffer[index] === byte)
      )
    },
  },
  "image/webp": {
    extension: "webp",
    isValid(buffer) {
      return (
        buffer.length >= 12 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP"
      )
    },
  },
}

const MIME_BY_EXTENSION = Object.freeze({
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
})

function getStorageDirectory() {
  const configuredDirectory = process.env.PEGAWAI_PHOTO_STORAGE_DIR
  return configuredDirectory
    ? path.resolve(configuredDirectory)
    : path.join(process.cwd(), "storage", "private", "pegawai")
}

function sanitizeFileStem(value) {
  const normalized = String(value || "pegawai")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)

  return normalized || "pegawai"
}

function isFileLike(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.arrayBuffer === "function" &&
    typeof value.size === "number"
  )
}

export function isSafePegawaiPhotoFileName(fileName) {
  return (
    typeof fileName === "string" &&
    /^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(fileName) &&
    path.basename(fileName) === fileName
  )
}

export function getPegawaiPhotoPath(fileName) {
  if (!isSafePegawaiPhotoFileName(fileName)) {
    throw new Error("Nama file foto pegawai tidak valid.")
  }

  return path.join(getStorageDirectory(), fileName)
}

export function getPegawaiPhotoMimeType(fileName) {
  return MIME_BY_EXTENSION[path.extname(fileName).toLowerCase()] || null
}

export async function readManagedPegawaiPhoto(fileName) {
  return readFile(getPegawaiPhotoPath(fileName))
}

export async function preparePegawaiPhoto(file) {
  if (!isFileLike(file) || file.size === 0) {
    return { error: null, data: null }
  }

  if (file.size > PEGAWAI_PHOTO_MAX_BYTES) {
    return { error: "Ukuran foto maksimal 2 MB.", data: null }
  }

  const photoType = PHOTO_TYPES[file.type]
  if (!photoType) {
    return { error: "Format foto harus JPG, PNG, atau WebP.", data: null }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (!photoType.isValid(buffer)) {
    return {
      error: "Isi file foto tidak sesuai dengan format gambar yang dipilih.",
      data: null,
    }
  }

  return {
    error: null,
    data: {
      buffer,
      extension: photoType.extension,
      originalName: String(file.name || "foto"),
      mimeType: file.type,
      size: file.size,
    },
  }
}

export async function savePreparedPegawaiPhoto(preparedPhoto, nip) {
  if (!preparedPhoto) return null

  const storageDirectory = getStorageDirectory()
  await mkdir(storageDirectory, { recursive: true, mode: 0o750 })

  const fileName = `${sanitizeFileStem(nip)}-${Date.now()}-${randomUUID().slice(0, 12)}.${preparedPhoto.extension}`
  const absolutePath = getPegawaiPhotoPath(fileName)

  await writeFile(absolutePath, preparedPhoto.buffer, {
    flag: "wx",
    mode: 0o640,
  })

  return `${PEGAWAI_PHOTO_PRIVATE_PREFIX}${fileName}`
}

export function isManagedPegawaiPhoto(photoPath) {
  if (
    typeof photoPath !== "string" ||
    !photoPath.startsWith(PEGAWAI_PHOTO_PRIVATE_PREFIX)
  ) {
    return false
  }

  const fileName = photoPath.slice(PEGAWAI_PHOTO_PRIVATE_PREFIX.length)
  return isSafePegawaiPhotoFileName(fileName)
}

export async function deleteManagedPegawaiPhoto(photoPath) {
  if (!isManagedPegawaiPhoto(photoPath)) return false

  const fileName = photoPath.slice(PEGAWAI_PHOTO_PRIVATE_PREFIX.length)

  try {
    await unlink(getPegawaiPhotoPath(fileName))
    return true
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}
