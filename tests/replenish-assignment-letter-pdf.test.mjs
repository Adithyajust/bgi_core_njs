import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

import { generateAssignmentLetterPdf, hashPdfBuffer } from "../modules/replenish/assignment-letter-pdf.js"

const pdfRoutePath = new URL("../app/api/transactions/replenish/[id]/surat-tugas/pdf/route.js", import.meta.url)
const pagePath = new URL("../app/transactions/replenish/[id]/surat-tugas/page.jsx", import.meta.url)
const storagePath = new URL("../modules/replenish/assignment-letter-pdf-storage.js", import.meta.url)
const proxyPath = new URL("../proxy.js", import.meta.url)

function fixtureLetter() {
  return {
    status: "DISETUJUI",
    payload_valid: true,
    approval_valid: true,
    document_hash: "a".repeat(64),
    approved_by_name: "APPROVER TEST",
    approved_by_nip: "10001",
    approved_by_position: "Operation Manager",
    approved_at: "2026-08-06T10:30:00",
    payload: {
      letter_no: "ST-RPL-2026-000001",
      work_order: {
        number: "RPL-2026-000001",
        unit: { code: "0001", name: "Unit Test" },
        schedule_date: "2026-08-07",
        departure_time: "08:00",
        estimated_finish_time: "17:00",
        vehicle: { label: "B 1234 TEST" },
        priority: "NORMAL",
        total_requested_amount: 200000000,
        escort_name: "Petugas Pengawalan",
        route_notes: null,
        notes: null,
      },
      team: [
        { employee_id: 1, name: "CUSTODY TEST", nip: "20001", position: "Custody", role: "CUSTODY" },
      ],
      points: [
        {
          sequence_no: 1,
          machine_id: 1,
          tid: "TID0001",
          serial_number: "SN0001",
          location: "Lokasi Pengujian",
          activity_type: "NORMAL",
          pagu: 2000,
          denomination: 100000,
          required_cassettes: 4,
          requested_amount: 200000000,
        },
      ],
    },
  }
}

test("generator lokal membentuk PDF A4 valid tanpa dependency PDF eksternal", async () => {
  const buffer = await generateAssignmentLetterPdf({
    letter: fixtureLetter(),
    verificationUrl: "https://internal.example/transactions/replenish/surat-tugas/verify/123e4567-e89b-42d3-a456-426614174000",
    logoPath: "/file/logo/tidak-tersedia.jpg",
  })
  assert.ok(Buffer.isBuffer(buffer))
  assert.equal(buffer.subarray(0, 8).toString("binary"), "%PDF-1.4")
  assert.match(buffer.subarray(-32).toString("binary"), /%%EOF/)
  assert.ok(buffer.length > 2000)
  assert.match(hashPdfBuffer(buffer), /^[0-9a-f]{64}$/)
})

test("generator lokal dapat mencetak Surat Tugas persiapan sebelum approval tanpa QR", async () => {
  const letter = fixtureLetter()
  letter.status = "MENUNGGU_PERSETUJUAN"
  letter.approval_valid = null
  letter.approved_by_name = null
  letter.approved_at = null

  const buffer = await generateAssignmentLetterPdf({
    letter,
    verificationUrl: null,
    logoPath: "/file/logo/tidak-tersedia.jpg",
  })

  assert.ok(Buffer.isBuffer(buffer))
  assert.equal(buffer.subarray(0, 8).toString("binary"), "%PDF-1.4")
  assert.match(buffer.subarray(-32).toString("binary"), /%%EOF/)
})


test("endpoint PDF mencocokkan storage dengan snapshot aktif dan status konfirmasi cetak", async () => {
  const source = await fs.readFile(pdfRoutePath, "utf8")
  assert.match(source, /readStoredAssignmentLetterPdf/)
  assert.match(source, /includeBuffer: !statusOnly/)
  assert.match(source, /Content-Type": "application\/pdf"/)
  assert.match(source, /Accept-Ranges": "bytes"/)
  assert.match(source, /status: 206/)
  assert.match(source, /Content-Range/)
  assert.match(source, /parsePdfRange/)
  assert.match(source, /writeStoredAssignmentLetterPdf/)
  assert.match(source, /generateAssignmentLetterPdf/)
  assert.match(source, /getAssignmentLetterByWorkOrder/)
  assert.match(source, /GENERATE_PDF/)

  const getStart = source.indexOf("export async function GET")
  const postStart = source.indexOf("export async function POST")
  const getSource = source.slice(getStart, postStart)
  assert.match(getSource, /connectDB/)
  assert.match(getSource, /getAssignmentLetterByWorkOrder/)
  assert.match(getSource, /document_hash/)
  assert.match(source, /PRINT_CONFIRMED/)
  assert.match(source, /work_order_created_by/)
  assert.match(source, /can_prepare/)
  assert.match(source, /tugas Admin CRO pembuat Work Order/i)
  assert.match(source, /Konfirmasi cetak Surat Tugas hanya dapat dilakukan oleh Admin CRO pembuat Work Order/i)
})

test("halaman mengecek PDF tersimpan sebelum mengambil data Surat Tugas dari database", async () => {
  const source = await fs.readFile(pagePath, "utf8")
  const statusCheck = source.indexOf("surat-tugas/pdf?status=1")
  const databaseLoad = source.indexOf("`/api/transactions/replenish/${workOrderId}/surat-tugas`")
  assert.ok(statusCheck >= 0)
  assert.ok(databaseLoad > statusCheck)
  assert.match(source, /setStoredPdf\(storedResult\.data\)/)
  assert.match(source, /assignment-letter-pdf-viewer/)
  assert.match(source, /<iframe/)
  assert.doesNotMatch(source, /<object/)
  assert.match(source, /Bentuk PDF & Cetak/)
  assert.match(source, /Cetak Surat Tugas/)
  assert.match(source, /Konfirmasi Sudah Dicetak/)
  assert.match(source, /canPrepareDocument/)
  assert.match(source, /Manager Operasional \/ Asisten Manager CRO/)
  assert.doesNotMatch(source, /window\.print\(\)/)
})

test("storage PDF memakai nama deterministik per work order dan sidecar metadata untuk scope", async () => {
  const source = await fs.readFile(storagePath, "utf8")
  assert.match(source, /storage["',\s\n]+private["',\s\n]+replenish["',\s\n]+surat-tugas/)
  assert.match(source, /work-order-\$\{normalizeWorkOrderId\(workOrderId\)\}/)
  assert.match(source, /codeuker/)
  assert.match(source, /document_hash/)
  assert.match(source, /pdf_hash/)
  assert.match(source, /canAccessStoredAssignmentLetterPdf/)
})


test("proxy hanya mengizinkan iframe same-origin untuk endpoint PDF Surat Tugas", async () => {
  const source = await fs.readFile(proxyPath, "utf8")
  assert.match(source, /isReplenishPdfRoute/)
  assert.match(source, /frame-src 'self'/)
  assert.match(source, /allowSameOriginFrame \? "object-src 'self'" : "object-src 'none'"/)
  assert.match(source, /allowSameOriginFrame \? "frame-ancestors 'self'" : "frame-ancestors 'none'"/)
  assert.match(source, /allowSameOriginFrame \? "SAMEORIGIN" : "DENY"/)
  assert.match(source, /\(\?:surat-tugas\|key-handover\)\\\/pdf/)
})
