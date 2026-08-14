import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

import {
  createKeyHandoverApprovalHash,
  createKeyHandoverDocumentPayload,
  generateKeyHandoverPdf,
  hashKeyHandoverDocument,
  hashKeyHandoverPdfBuffer,
} from "../modules/replenish/key-handover-pdf.js"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

function sampleHandover() {
  return {
    id: 77,
    work_order_no: "WO-RPL-000077",
    status: "DISETUJUI",
    created_by: 10,
    created_by_name: "Admin CRO",
    codeuker: "0001",
    nama_uker: "Unit Kerja Test",
    schedule_date: "2026-08-09",
    departure_time: "08:00",
    handover_id: 88,
    receipt_no: "STK-WO-RPL-000077",
    verified_at: "2026-08-09T08:15:00",
    verified_by: 10,
    verified_by_name: "Admin CRO",
    verification_token: "123e4567-e89b-42d3-a456-426614174000",
    handover_approved_at: "2026-08-09T09:00:00",
    handover_approved_by: 30,
    handover_approved_by_name: "Manager Operasional",
    giver_name: "Admin CRO",
    giver_nip: "10001",
    giver_position: "Admin CRO",
    custody_id: 20,
    custody_nip: "123456",
    custody_name: "Custody Test",
    recipient_name: "Custody Test",
    recipient_nip: "123456",
    recipient_position: "Custody",
    summary: { all_scanned: true, total_keys: 1 },
    items: [{
      sequence_no: 1,
      work_order_point_id: 101,
      machine_id: 201,
      tid: "TID001",
      sn: "SN001",
      lokasi: "Lokasi ATM",
      machine_key_mapping_id: 301,
      position: "A-11",
      barcode_snapshot: "KEYABC123",
      scanned_at: "2026-08-09T08:14:00",
      scanned_by: 10,
      scanned_by_name: "Admin CRO",
    }],
  }
}

test("key handover API strips master barcode before serializing snapshot", async () => {
  const route = await read("app/api/transactions/replenish/[id]/key-handover/route.js")
  assert.match(route, /const publicItem = \{ \.\.\.item \}/)
  assert.match(route, /delete publicItem\.barcode/)
  assert.match(route, /mapping\.barcode = @barcode/)
  assert.doesNotMatch(route, /barcode:\s*item\.barcode_snapshot\s*\|\|\s*item\.barcode/)
})

test("editing a work order regenerates pending assignment letter and submit compares current snapshot hash", async () => {
  const route = await read("app/api/transactions/replenish/[id]/route.js")
  const replaceIndex = route.indexOf("await replaceWorkOrderDetails(transaction, workOrderId, transactionData)")
  const refreshIndex = route.indexOf("await createPendingAssignmentLetter(transaction", replaceIndex)
  assert.ok(replaceIndex >= 0)
  assert.ok(refreshIndex > replaceIndex)
  assert.match(route, /buildAssignmentLetterSnapshot\([\s\S]*allowPreparatory: true/)
  assert.match(route, /currentSnapshot\.documentHash[\s\S]*letter\.document_hash/)
  assert.match(route, /Surat Tugas sudah tidak sesuai dengan Work Order terbaru/)
})

test("key handover canonical document is deterministic and includes only verified barcode snapshots", () => {
  const snapshot = sampleHandover()
  const payload = createKeyHandoverDocumentPayload(snapshot)
  assert.equal(payload.document_type, "REPLENISH_KEY_HANDOVER")
  assert.equal(payload.schema_version, 2)
  assert.equal(payload.handover.giver_position, "Admin CRO")
  assert.equal(payload.handover.recipient_position, "Custody")
  assert.equal(payload.items[0].barcode_snapshot, "KEYABC123")
  assert.equal(hashKeyHandoverDocument(snapshot), hashKeyHandoverDocument(payload))
  assert.match(hashKeyHandoverDocument(snapshot), /^[0-9a-f]{64}$/)
})

test("key handover document hash stays stable when approved work order advances into CPC workflow", () => {
  const approved = sampleHandover()
  const cpcInProgress = { ...approved, status: "KASET_DALAM_PERSIAPAN" }
  const readyToDepart = { ...approved, status: "SIAP_BERANGKAT" }

  assert.equal(hashKeyHandoverDocument(approved), hashKeyHandoverDocument(cpcInProgress))
  assert.equal(hashKeyHandoverDocument(approved), hashKeyHandoverDocument(readyToDepart))
  assert.equal(createKeyHandoverDocumentPayload(cpcInProgress).work_order.status, "DISETUJUI")
})

test("server-side key handover PDF has deterministic bytes, PDF signature, and SHA-256 hash", () => {
  const verificationUrl = "https://example.test/transactions/replenish/key-handover/verify/123e4567-e89b-42d3-a456-426614174000"
  const pdf = generateKeyHandoverPdf(sampleHandover(), { verificationUrl })
  const retryPdf = generateKeyHandoverPdf(sampleHandover(), { verificationUrl })
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-")
  assert.ok(pdf.length > 1000)
  assert.deepEqual(pdf, retryPdf)
  assert.match(hashKeyHandoverPdfBuffer(pdf), /^[0-9a-f]{64}$/)
})

test("key handover approval hash binds document, QR token, approver, and approval time", () => {
  const snapshot = sampleHandover()
  const documentHash = hashKeyHandoverDocument(snapshot)
  const approvalHash = createKeyHandoverApprovalHash({
    documentHash,
    verificationToken: snapshot.verification_token,
    approvedBy: snapshot.handover_approved_by,
    approvedAt: snapshot.handover_approved_at,
  })
  assert.match(approvalHash, /^[0-9a-f]{64}$/)
})

test("approved key handover renders separate QR on giver and recipient identity blocks", async () => {
  const pdfSource = await read("modules/replenish/key-handover-pdf.js")
  const approvalSource = await read("modules/replenish/key-handover-approval.js")
  const verificationPage = await read("app/transactions/replenish/key-handover/verify/[token]/page.jsx")
  const migration = await read("scripts/migrations/053-key-handover-approval-qr.sql")

  assert.match(pdfSource, /QR Penyerah/)
  assert.match(pdfSource, /QR Penerima/)
  assert.match(pdfSource, /drawQr\(canvas, partyUrl\("giver"\), giverQrX/)
  assert.match(pdfSource, /drawQr\(canvas, partyUrl\("recipient"\), recipientQrX/)
  assert.match(pdfSource, /handover\.giver_name/)
  assert.match(pdfSource, /handover\.giver_position/)
  assert.match(pdfSource, /handover\.recipient_name/)
  assert.match(pdfSource, /handover\.recipient_position/)
  assert.match(approvalSource, /freezeApprovedKeyHandover/)
  assert.match(approvalSource, /verification_token = COALESCE\(handover\.verification_token, NEWID\(\)\)/)
  assert.match(verificationPage, /Verifikasi QR Serah Terima Kunci/)
  assert.match(verificationPage, /Petugas Penyerah/)
  assert.match(verificationPage, /Custody \/ Penerima/)
  assert.match(migration, /UX_replenish_key_handover_verification_token/)
})

test("key handover storage is private, immutable by document hash, and verifies PDF bytes", async () => {
  const storage = await read("modules/replenish/key-handover-pdf-storage.js")
  assert.match(storage, /storage["',\s\n]+private["',\s\n]+replenish["',\s\n]+key-handover/)
  assert.match(storage, /existing\.document_hash !== incomingHash/)
  assert.match(storage, /KEY_HANDOVER_PDF_IMMUTABLE_MISMATCH/)
  assert.match(storage, /crypto\.createHash\("sha256"\)\.update\(buffer\)/)
  assert.match(storage, /KEY_HANDOVER_PDF_INTEGRITY/)
  assert.match(storage, /backupPdfPath/)
  assert.match(storage, /Windows tidak mengizinkan fs\.rename\(\) menimpa file tujuan/)
})

test("MARK_PRINTED requires stored PDF whose document hash matches current handover snapshot", async () => {
  const route = await read("app/api/transactions/replenish/[id]/key-handover/route.js")
  assert.match(route, /confirmationDocumentHash = hashKeyHandoverDocument\(confirmationSnapshot\)/)
  assert.match(route, /storedPdf\.document_hash !== confirmationDocumentHash/)
  assert.match(route, /Bentuk dan buka PDF Serah Terima Kunci terbaru sebelum mengonfirmasi hasil cetak/)
  assert.match(route, /action: "GENERATE_PDF"/)
  assert.match(route, /pdf_hash: storedPdf\.pdf_hash/)
})
