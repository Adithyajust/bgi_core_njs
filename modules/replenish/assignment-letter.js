import "server-only"

import crypto from "node:crypto"

import { sql } from "@/lib/mssql"
import { normalizeRowVersionToken } from "@/modules/master-mesin/row-version"
import { getReplenishWorkOrderDetail } from "@/modules/replenish/database"

const BLOCKED_WORK_ORDER_STATUSES = new Set([
  "DRAFT",
  "MENUNGGU_PERSETUJUAN_TIM",
  "DITOLAK",
  "DIBATALKAN",
])

const PREPARATORY_WORK_ORDER_STATUSES = new Set([
  "DRAFT",
  "DITOLAK",
])

function createRequest(executor) {
  return new sql.Request(executor)
}

function normalizeToken(value) {
  const token = String(value || "").trim().toLowerCase()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)
    ? token
    : null
}

function dateToIsoSeconds(value) {
  const raw = String(value || "").trim()
  const sqlWallClock = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?$/)
  const date = value instanceof Date
    ? value
    : sqlWallClock
      ? new Date(`${sqlWallClock[1]}T${sqlWallClock[2]}.000Z`)
      : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString()
}


function dateToWallClockSeconds(value) {
  if (!value) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 19)
  }

  const raw = String(value).trim()
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/)
  if (match) return `${match[1]}T${match[2]}`

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 19)
}

export function isAssignmentLetterEligibleStatus(status) {
  const normalized = String(status || "").trim().toUpperCase()
  return Boolean(normalized) && !BLOCKED_WORK_ORDER_STATUSES.has(normalized)
}

export function isAssignmentLetterPreparatoryStatus(status) {
  return PREPARATORY_WORK_ORDER_STATUSES.has(String(status || "").trim().toUpperCase())
}

export function createAssignmentLetterNumber(workOrderNo) {
  const normalized = String(workOrderNo || "").trim().toUpperCase()
  if (!/^RPL-[A-Z0-9-]{1,40}$/.test(normalized)) {
    throw new Error("Nomor work order tidak valid untuk surat tugas.")
  }
  return `ST-${normalized}`
}

export function createAssignmentLetterPayload(workOrder, letterNo) {
  return {
    schema_version: 1,
    document_type: "SURAT_TUGAS_REPLENISH",
    letter_no: letterNo,
    work_order: {
      id: Number(workOrder.id),
      number: workOrder.work_order_no,
      status: workOrder.status,
      activity_type: workOrder.activity_type,
      schedule_date: workOrder.schedule_date,
      departure_time: workOrder.departure_time,
      estimated_finish_time: workOrder.estimated_finish_time,
      priority: workOrder.priority,
      unit: {
        id: Number(workOrder.uker_id),
        code: workOrder.codeuker,
        name: workOrder.nama_uker,
      },
      vehicle: {
        id: Number(workOrder.vehicle_id),
        label: workOrder.vehicle_label,
      },
      escort_name: workOrder.escort_name || null,
      total_points: Number(workOrder.total_points || 0),
      total_requested_amount: Number(workOrder.total_requested_amount || 0),
      route_notes: workOrder.route_notes || null,
      notes: workOrder.notes || null,
      approved_by_name: workOrder.approved_by_name || null,
      approved_at: workOrder.approved_at || null,
    },
    team: (workOrder.team || []).map((member) => ({
      employee_id: Number(member.employee_id),
      role: member.member_role,
      nip: member.nip || null,
      name: member.nama,
      position: member.jabatan || null,
      is_lead: Boolean(member.is_lead),
    })),
    points: (workOrder.points || []).map((point) => ({
      sequence_no: Number(point.sequence_no),
      machine_id: Number(point.machine_id),
      tid: point.tid || null,
      serial_number: point.sn || null,
      location: point.lokasi || null,
      machine_category: point.kategori_mesin || null,
      activity_type: point.activity_type || workOrder.activity_type,
      pagu: point.pagu === null || point.pagu === undefined ? null : Number(point.pagu),
      denomination: point.denomination_value === null || point.denomination_value === undefined
        ? point.denom || null
        : Number(point.denomination_value),
      required_cassettes: point.required_cassettes === null || point.required_cassettes === undefined
        ? null
        : Number(point.required_cassettes),
      requested_amount: point.requested_amount === null || point.requested_amount === undefined
        ? null
        : Number(point.requested_amount),
      notes: point.notes || null,
    })),
  }
}

export function hashAssignmentLetterPayload(payload) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex")
}

export function createAssignmentApprovalHash({
  documentHash,
  verificationToken,
  approvedBy,
  approvedAt,
}) {
  const normalizedToken = normalizeToken(verificationToken)
  const approvedAtIso = dateToIsoSeconds(approvedAt)
  if (!/^[0-9a-f]{64}$/.test(String(documentHash || "")) || !normalizedToken || !approvedAtIso) {
    throw new Error("Data persetujuan surat tugas tidak valid.")
  }

  return crypto
    .createHash("sha256")
    .update(`${documentHash}|${normalizedToken}|${Number(approvedBy)}|${approvedAtIso}`, "utf8")
    .digest("hex")
}

function safeParsePayload(value) {
  try {
    const parsed = JSON.parse(String(value || ""))
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

function normalizeAssignmentLetter(row) {
  if (!row) return null
  const payload = safeParsePayload(row.payload_json)
  const actualDocumentHash = payload ? hashAssignmentLetterPayload(payload) : null
  const approvedAtCanonical = row.approved_at ? dateToIsoSeconds(row.approved_at) : null
  const expectedApprovalHash = row.status === "DISETUJUI" && approvedAtCanonical
    ? createAssignmentApprovalHash({
        documentHash: row.document_hash,
        verificationToken: row.verification_token,
        approvedBy: row.approved_by,
        approvedAt: approvedAtCanonical,
      })
    : null

  return {
    ...row,
    verification_token: String(row.verification_token || "").toLowerCase(),
    row_version: normalizeRowVersionToken(row.row_version),
    payload,
    payload_valid: Boolean(payload && actualDocumentHash === row.document_hash),
    approval_valid: row.status === "DISETUJUI"
      ? Boolean(expectedApprovalHash && expectedApprovalHash === row.approval_hash)
      : null,
    approved_at: dateToWallClockSeconds(row.approved_at),
    rejected_at: dateToWallClockSeconds(row.rejected_at),
    created_at: dateToWallClockSeconds(row.created_at),
    updated_at: dateToWallClockSeconds(row.updated_at),
  }
}

const LETTER_SELECT = `
  SELECT TOP (1)
    letter.id,
    letter.work_order_id,
    letter.letter_no,
    letter.status,
    letter.payload_json,
    letter.document_hash,
    CONVERT(VARCHAR(36), letter.verification_token) AS verification_token,
    letter.created_by,
    creator.full_name AS created_by_name,
    CONVERT(CHAR(19), letter.created_at, 126) AS created_at,
    letter.approved_by,
    approver.full_name AS approved_by_name,
    approver_pegawai.nip AS approved_by_nip,
    COALESCE(NULLIF(approver_pegawai.jabatan, ''), approver_role.role_name) AS approved_by_position,
    CONVERT(CHAR(19), letter.approved_at, 126) AS approved_at,
    letter.approval_hash,
    letter.rejected_by,
    rejector.full_name AS rejected_by_name,
    CONVERT(CHAR(19), letter.rejected_at, 126) AS rejected_at,
    letter.rejection_reason,
    CONVERT(CHAR(19), letter.updated_at, 126) AS updated_at,
    CONVERT(VARCHAR(18), letter.row_version, 1) AS row_version,
    wo.work_order_no,
    wo.status AS work_order_status,
    wo.created_by AS work_order_created_by,
    mu.codeuker,
    mu.nama_uker
  FROM dbo.replenish_assignment_letters letter
  INNER JOIN dbo.replenish_work_orders wo ON wo.id = letter.work_order_id
  INNER JOIN dbo.master_uker mu ON mu.id = wo.uker_id
  INNER JOIN dbo.users creator ON creator.id = letter.created_by
  LEFT JOIN dbo.users approver ON approver.id = letter.approved_by
  LEFT JOIN dbo.roles approver_role ON approver_role.id = approver.role_id
  LEFT JOIN dbo.pegawai approver_pegawai ON approver_pegawai.id = approver.pegawai_id
  LEFT JOIN dbo.users rejector ON rejector.id = letter.rejected_by
`

export async function getAssignmentLetterByWorkOrder(executor, workOrderId, scopeCodeUker = null) {
  const result = await createRequest(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("scopeCodeUker", sql.NVarChar(4), scopeCodeUker)
    .query(`
      ${LETTER_SELECT}
      WHERE letter.work_order_id = @workOrderId
        AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker);
    `)

  return normalizeAssignmentLetter(result.recordset[0])
}

export async function getAssignmentLetterByToken(executor, token, scopeCodeUker = null) {
  const normalizedToken = normalizeToken(token)
  if (!normalizedToken) return null

  const result = await createRequest(executor)
    .input("verificationToken", sql.UniqueIdentifier, normalizedToken)
    .input("scopeCodeUker", sql.NVarChar(4), scopeCodeUker)
    .query(`
      ${LETTER_SELECT}
      WHERE letter.verification_token = @verificationToken
        AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker);
    `)

  return normalizeAssignmentLetter(result.recordset[0])
}

export async function buildAssignmentLetterSnapshot(
  executor,
  workOrderId,
  scopeCodeUker = null,
  { allowPreparatory = false } = {}
) {
  const workOrder = await getReplenishWorkOrderDetail(executor, workOrderId, scopeCodeUker)
  if (!workOrder) return { error: "Work order tidak ditemukan.", workOrder: null }

  const approvedEligible = isAssignmentLetterEligibleStatus(workOrder.status)
  const preparatoryEligible = allowPreparatory && isAssignmentLetterPreparatoryStatus(workOrder.status)
  if (!approvedEligible && !preparatoryEligible) {
    return {
      error: allowPreparatory
        ? "Surat tugas tidak dapat dibuat dari status work order saat ini."
        : "Surat tugas hanya dapat dibuat setelah work order disetujui.",
      workOrder,
    }
  }

  const letterNo = createAssignmentLetterNumber(workOrder.work_order_no)
  const payload = createAssignmentLetterPayload(workOrder, letterNo)
  return {
    error: null,
    workOrder,
    letterNo,
    payload,
    payloadJson: JSON.stringify(payload),
    documentHash: hashAssignmentLetterPayload(payload),
  }
}

export async function createPendingAssignmentLetter(executor, {
  workOrderId,
  scopeCodeUker = null,
}) {
  const normalizedWorkOrderId = Number(workOrderId)
  if (!Number.isSafeInteger(normalizedWorkOrderId) || normalizedWorkOrderId <= 0) {
    throw new Error("ID work order tidak valid untuk Surat Tugas.")
  }

  const snapshot = await buildAssignmentLetterSnapshot(
    executor,
    normalizedWorkOrderId,
    scopeCodeUker,
    { allowPreparatory: true }
  )
  if (snapshot.error) throw new Error(snapshot.error)
  if (!isAssignmentLetterPreparatoryStatus(snapshot.workOrder.status)) {
    throw new Error("Surat Tugas persiapan hanya berlaku untuk work order yang belum disetujui.")
  }

  const createdBy = Number(snapshot.workOrder.created_by)
  if (!Number.isSafeInteger(createdBy) || createdBy <= 0) {
    throw new Error("Pembuat Work Order tidak valid untuk Surat Tugas.")
  }

  const existing = await createRequest(executor)
    .input("workOrderId", sql.BigInt, normalizedWorkOrderId)
    .query(`
      SELECT TOP (1) id, status, document_hash
      FROM dbo.replenish_assignment_letters WITH (UPDLOCK, HOLDLOCK)
      WHERE work_order_id = @workOrderId;
    `)

  let current = existing.recordset[0] || null
  if (
    current?.id &&
    current.status === "MENUNGGU_PERSETUJUAN" &&
    current.document_hash === snapshot.documentHash
  ) {
    return {
      id: Number(current.id),
      workOrderId: normalizedWorkOrderId,
      letterNo: snapshot.letterNo,
      documentHash: snapshot.documentHash,
      createdBy,
      unchanged: true,
    }
  }

  const verificationToken = crypto.randomUUID()
  if (current?.id) {
    await createRequest(executor)
      .input("workOrderId", sql.BigInt, normalizedWorkOrderId)
      .input("letterNo", sql.VarChar(50), snapshot.letterNo)
      .input("payloadJson", sql.NVarChar(sql.MAX), snapshot.payloadJson)
      .input("documentHash", sql.Char(64), snapshot.documentHash)
      .input("verificationToken", sql.UniqueIdentifier, verificationToken)
      .input("createdBy", sql.Int, createdBy)
      .query(`
        UPDATE dbo.replenish_assignment_letters
        SET
          letter_no = @letterNo,
          status = 'MENUNGGU_PERSETUJUAN',
          payload_json = @payloadJson,
          document_hash = @documentHash,
          verification_token = @verificationToken,
          created_by = @createdBy,
          approved_by = NULL,
          approved_at = NULL,
          approval_hash = NULL,
          rejected_by = NULL,
          rejected_at = NULL,
          rejection_reason = NULL,
          updated_at = SYSDATETIME()
        WHERE work_order_id = @workOrderId;
      `)
  } else {
    const inserted = await createRequest(executor)
      .input("workOrderId", sql.BigInt, normalizedWorkOrderId)
      .input("letterNo", sql.VarChar(50), snapshot.letterNo)
      .input("payloadJson", sql.NVarChar(sql.MAX), snapshot.payloadJson)
      .input("documentHash", sql.Char(64), snapshot.documentHash)
      .input("verificationToken", sql.UniqueIdentifier, verificationToken)
      .input("createdBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.replenish_assignment_letters
        (
          work_order_id, letter_no, status, payload_json, document_hash,
          verification_token, created_by
        )
        OUTPUT inserted.id
        VALUES
        (
          @workOrderId, @letterNo, 'MENUNGGU_PERSETUJUAN', @payloadJson, @documentHash,
          @verificationToken, @createdBy
        );
      `)
    current = inserted.recordset[0] || null
  }

  return {
    id: Number(current?.id || existing.recordset[0]?.id || 0) || null,
    workOrderId: normalizedWorkOrderId,
    letterNo: snapshot.letterNo,
    documentHash: snapshot.documentHash,
    createdBy,
    unchanged: false,
  }
}


export async function createApprovedAssignmentLetter(executor, {
  workOrderId,
  approvedBy,
  approvedAt,
  scopeCodeUker = null,
}) {
  const normalizedWorkOrderId = Number(workOrderId)
  const normalizedApprovedBy = Number(approvedBy)
  const approvedAtIso = dateToIsoSeconds(approvedAt)

  if (!Number.isSafeInteger(normalizedWorkOrderId) || normalizedWorkOrderId <= 0) {
    throw new Error("ID work order tidak valid untuk Surat Tugas.")
  }
  if (!Number.isSafeInteger(normalizedApprovedBy) || normalizedApprovedBy <= 0 || !approvedAtIso) {
    throw new Error("Data approver work order tidak valid untuk Surat Tugas.")
  }

  const snapshot = await buildAssignmentLetterSnapshot(
    executor,
    normalizedWorkOrderId,
    scopeCodeUker
  )
  if (snapshot.error) throw new Error(snapshot.error)

  const createdBy = Number(snapshot.workOrder.created_by)
  if (!Number.isSafeInteger(createdBy) || createdBy <= 0) {
    throw new Error("Pembuat Work Order tidak valid untuk Surat Tugas.")
  }

  const verificationToken = crypto.randomUUID()
  const approvedAtValue = new Date(approvedAtIso)
  const approvalHash = createAssignmentApprovalHash({
    documentHash: snapshot.documentHash,
    verificationToken,
    approvedBy: normalizedApprovedBy,
    approvedAt: approvedAtValue,
  })

  const existing = await createRequest(executor)
    .input("workOrderId", sql.BigInt, normalizedWorkOrderId)
    .query(`
      SELECT TOP (1) id
      FROM dbo.replenish_assignment_letters WITH (UPDLOCK, HOLDLOCK)
      WHERE work_order_id = @workOrderId;
    `)

  let assignmentLetterId
  if (existing.recordset[0]?.id) {
    assignmentLetterId = Number(existing.recordset[0].id)
    await createRequest(executor)
      .input("workOrderId", sql.BigInt, normalizedWorkOrderId)
      .input("letterNo", sql.VarChar(50), snapshot.letterNo)
      .input("payloadJson", sql.NVarChar(sql.MAX), snapshot.payloadJson)
      .input("documentHash", sql.Char(64), snapshot.documentHash)
      .input("verificationToken", sql.UniqueIdentifier, verificationToken)
      .input("createdBy", sql.Int, createdBy)
      .input("approvedBy", sql.Int, normalizedApprovedBy)
      .input("approvedAt", sql.DateTime2(0), approvedAtValue)
      .input("approvalHash", sql.Char(64), approvalHash)
      .query(`
        UPDATE dbo.replenish_assignment_letters
        SET
          letter_no = @letterNo,
          status = 'DISETUJUI',
          payload_json = @payloadJson,
          document_hash = @documentHash,
          verification_token = @verificationToken,
          created_by = @createdBy,
          created_at = @approvedAt,
          approved_by = @approvedBy,
          approved_at = @approvedAt,
          approval_hash = @approvalHash,
          rejected_by = NULL,
          rejected_at = NULL,
          rejection_reason = NULL,
          updated_at = @approvedAt
        WHERE work_order_id = @workOrderId;
      `)
  } else {
    const inserted = await createRequest(executor)
      .input("workOrderId", sql.BigInt, normalizedWorkOrderId)
      .input("letterNo", sql.VarChar(50), snapshot.letterNo)
      .input("payloadJson", sql.NVarChar(sql.MAX), snapshot.payloadJson)
      .input("documentHash", sql.Char(64), snapshot.documentHash)
      .input("verificationToken", sql.UniqueIdentifier, verificationToken)
      .input("createdBy", sql.Int, createdBy)
      .input("approvedBy", sql.Int, normalizedApprovedBy)
      .input("approvedAt", sql.DateTime2(0), approvedAtValue)
      .input("approvalHash", sql.Char(64), approvalHash)
      .query(`
        INSERT INTO dbo.replenish_assignment_letters
        (
          work_order_id, letter_no, status, payload_json, document_hash,
          verification_token, created_by, created_at, approved_by, approved_at,
          approval_hash, updated_at
        )
        OUTPUT inserted.id
        VALUES
        (
          @workOrderId, @letterNo, 'DISETUJUI', @payloadJson, @documentHash,
          @verificationToken, @createdBy, @approvedAt, @approvedBy, @approvedAt,
          @approvalHash, @approvedAt
        );
      `)
    assignmentLetterId = Number(inserted.recordset[0]?.id)
  }

  return {
    id: assignmentLetterId,
    workOrderId: normalizedWorkOrderId,
    letterNo: snapshot.letterNo,
    documentHash: snapshot.documentHash,
    verificationToken,
    approvalHash,
    createdBy,
    approvedBy: normalizedApprovedBy,
    approvedAt: approvedAtIso,
  }
}
