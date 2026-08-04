function bytesToHex(bytes) {
  if (!Array.isArray(bytes) || bytes.length !== 8) {
    return ""
  }

  const normalizedBytes = []

  for (const value of bytes) {
    const byte = Number(value)

    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      return ""
    }

    normalizedBytes.push(byte.toString(16).padStart(2, "0"))
  }

  return `0x${normalizedBytes.join("").toUpperCase()}`
}

function normalizeHexString(value) {
  const normalized = value.trim().replace(/^["']|["']$/g, "")
  const hexValue = normalized.startsWith("0x") || normalized.startsWith("0X")
    ? normalized.slice(2)
    : normalized

  return /^[0-9a-fA-F]{16}$/.test(hexValue)
    ? `0x${hexValue.toUpperCase()}`
    : ""
}

export function normalizeRowVersionToken(value) {
  if (typeof value === "string") {
    return normalizeHexString(value)
  }

  if (Array.isArray(value)) {
    return bytesToHex(value)
  }

  if (value && typeof value === "object") {
    if (Array.isArray(value.data)) {
      return bytesToHex(value.data)
    }

    if (typeof value.value === "string") {
      return normalizeHexString(value.value)
    }

    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value)) {
      return bytesToHex(Array.from(value))
    }
  }

  return ""
}

export function getRowVersionToken(record) {
  if (!record || typeof record !== "object") {
    return ""
  }

  const candidates = [
    record.row_version,
    record.rowVersion,
    record.row_version_hex,
    record.version_token,
    record.version?.row_version,
  ]

  for (const candidate of candidates) {
    const token = normalizeRowVersionToken(candidate)

    if (token) {
      return token
    }
  }

  return ""
}
