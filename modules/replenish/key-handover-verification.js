import "server-only"

import { sql } from "@/lib/mssql"
import { createKeyHandoverApprovalHash } from "@/modules/replenish/key-handover-pdf"
import { readStoredKeyHandoverPdf } from "@/modules/replenish/key-handover-pdf-storage"

function normalizeToken(value) {
  const token = String(value || "").trim().toLowerCase()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)
    ? token
    : null
}

export async function getKeyHandoverVerification(executor, token, scopeCodeUker = null) {
  const verificationToken = normalizeToken(token)
  if (!verificationToken) return null

  const result = await new sql.Request(executor)
    .input("verificationToken", sql.UniqueIdentifier, verificationToken)
    .input("scopeCodeUker", sql.NVarChar(4), scopeCodeUker)
    .query(`
      SELECT TOP (1)
        handover.id AS handover_id,
        handover.work_order_id,
        handover.receipt_no,
        CONVERT(VARCHAR(36), handover.verification_token) AS verification_token,
        CONVERT(CHAR(19), handover.verified_at, 126) AS verified_at,
        CONVERT(CHAR(19), handover.approved_at, 126) AS approved_at,
        handover.approved_by,
        approver.full_name AS approved_by_name,
        COALESCE(NULLIF(approver_employee.jabatan, N''), approver_role.role_name) AS approved_by_position,
        approver_employee.nip AS approved_by_nip,
        handover.giver_name_snapshot AS giver_name,
        handover.giver_nip_snapshot AS giver_nip,
        handover.giver_position_snapshot AS giver_position,
        handover.recipient_name_snapshot AS recipient_name,
        handover.recipient_nip_snapshot AS recipient_nip,
        handover.recipient_position_snapshot AS recipient_position,
        handover.document_hash,
        handover.approval_hash,
        work_order.work_order_no,
        work_order.status AS work_order_status,
        CONVERT(CHAR(10), work_order.schedule_date, 23) AS schedule_date,
        unit.codeuker,
        unit.nama_uker,
        item_summary.total_keys
      FROM dbo.replenish_key_handovers handover
      INNER JOIN dbo.replenish_work_orders work_order
        ON work_order.id = handover.work_order_id
      INNER JOIN dbo.master_uker unit
        ON unit.id = work_order.uker_id
      LEFT JOIN dbo.users approver
        ON approver.id = handover.approved_by
      LEFT JOIN dbo.roles approver_role
        ON approver_role.id = approver.role_id
      LEFT JOIN dbo.pegawai approver_employee
        ON approver_employee.id = approver.pegawai_id
      OUTER APPLY
      (
        SELECT COUNT_BIG(1) AS total_keys
        FROM dbo.replenish_key_handover_items item
        WHERE item.handover_id = handover.id
      ) item_summary
      WHERE handover.verification_token = @verificationToken
        AND (@scopeCodeUker IS NULL OR unit.codeuker = @scopeCodeUker);
    `)

  const record = result.recordset[0]
  if (!record) return null

  let storedPdf = null
  let storageIntegrityValid = false
  try {
    storedPdf = await readStoredKeyHandoverPdf(record.work_order_id, { includeBuffer: true })
    storageIntegrityValid = Boolean(
      storedPdf
      && storedPdf.document_hash === String(record.document_hash || "").toLowerCase()
    )
  } catch {
    storageIntegrityValid = false
  }

  let expectedApprovalHash = null
  try {
    expectedApprovalHash = createKeyHandoverApprovalHash({
      documentHash: record.document_hash,
      verificationToken: record.verification_token,
      approvedBy: record.approved_by,
      approvedAt: record.approved_at,
    })
  } catch {
    expectedApprovalHash = null
  }

  return {
    ...record,
    handover_id: Number(record.handover_id),
    work_order_id: Number(record.work_order_id),
    approved_by: Number(record.approved_by) || null,
    total_keys: Number(record.total_keys || 0),
    pdf_hash: storedPdf?.pdf_hash || null,
    valid: Boolean(
      record.receipt_no
      && record.verified_at
      && record.approved_at
      && record.giver_name
      && record.giver_position
      && record.recipient_name
      && record.recipient_position
      && storageIntegrityValid
      && expectedApprovalHash
      && expectedApprovalHash === String(record.approval_hash || "").toLowerCase()
    ),
  }
}
