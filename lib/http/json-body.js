export class RequestBodyTooLargeError extends Error {
  constructor(maxBytes) {
    super(`Ukuran request melebihi batas ${maxBytes} byte.`)
    this.name = "RequestBodyTooLargeError"
    this.code = "REQUEST_BODY_TOO_LARGE"
    this.maxBytes = maxBytes
  }
}

export class InvalidJsonBodyError extends Error {
  constructor(message = "Format JSON tidak valid.") {
    super(message)
    this.name = "InvalidJsonBodyError"
    this.code = "INVALID_JSON_BODY"
  }
}

function normalizeByteLimit(value) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError("Batas ukuran request harus berupa bilangan bulat positif.")
  }
  return parsed
}

function parseContentLength(request) {
  const raw = request.headers.get("content-length")
  if (!raw) return null

  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

async function readRequestBytes(request, maxBytes) {
  const contentLength = parseContentLength(request)
  if (contentLength !== null && contentLength > maxBytes) {
    throw new RequestBodyTooLargeError(maxBytes)
  }

  if (!request.body) return new Uint8Array(0)

  const reader = request.body.getReader()
  const chunks = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      if (!(value instanceof Uint8Array)) continue
      totalBytes += value.byteLength

      if (totalBytes > maxBytes) {
        await reader.cancel("request body too large")
        throw new RequestBodyTooLargeError(maxBytes)
      }

      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return body
}

export async function readJsonBody(request, { maxBytes }) {
  const safeMaxBytes = normalizeByteLimit(maxBytes)
  const bytes = await readRequestBytes(request, safeMaxBytes)

  if (bytes.byteLength === 0) {
    throw new InvalidJsonBodyError("Body request JSON tidak boleh kosong.")
  }

  let text
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new InvalidJsonBodyError("Encoding body request harus UTF-8 yang valid.")
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new InvalidJsonBodyError()
  }
}
