import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

import { createQrMatrix, createQrSvg } from "../modules/replenish/qr-code.js"

const migrationPath = new URL("../scripts/migrations/034-replenish-assignment-letter.sql", import.meta.url)
const autoMigrationPath = new URL("../scripts/migrations/035-replenish-assignment-letter-auto-generation.sql", import.meta.url)
const workOrderApiPath = new URL("../app/api/transactions/replenish/[id]/route.js", import.meta.url)
const apiPath = new URL("../app/api/transactions/replenish/[id]/surat-tugas/route.js", import.meta.url)
const pagePath = new URL("../app/transactions/replenish/[id]/surat-tugas/page.jsx", import.meta.url)
const verificationPath = new URL("../app/transactions/replenish/surat-tugas/verify/[token]/page.jsx", import.meta.url)
const legacyVerificationPagePath = new URL("../app/verify/surat-tugas/[token]/page.jsx", import.meta.url)
const legacyVerificationApiPath = new URL("../app/api/transactions/surat-tugas/verify/[token]/route.js", import.meta.url)
const legacyPrintButtonPath = new URL("../components/SuratTugasButton.jsx", import.meta.url)
const databaseModulePath = new URL("../modules/replenish/assignment-letter.js", import.meta.url)

test("migration Surat Tugas menyimpan snapshot, QR, hash approval, dan row version", async () => {
  const [sql, autoSql] = await Promise.all([
    fs.readFile(migrationPath, "utf8"),
    fs.readFile(autoMigrationPath, "utf8"),
  ])
  assert.match(sql, /CREATE TABLE dbo\.replenish_assignment_letters/i)
  assert.match(sql, /payload_json NVARCHAR\(MAX\) NOT NULL/i)
  assert.match(sql, /document_hash CHAR\(64\) NOT NULL/i)
  assert.match(sql, /verification_token UNIQUEIDENTIFIER NOT NULL/i)
  assert.match(sql, /approval_hash CHAR\(64\) NULL/i)
  assert.match(sql, /row_version ROWVERSION NOT NULL/i)
  assert.match(sql, /DEFAULT \('MENUNGGU_PERSETUJUAN'\)/i)
  assert.doesNotMatch(sql, /DEFAULT \('DISETUJUI'\)/i)
  assert.match(autoSql, /DF_replenish_assignment_letter_status_auto/i)
  assert.match(autoSql, /DEFAULT \('DISETUJUI'\) FOR status/i)
  assert.match(autoSql, /EXEC sys\.sp_executesql @dropDefaultConstraintSql/i)
  assert.doesNotMatch(autoSql, /EXEC\s*\(.*QUOTENAME/i)
})

test("approval final Work Order membentuk Surat Tugas dan QR Serah Terima Kunci dalam transaksi yang sama", async () => {
  const source = await fs.readFile(workOrderApiPath, "utf8")
  assert.match(source, /createApprovedAssignmentLetter\(transaction/)
  assert.match(source, /freezeApprovedKeyHandover\(transaction/)
  assert.match(source, /action === REPLENISH_ACTIONS\.APPROVE/)
  assert.match(source, /approved_at = CASE WHEN @action = 'APPROVE' THEN @approvedAt/)
  assert.match(source, /source: "WORK_ORDER_FINAL_APPROVAL"/)
  assert.match(source, /QR Surat Tugas dan Serah Terima Kunci telah terbentuk otomatis/)
  assert.match(source, /await transaction\.commit\(\)/)
})

test("API Surat Tugas menyiapkan dokumen draft dan tetap melakukan backfill otomatis untuk data lama", async () => {
  const source = await fs.readFile(apiPath, "utf8")
  assert.match(source, /authorizeApiRequest\(request, "\/transactions", "view"\)/)
  assert.match(source, /createPendingAssignmentLetter/)
  assert.match(source, /isAssignmentLetterPreparatoryStatus/)
  assert.match(source, /ensureLegacyApprovedLetter/)
  assert.match(source, /createApprovedAssignmentLetter\(transaction/)
  assert.match(source, /LEGACY_APPROVED_WORK_ORDER/)
  assert.doesNotMatch(source, /export async function POST/)
  assert.doesNotMatch(source, /export async function PATCH/)
  assert.doesNotMatch(source, /can_generate|can_approve|can_reject/)
})

test("snapshot Surat Tugas memiliki hash SHA-256, token QR, dan approval otomatis", async () => {
  const source = await fs.readFile(databaseModulePath, "utf8")
  assert.match(source, /createHash\("sha256"\)/)
  assert.match(source, /payload_valid/)
  assert.match(source, /approval_valid/)
  assert.match(source, /SURAT_TUGAS_REPLENISH/)
  assert.match(source, /export async function createApprovedAssignmentLetter/)
  assert.match(source, /crypto\.randomUUID\(\)/)
  assert.match(source, /status = 'DISETUJUI'/)
})

test("halaman Surat Tugas mendukung cetak sebelum submit dan QR setelah approval", async () => {
  const [page, verification] = await Promise.all([
    fs.readFile(pagePath, "utf8"),
    fs.readFile(verificationPath, "utf8"),
  ])
  assert.match(page, /Bentuk PDF & Cetak/)
  assert.match(page, /Cetak Surat Tugas/)
  assert.match(page, /Konfirmasi Sudah Dicetak/)
  assert.doesNotMatch(page, /window\.print\(\)/)
  assert.match(page, /createQrSvg/)
  assert.match(page, /Rangkaian Titik Pelaksanaan/)
  assert.match(page, /Dokumen persiapan Work Order/)
  assert.match(page, /Menunggu persetujuan/)
  assert.doesNotMatch(page, /Buat Surat Tugas|Setujui & Tanda Tangan QR|Ajukan Ulang|processApproval|createLetter/)
  assert.match(verification, /Dokumen Valid/)
  assert.match(verification, /approval_valid/)
})

test("encoder QR lokal menghasilkan matrix persegi dan SVG tanpa layanan eksternal", () => {
  const url = "https://internal.example/transactions/replenish/surat-tugas/verify/123e4567-e89b-42d3-a456-426614174000"
  const matrix = createQrMatrix(url)
  assert.ok(matrix.length >= 21)
  assert.equal(matrix.length, matrix[0].length)
  assert.ok(matrix.flat().some(Boolean))
  const svg = createQrSvg(url)
  assert.match(svg, /^<svg /)
  assert.match(svg, /shape-rendering="crispEdges"/)
  assert.doesNotMatch(svg, /api\.qrserver|quickchart|googleapis/i)
})

test("jalur Surat Tugas lama meneruskan ke implementasi Replenish yang aktif", async () => {
  const [legacyPage, legacyApi, legacyButton] = await Promise.all([
    fs.readFile(legacyVerificationPagePath, "utf8"),
    fs.readFile(legacyVerificationApiPath, "utf8"),
    fs.readFile(legacyPrintButtonPath, "utf8"),
  ])

  assert.match(legacyPage, /transactions\/replenish\/surat-tugas\/verify/)
  assert.doesNotMatch(legacyPage, /process\.env\.APP_URL/)
  assert.match(legacyApi, /authorizeApiRequest\(request, "\/transactions", "view"\)/)
  assert.match(legacyApi, /getAssignmentLetterByToken/)
  assert.doesNotMatch(legacyApi, /dbo\.surat_tugas|sql\.query/)
  assert.match(legacyButton, /transactions\/replenish\/\$\{id\}\/surat-tugas/)
  assert.doesNotMatch(legacyButton, /location\.href|\/generate\?id=/)
})
