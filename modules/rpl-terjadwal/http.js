import { NextResponse } from "next/server"
import { authorizeApiRequest, isSuperAdmin } from "@/lib/access-control"
import { MAX_FILE_BYTES, UploadError } from "./workbook.js"

export const json = (data, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } })

export async function authorize(request, action) {
  const auth = await authorizeApiRequest(request, "/rpl_terjadwal", action)
  if (!auth.authorized) return auth
  if (!isSuperAdmin(auth.user)) return { authorized: false, response: json({ success: false, message: "RPL Terjadwal hanya untuk Super Admin." }, 403) }
  return auth
}
export function errorResponse(error) {
  if (error instanceof UploadError) return json({ success: false, message: error.message }, error.status)
  const number = error?.number ?? error?.originalError?.info?.number
  if ([2601, 2627].includes(number)) return json({ success: false, message: "File yang sama sudah tersimpan untuk periode dan unit pelaporan ini. Pilih hasilnya dari riwayat." }, 409)
  if ([207, 208].includes(number)) return json({ success: false, message: "Struktur database RPL Terjadwal belum diperbarui. Jalankan npm run db:migrate hingga migrasi 057." }, 503)
  console.error("RPL upload error:", error)
  return json({ success: false, message: "Proses RPL Terjadwal gagal. Coba lagi atau hubungi administrator." }, 500)
}
export async function readBytes(request, limit = MAX_FILE_BYTES) {
  if (Number(request.headers.get("content-length")) > limit) throw new UploadError("Ukuran data melebihi batas yang diizinkan.", 413)
  if (!request.body) throw new UploadError("Pilih file Excel.")
  const reader = request.body.getReader(); const chunks = []; let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) { await reader.cancel(); throw new UploadError("Ukuran data melebihi batas yang diizinkan.", 413) }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks, length)
}

