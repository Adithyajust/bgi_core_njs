import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope, hasMenuAccess } from "@/lib/access-control"
import { readJsonBody, InvalidJsonBodyError, RequestBodyTooLargeError } from "@/lib/http/json-body"
import { connectDB, sql } from "@/lib/mssql"
import { insertAuditLog } from "@/lib/security/audit-log"
import { getAssignmentLetterByWorkOrder } from "@/modules/replenish/assignment-letter"
import { isReplenishKeyHandoverPrinter } from "@/modules/replenish/authorization"
import { hasReplenishReachedApproval } from "@/modules/replenish/constants"
import {
  createKeyHandoverApprovalHash,
  generateKeyHandoverPdf,
  hashKeyHandoverDocument,
  KEY_HANDOVER_PDF_TEMPLATE_VERSION,
  hashKeyHandoverPdfBuffer,
} from "@/modules/replenish/key-handover-pdf"
import {
  canAccessStoredKeyHandoverPdf,
  readStoredKeyHandoverPdf,
  writeStoredKeyHandoverPdf,
} from "@/modules/replenish/key-handover-pdf-storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 16 * 1024
const BARCODE_PATTERN = /^[A-Z0-9]{6,64}$/
const SCANNABLE_STATUSES = new Set(["DRAFT", "DITOLAK"])

function errorResponse(message, status = 400) {
  return NextResponse.json({ success: false, message }, { status })
}

function normalizeId(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeBarcode(value) {
  return String(value || "").trim().toUpperCase().replaceAll(/\s+/g, "")
}

function normalizeAction(value) {
  return String(value || "").trim().toUpperCase()
}

function keyHandoverPdfUrl(request, workOrderId, stored = null) {
  const url = new URL(`/api/transactions/replenish/${workOrderId}`, request.url)
  url.searchParams.set("resource", "key-handover-pdf")
  if (stored?.pdf_hash) {
    url.searchParams.set("v", `${stored.template_version}-${stored.pdf_hash}`)
  }
  return url.toString()
}

function keyHandoverVerificationUrl(request, token) {
  return token
    ? new URL(`/transactions/replenish/key-handover/verify/${token}`, request.url).toString()
    : null
}

function emptyKeyHandoverPdfMetadata(workOrderId, { stale = false } = {}) {
  return {
    exists: false,
    work_order_id: Number(workOrderId),
    printed: false,
    stale: Boolean(stale),
  }
}

function keyHandoverPdfMetadata(request, stored, snapshot = null) {
  if (!stored) return null
  return {
    exists: true,
    work_order_id: stored.work_order_id,
    receipt_no: stored.receipt_no,
    document_hash: stored.document_hash,
    template_version: stored.template_version,
    current_template_version: KEY_HANDOVER_PDF_TEMPLATE_VERSION,
    template_current: stored.template_version >= KEY_HANDOVER_PDF_TEMPLATE_VERSION,
    pdf_hash: stored.pdf_hash,
    generated_at: stored.generated_at,
    generated_by: stored.generated_by,
    size: stored.size,
    file_name: stored.file_name,
    pdf_url: keyHandoverPdfUrl(request, stored.work_order_id, stored),
    printed: Boolean(snapshot?.summary?.printed),
    printed_at: snapshot?.printed_at || null,
    printed_by: snapshot?.printed_by ? Number(snapshot.printed_by) : null,
    printed_by_name: snapshot?.printed_by_name || null,
    stale: false,
  }
}

async function readBody(request) {
  try {
    return { body: await readJsonBody(request, { maxBytes: MAX_BODY_BYTES }), response: null }
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return { body: null, response: errorResponse("Data scan terlalu besar.", 413) }
    }
    if (error instanceof InvalidJsonBodyError) {
      return { body: null, response: errorResponse(error.message, 400) }
    }
    throw error
  }
}

async function authorizeTransaction(request, action = "view") {
  return authorizeApiRequest(request, "/transactions", action)
}

async function authorizeTransactionAny(request, actions) {
  let lastAuthorization = null
  for (const action of actions) {
    const authorization = await authorizeTransaction(request, action)
    if (authorization.authorized) return authorization
    lastAuthorization = authorization
    if (authorization.response?.status !== 403) return authorization
  }
  return lastAuthorization
}

async function ensureSchema(executor) {
  const result = await new sql.Request(executor).query(`
    SELECT CASE
      WHEN OBJECT_ID(N'dbo.replenish_key_handovers', N'U') IS NOT NULL
       AND OBJECT_ID(N'dbo.replenish_key_handover_items', N'U') IS NOT NULL
       AND OBJECT_ID(N'dbo.machine_key_mappings', N'U') IS NOT NULL
       AND COL_LENGTH(N'dbo.replenish_key_handovers', N'verification_token') IS NOT NULL
      THEN CAST(1 AS BIT)
      ELSE CAST(0 AS BIT)
    END AS schema_ready;
  `)
  return Boolean(result.recordset[0]?.schema_ready)
}

async function loadSnapshot(executor, workOrderId, scopeCodeUker = null) {
  const result = await new sql.Request(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("scopeCodeUker", sql.NVarChar(4), scopeCodeUker)
    .query(`
      SET NOCOUNT ON;

      SELECT TOP (1)
        wo.id,
        wo.work_order_no,
        wo.status,
        wo.created_by,
        creator.full_name AS created_by_name,
        wo.uker_id,
        mu.codeuker,
        mu.nama_uker,
        CONVERT(CHAR(10), wo.schedule_date, 23) AS schedule_date,
        CONVERT(CHAR(5), wo.departure_time, 108) AS departure_time,
        h.id AS handover_id,
        h.receipt_no,
        CONVERT(CHAR(19), h.verified_at, 126) AS verified_at,
        h.verified_by,
        verifier.full_name AS verified_by_name,
        CONVERT(VARCHAR(36), h.verification_token) AS verification_token,
        CONVERT(CHAR(19), h.approved_at, 126) AS handover_approved_at,
        h.approved_by AS handover_approved_by,
        handover_approver.full_name AS handover_approved_by_name,
        h.document_hash,
        h.approval_hash,
        COALESCE(NULLIF(h.giver_name_snapshot, N''), verifier.full_name) AS giver_name,
        COALESCE(NULLIF(h.giver_nip_snapshot, ''), verifier_employee.nip) AS giver_nip,
        COALESCE(
          NULLIF(h.giver_position_snapshot, N''),
          NULLIF(verifier_employee.jabatan, N''),
          NULLIF(verifier_role.role_name, N''),
          N'Admin CRO'
        ) AS giver_position,
        CONVERT(CHAR(19), h.printed_at, 126) AS printed_at,
        h.printed_by,
        printer.full_name AS printed_by_name,
        custody.employee_id AS custody_id,
        custody.nip AS custody_nip,
        custody.nama AS custody_name,
        COALESCE(NULLIF(h.recipient_name_snapshot, N''), custody.nama) AS recipient_name,
        COALESCE(NULLIF(h.recipient_nip_snapshot, ''), custody.nip) AS recipient_nip,
        COALESCE(NULLIF(h.recipient_position_snapshot, N''), custody.jabatan, N'Custody') AS recipient_position
      FROM dbo.replenish_work_orders wo
      INNER JOIN dbo.master_uker mu ON mu.id = wo.uker_id
      INNER JOIN dbo.users creator ON creator.id = wo.created_by
      LEFT JOIN dbo.replenish_key_handovers h ON h.work_order_id = wo.id
      LEFT JOIN dbo.users verifier ON verifier.id = h.verified_by
      LEFT JOIN dbo.roles verifier_role ON verifier_role.id = verifier.role_id
      LEFT JOIN dbo.pegawai verifier_employee ON verifier_employee.id = verifier.pegawai_id
      LEFT JOIN dbo.users handover_approver ON handover_approver.id = h.approved_by
      LEFT JOIN dbo.users printer ON printer.id = h.printed_by
      OUTER APPLY (
        SELECT TOP (1) tm.employee_id, p.nip, p.nama, p.jabatan
        FROM dbo.replenish_team_members tm
        INNER JOIN dbo.pegawai p ON p.id = tm.employee_id
        WHERE tm.work_order_id = wo.id
          AND tm.member_role = 'CUSTODY'
      ) custody
      WHERE wo.id = @workOrderId
        AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker);

      SELECT
        point.id AS work_order_point_id,
        point.sequence_no,
        point.machine_id,
        machine.tid,
        machine.sn,
        machine.lokasi,
        COALESCE(scanned_mapping.id, current_mapping.id) AS machine_key_mapping_id,
        current_mapping.id AS current_machine_key_mapping_id,
        COALESCE(scanned_mapping.key_type, current_mapping.key_type) AS key_type,
        COALESCE(scanned_mapping.matrix_wall, current_mapping.matrix_wall) AS matrix_wall,
        COALESCE(scanned_mapping.matrix_column, current_mapping.matrix_column) AS matrix_column,
        COALESCE(scanned_mapping.matrix_row, current_mapping.matrix_row) AS matrix_row,
        current_mapping.status AS mapping_status,
        current_mapping.current_work_order_id,
        item.id AS scan_item_id,
        item.barcode_snapshot,
        CONVERT(CHAR(19), item.scanned_at, 126) AS scanned_at,
        item.scanned_by,
        scanner.full_name AS scanned_by_name,
        CONVERT(BIT, CASE
          WHEN item.id IS NOT NULL
           AND current_mapping.id = item.machine_key_mapping_id
           AND current_mapping.barcode = item.barcode_snapshot
          THEN 1 ELSE 0 END) AS scan_matches_current_mapping
      FROM dbo.replenish_work_order_points point
      INNER JOIN dbo.replenish_work_orders wo ON wo.id = point.work_order_id
      INNER JOIN dbo.master_uker mu ON mu.id = wo.uker_id
      INNER JOIN dbo.master_mesin machine ON machine.id = point.machine_id
      LEFT JOIN dbo.replenish_key_handovers h
        ON h.work_order_id = point.work_order_id
      LEFT JOIN dbo.replenish_key_handover_items item
        ON item.handover_id = h.id
       AND item.work_order_point_id = point.id
      LEFT JOIN dbo.machine_key_mappings scanned_mapping
        ON scanned_mapping.id = item.machine_key_mapping_id
      LEFT JOIN dbo.machine_key_mappings current_mapping
        ON current_mapping.machine_id = point.machine_id
       AND current_mapping.key_type = 'REPLENISH'
      LEFT JOIN dbo.users scanner ON scanner.id = item.scanned_by
      WHERE point.work_order_id = @workOrderId
        AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker)
      ORDER BY point.sequence_no;
    `)

  const header = result.recordsets?.[0]?.[0] || null
  if (!header) return null
  const items = (result.recordsets?.[1] || []).map((item) => {
    // Barcode mapping adalah secret verifikasi fisik. Jangan pernah kirim nilai
    // mapping.barcode yang belum discan ke browser; server tetap memakainya
    // pada query SCAN untuk pencocokan. Hanya barcode_snapshot hasil scan yang
    // boleh keluar sebagai bagian dari bukti serah terima.
    const publicItem = { ...item }
    delete publicItem.barcode
    return {
      ...publicItem,
      machine_id: Number(item.machine_id),
      work_order_point_id: Number(item.work_order_point_id),
      machine_key_mapping_id: item.machine_key_mapping_id ? Number(item.machine_key_mapping_id) : null,
      current_work_order_id: item.current_work_order_id ? Number(item.current_work_order_id) : null,
      scanned: Boolean(item.scanned_at),
      position: item.machine_key_mapping_id
        ? `${item.matrix_wall}-${item.matrix_column}${item.matrix_row}`
        : null,
    }
  })

  const total = items.length
  const mapped = items.filter((item) => item.current_machine_key_mapping_id).length
  const scanned = items.filter((item) => item.scanned).length
  const liveScanned = items.filter((item) => item.scan_matches_current_mapping).length
  const unavailable = items.filter(
    (item) => item.current_machine_key_mapping_id && item.mapping_status !== "IN" && Number(item.current_work_order_id) !== Number(workOrderId)
  ).length
  const liveAllScanned = total > 0 && mapped === total && liveScanned === total && unavailable === 0
  // Setelah submit berhasil, verified_at adalah bukti bahwa seluruh scan sudah sah.
  // Cetak pasca-approval harus memakai snapshot tersebut dan tidak boleh menjadi
  // tidak siap hanya karena mapping live berubah pada tahap proses berikutnya.
  const verifiedSnapshotComplete = Boolean(header.verified_at) && total > 0 && scanned === total
  const allScanned = verifiedSnapshotComplete || liveAllScanned
  const printed = Boolean(header.printed_at)

  return {
    ...header,
    id: Number(header.id),
    created_by: Number(header.created_by),
    handover_id: header.handover_id ? Number(header.handover_id) : null,
    summary: {
      total_keys: total,
      mapped_keys: mapped,
      missing_mapping: Math.max(0, total - mapped),
      scanned_keys: scanned,
      remaining_keys: Math.max(0, total - scanned),
      unavailable_keys: unavailable,
      all_scanned: allScanned,
      printed,
      can_print: verifiedSnapshotComplete && hasReplenishReachedApproval(header.status),
      can_submit: liveAllScanned,
    },
    items,
  }
}

async function getLockedWorkOrder(executor, workOrderId, scopeCodeUker) {
  const result = await new sql.Request(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("scopeCodeUker", sql.NVarChar(4), scopeCodeUker)
    .query(`
      SELECT TOP (1)
        wo.id, wo.work_order_no, wo.status, wo.created_by, wo.uker_id, mu.codeuker
      FROM dbo.replenish_work_orders wo WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN dbo.master_uker mu ON mu.id = wo.uker_id
      WHERE wo.id = @workOrderId
        AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker);
    `)
  return result.recordset[0] || null
}

async function getOrCreateHandover(executor, workOrderId, userId) {
  const result = await new sql.Request(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("userId", sql.Int, userId)
    .query(`
      IF NOT EXISTS (
        SELECT 1
        FROM dbo.replenish_key_handovers WITH (UPDLOCK, HOLDLOCK)
        WHERE work_order_id = @workOrderId
      )
      BEGIN
        INSERT INTO dbo.replenish_key_handovers(work_order_id, created_by)
        VALUES (@workOrderId, @userId);
      END;

      SELECT TOP (1) id, receipt_no, verified_at, printed_at
      FROM dbo.replenish_key_handovers WITH (UPDLOCK, HOLDLOCK)
      WHERE work_order_id = @workOrderId;
    `)
  return result.recordset[0] || null
}

async function updateVerificationState(executor, handoverId, workOrderId, userId) {
  const result = await new sql.Request(executor)
    .input("handoverId", sql.BigInt, handoverId)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("userId", sql.Int, userId)
    .query(`
      DECLARE @expected INT = 0;
      DECLARE @mapped INT = 0;
      DECLARE @scanned INT = 0;
      DECLARE @unavailable INT = 0;

      SELECT
        @expected = COUNT(1),
        @mapped = COALESCE(SUM(CASE WHEN mapping.id IS NOT NULL THEN 1 ELSE 0 END), 0),
        @scanned = COALESCE(SUM(CASE WHEN item.id IS NOT NULL THEN 1 ELSE 0 END), 0),
        @unavailable = COALESCE(SUM(CASE
          WHEN mapping.id IS NOT NULL
           AND mapping.status <> 'IN'
           AND ISNULL(mapping.current_work_order_id, 0) <> @workOrderId
          THEN 1 ELSE 0 END), 0)
      FROM dbo.replenish_work_order_points point
      LEFT JOIN dbo.machine_key_mappings mapping
        ON mapping.machine_id = point.machine_id
       AND mapping.key_type = 'REPLENISH'
      LEFT JOIN dbo.replenish_key_handover_items item
        ON item.handover_id = @handoverId
       AND item.work_order_point_id = point.id
       AND item.machine_key_mapping_id = mapping.id
       AND item.barcode_snapshot = mapping.barcode
      WHERE point.work_order_id = @workOrderId;

      IF @expected > 0 AND @expected = @mapped AND @expected = @scanned AND @unavailable = 0
      BEGIN
        UPDATE dbo.replenish_key_handovers
        SET
          verified_at = COALESCE(verified_at, SYSDATETIME()),
          verified_by = CASE WHEN verified_at IS NULL THEN @userId ELSE verified_by END,
          updated_at = SYSDATETIME()
        WHERE id = @handoverId;
      END
      ELSE
      BEGIN
        UPDATE dbo.replenish_key_handovers
        SET verified_at = NULL, verified_by = NULL, printed_at = NULL, printed_by = NULL,
            updated_at = SYSDATETIME()
        WHERE id = @handoverId;
      END;

      SELECT @expected AS expected_count, @mapped AS mapped_count,
             @scanned AS scanned_count, @unavailable AS unavailable_count;
    `)
  return result.recordset[0] || {}
}

export async function GET(request, context) {
  const authorization = await authorizeTransaction(request, "view")
  if (!authorization.authorized) return authorization.response

  const { id } = await context.params
  const workOrderId = normalizeId(id)
  if (!workOrderId) return errorResponse("ID work order tidak valid.")

  try {
    const db = await connectDB()
    if (!(await ensureSchema(db))) {
      return errorResponse("Fitur QR Serah Terima Kunci belum siap. Jalankan migration 038 dan 053 terlebih dahulu.", 503)
    }
    const scope = getUserDataScope(authorization.user)
    const snapshot = await loadSnapshot(db, workOrderId, scope.isSuperAdmin ? null : scope.codeUker)
    if (!snapshot) return errorResponse("Work order tidak ditemukan.", 404)

    const isOwner = Number(snapshot.created_by) === Number(authorization.user.id)
    const [canCreateTransaction, canUpdateTransaction] = scope.isSuperAdmin
      ? [true, true]
      : await Promise.all([
          hasMenuAccess(authorization.user.role_id, "/transactions", "create"),
          hasMenuAccess(authorization.user.role_id, "/transactions", "update"),
        ])
    snapshot.capabilities = {
      can_print_key_handover: Boolean(
        scope.isSuperAdmin ||
        isOwner ||
        isReplenishKeyHandoverPrinter(authorization.user) ||
        canCreateTransaction ||
        canUpdateTransaction
      ),
    }

    // Sama seperti pola Surat Tugas: saat detail dibuka, baca metadata PDF
    // tersimpan terlebih dahulu. PDF hanya dianggap dapat dipakai ulang bila
    // hash dokumennya masih sama dengan snapshot verifikasi saat ini.
    let storedPdfStatus = emptyKeyHandoverPdfMetadata(workOrderId)
    const existingPdf = await readStoredKeyHandoverPdf(workOrderId)
    if (existingPdf) {
      const canAccessPdf = canAccessStoredKeyHandoverPdf(existingPdf, scope)
      let currentDocumentHash = null
      if (canAccessPdf && snapshot.summary?.can_print) {
        try {
          currentDocumentHash = hashKeyHandoverDocument(snapshot)
        } catch {
          currentDocumentHash = null
        }
      }

      storedPdfStatus = existingPdf.document_hash === currentDocumentHash
        && existingPdf.template_version >= KEY_HANDOVER_PDF_TEMPLATE_VERSION
        ? keyHandoverPdfMetadata(request, existingPdf, snapshot)
        : emptyKeyHandoverPdfMetadata(workOrderId, { stale: true })
    }

    return NextResponse.json({
      success: true,
      data: {
        key_handover: snapshot,
        key_handover_pdf: storedPdfStatus,
      },
    })
  } catch (error) {
    console.error("GET replenish key handover error:", error)
    const detail = process.env.NODE_ENV === "production" ? "" : ` Detail: ${error.message}`
    return errorResponse(`Gagal mengambil pengecekan kunci.${detail}`, 500)
  }
}

export async function POST(request, context) {
  const mutationAuthorization = await authorizeTransactionAny(request, ["update", "create"])
  const hasMutationPermission = Boolean(mutationAuthorization.authorized)

  // Jika role tidak memiliki create/update generik, tetap izinkan jalur pemeriksaan
  // khusus cetak untuk owner atau role pencetak yang eksplisit. authorizeTransactionAny
  // sudah menjalankan same-origin validation; view authorization memastikan user
  // memang boleh membuka modul Transactions.
  let authorization = mutationAuthorization
  if (!hasMutationPermission) {
    if (mutationAuthorization.response?.status !== 403 || !mutationAuthorization.user) {
      return mutationAuthorization.response
    }
    const viewAuthorization = await authorizeTransaction(request, "view")
    if (!viewAuthorization.authorized) return viewAuthorization.response
    authorization = viewAuthorization
  }

  const { id } = await context.params
  const workOrderId = normalizeId(id)
  if (!workOrderId) return errorResponse("ID work order tidak valid.")

  const parsed = await readBody(request)
  if (parsed.response) return parsed.response
  const action = normalizeAction(parsed.body.action)
  if (!new Set(["SCAN", "RESET", "PREPARE_PRINT", "MARK_PRINTED"]).has(action)) {
    return errorResponse("Aksi pengecekan kunci tidak valid.")
  }
  const isScanActionRequest = action === "SCAN" || action === "RESET"
  if (isScanActionRequest && !hasMutationPermission) {
    return mutationAuthorization.response
  }

  const db = await connectDB()
  if (!(await ensureSchema(db))) {
    return errorResponse("Fitur QR Serah Terima Kunci belum siap. Jalankan migration 038 dan 053 terlebih dahulu.", 503)
  }

  const transaction = new sql.Transaction(db)
  let finished = false
  try {
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
    const scope = getUserDataScope(authorization.user)
    const current = await getLockedWorkOrder(
      transaction,
      workOrderId,
      scope.isSuperAdmin ? null : scope.codeUker
    )

    if (!current) {
      await transaction.rollback()
      finished = true
      return errorResponse("Work order tidak ditemukan.", 404)
    }
    const isScanAction = action === "SCAN" || action === "RESET"
    const isPrintAction = action === "PREPARE_PRINT" || action === "MARK_PRINTED"
    if (isScanAction && !SCANNABLE_STATUSES.has(current.status)) {
      await transaction.rollback()
      finished = true
      return errorResponse("Pengecekan kunci hanya dapat dilakukan pada work order Draft atau Ditolak.", 409)
    }
    if (isPrintAction && !hasReplenishReachedApproval(current.status)) {
      await transaction.rollback()
      finished = true
      return errorResponse(
        "Serah Terima Kunci hanya dapat dicetak setelah Work Order pernah disetujui Manager Operasional / Asisten Manager CRO.",
        409
      )
    }
    const isOwner = Number(current.created_by) === Number(authorization.user.id)
    if (isScanAction && !scope.isSuperAdmin && !isOwner) {
      await transaction.rollback()
      finished = true
      return errorResponse("Scan kunci hanya dapat dilakukan oleh Admin CRO pembuat Work Order.", 403)
    }
    if (
      isPrintAction &&
      !scope.isSuperAdmin &&
      !isOwner &&
      !hasMutationPermission &&
      !isReplenishKeyHandoverPrinter(authorization.user)
    ) {
      await transaction.rollback()
      finished = true
      return errorResponse("Anda tidak memiliki akses cetak Serah Terima Kunci untuk Work Order ini.", 403)
    }

    const handover = await getOrCreateHandover(transaction, workOrderId, authorization.user.id)
    if (!handover?.id) throw new Error("Header serah terima kunci tidak dapat dibuat.")

    let message = ""
    if (action === "SCAN") {
      const assignmentLetter = await getAssignmentLetterByWorkOrder(
        transaction,
        workOrderId,
        scope.isSuperAdmin ? null : scope.codeUker
      )
      if (
        !assignmentLetter?.id ||
        !assignmentLetter.payload_valid ||
        assignmentLetter.status !== "MENUNGGU_PERSETUJUAN"
      ) {
        await transaction.rollback()
        finished = true
        return errorResponse(
          "Selesaikan Surat Tugas terlebih dahulu sebelum melakukan scan kunci.",
          409
        )
      }

      const barcode = normalizeBarcode(parsed.body.barcode)
      if (!BARCODE_PATTERN.test(barcode)) {
        await transaction.rollback()
        finished = true
        return errorResponse("Barcode kunci tidak valid. Scan ulang label sling kunci.")
      }

      const matchResult = await new sql.Request(transaction)
        .input("workOrderId", sql.BigInt, workOrderId)
        .input("barcode", sql.VarChar(64), barcode)
        .query(`
          SELECT TOP (1)
            point.id AS work_order_point_id,
            point.machine_id,
            machine.tid,
            machine.sn,
            machine.lokasi,
            mapping.id AS machine_key_mapping_id,
            mapping.barcode,
            mapping.status,
            mapping.current_work_order_id,
            mapping.matrix_wall,
            mapping.matrix_column,
            mapping.matrix_row
          FROM dbo.machine_key_mappings mapping WITH (UPDLOCK, HOLDLOCK)
          INNER JOIN dbo.replenish_work_order_points point
            ON point.machine_id = mapping.machine_id
           AND point.work_order_id = @workOrderId
          INNER JOIN dbo.master_mesin machine ON machine.id = point.machine_id
          WHERE mapping.barcode = @barcode
            AND mapping.key_type = 'REPLENISH';

          SELECT TOP (1)
            mapping.machine_id,
            machine.tid,
            machine.sn,
            machine.lokasi
          FROM dbo.machine_key_mappings mapping
          INNER JOIN dbo.master_mesin machine ON machine.id = mapping.machine_id
          WHERE mapping.barcode = @barcode;
        `)

      const match = matchResult.recordsets?.[0]?.[0] || null
      const other = matchResult.recordsets?.[1]?.[0] || null
      if (!match) {
        await transaction.rollback()
        finished = true
        return errorResponse(
          other
            ? `Data scan tidak sesuai Work Order. Kunci ${barcode} terdaftar untuk TID ${other.tid || other.sn || other.machine_id}, tetapi ATM/CRM tersebut tidak ada pada Work Order ini.`
            : `Data scan tidak sesuai. Barcode ${barcode} tidak ditemukan pada mapping kunci mesin.`,
          409
        )
      }
      if (match.status !== "IN" && Number(match.current_work_order_id) !== Number(workOrderId)) {
        await transaction.rollback()
        finished = true
        return errorResponse(`Kunci ${barcode} sedang berstatus OUT pada transaksi lain.`, 409)
      }

      const existingResult = await new sql.Request(transaction)
        .input("handoverId", sql.BigInt, handover.id)
        .input("pointId", sql.BigInt, match.work_order_point_id)
        .input("mappingId", sql.BigInt, match.machine_key_mapping_id)
        .query(`
          SELECT TOP (1) id, barcode_snapshot
          FROM dbo.replenish_key_handover_items WITH (UPDLOCK, HOLDLOCK)
          WHERE handover_id = @handoverId
            AND (work_order_point_id = @pointId OR machine_key_mapping_id = @mappingId);
        `)

      const existingScan = existingResult.recordset[0] || null
      if (existingScan?.barcode_snapshot === barcode) {
        message = `Kunci ${barcode} sudah pernah discan untuk work order ini.`
      } else if (existingScan) {
        await new sql.Request(transaction)
          .input("itemId", sql.BigInt, existingScan.id)
          .input("pointId", sql.BigInt, match.work_order_point_id)
          .input("machineId", sql.BigInt, match.machine_id)
          .input("mappingId", sql.BigInt, match.machine_key_mapping_id)
          .input("barcode", sql.VarChar(64), barcode)
          .input("userId", sql.Int, authorization.user.id)
          .input("handoverId", sql.BigInt, handover.id)
          .query(`
            UPDATE dbo.replenish_key_handover_items
            SET work_order_point_id = @pointId, machine_id = @machineId,
                machine_key_mapping_id = @mappingId, barcode_snapshot = @barcode,
                scanned_by = @userId, scanned_at = SYSDATETIME()
            WHERE id = @itemId;

            UPDATE dbo.replenish_key_handovers
            SET printed_at = NULL, printed_by = NULL, updated_at = SYSDATETIME()
            WHERE id = @handoverId;
          `)
        message = `Scan kunci ${barcode} diperbarui sesuai mapping terbaru untuk TID ${match.tid || match.sn || match.machine_id}.`
      } else {
        await new sql.Request(transaction)
          .input("handoverId", sql.BigInt, handover.id)
          .input("pointId", sql.BigInt, match.work_order_point_id)
          .input("machineId", sql.BigInt, match.machine_id)
          .input("mappingId", sql.BigInt, match.machine_key_mapping_id)
          .input("barcode", sql.VarChar(64), barcode)
          .input("userId", sql.Int, authorization.user.id)
          .query(`
            INSERT INTO dbo.replenish_key_handover_items
              (handover_id, work_order_point_id, machine_id, machine_key_mapping_id,
               barcode_snapshot, scanned_by)
            VALUES
              (@handoverId, @pointId, @machineId, @mappingId, @barcode, @userId);

            UPDATE dbo.replenish_key_handovers
            SET printed_at = NULL, printed_by = NULL, updated_at = SYSDATETIME()
            WHERE id = @handoverId;
          `)
        message = `Kunci ${barcode} cocok dengan TID ${match.tid || match.sn || match.machine_id}.`
      }

      const checkoutResult = await new sql.Request(transaction)
        .input("mappingId", sql.BigInt, match.machine_key_mapping_id)
        .input("workOrderId", sql.BigInt, workOrderId)
        .input("userId", sql.Int, authorization.user.id)
        .query(`
          UPDATE dbo.machine_key_mappings
          SET
            status = 'OUT',
            current_work_order_id = @workOrderId,
            checked_out_at = CASE
              WHEN status = 'IN' OR checked_out_at IS NULL THEN SYSDATETIME()
              ELSE checked_out_at
            END,
            checked_in_at = NULL,
            updated_by = @userId,
            updated_at = SYSDATETIME()
          WHERE id = @mappingId
            AND (
              status = 'IN'
              OR (status = 'OUT' AND current_work_order_id = @workOrderId)
            );

          SELECT @@ROWCOUNT AS affected_rows;
        `)

      if (Number(checkoutResult.recordset[0]?.affected_rows || 0) !== 1) {
        await transaction.rollback()
        finished = true
        return errorResponse("Kunci tidak dapat ditandai keluar. Muat ulang data mapping lalu scan kembali.", 409)
      }

      const verification = await updateVerificationState(
        transaction,
        handover.id,
        workOrderId,
        authorization.user.id
      )
      if (Number(verification.expected_count) > 0 && Number(verification.scanned_count) === Number(verification.expected_count)) {
        message += " Seluruh kunci telah terverifikasi."
      }

      await insertAuditLog(transaction, {
        request,
        userId: authorization.user.id,
        action: "KEY_SCAN",
        module: "transactions.replenish.key-handover",
        entityType: "replenish_work_order",
        entityId: workOrderId,
        metadata: { work_order_no: current.work_order_no, barcode, machine_id: Number(match.machine_id) },
      })
    } else if (action === "RESET") {
      await new sql.Request(transaction)
        .input("handoverId", sql.BigInt, handover.id)
        .input("workOrderId", sql.BigInt, workOrderId)
        .input("userId", sql.Int, authorization.user.id)
        .query(`
          UPDATE mapping
          SET
            status = 'IN',
            current_work_order_id = NULL,
            checked_in_at = SYSDATETIME(),
            updated_by = @userId,
            updated_at = SYSDATETIME()
          FROM dbo.machine_key_mappings mapping
          INNER JOIN dbo.replenish_key_handover_items item
            ON item.machine_key_mapping_id = mapping.id
          WHERE item.handover_id = @handoverId
            AND mapping.status = 'OUT'
            AND mapping.current_work_order_id = @workOrderId;

          DELETE FROM dbo.replenish_key_handover_items WHERE handover_id = @handoverId;
          UPDATE dbo.replenish_key_handovers
          SET receipt_no = NULL, verified_at = NULL, verified_by = NULL,
              printed_at = NULL, printed_by = NULL,
              verification_token = NULL, approved_at = NULL, approved_by = NULL,
              giver_name_snapshot = NULL, giver_nip_snapshot = NULL, giver_position_snapshot = NULL,
              recipient_name_snapshot = NULL, recipient_nip_snapshot = NULL, recipient_position_snapshot = NULL,
              document_hash = NULL, approval_hash = NULL,
              updated_at = SYSDATETIME()
          WHERE id = @handoverId;
        `)
      message = "Pengecekan kunci direset. Seluruh kunci harus discan ulang."
      await insertAuditLog(transaction, {
        request,
        userId: authorization.user.id,
        action: "KEY_SCAN_RESET",
        module: "transactions.replenish.key-handover",
        entityType: "replenish_work_order",
        entityId: workOrderId,
        metadata: { work_order_no: current.work_order_no },
      })
    } else {
      // PREPARE_PRINT / MARK_PRINTED berjalan setelah approval. Pada tahap ini
      // gunakan snapshot verifikasi yang sudah dibekukan saat submit, bukan
      // menghitung ulang terhadap mapping kunci live yang dapat berubah ketika
      // workflow berlanjut (misalnya CPC Receive Request).
      const verifiedSnapshot = await loadSnapshot(
        transaction,
        workOrderId,
        scope.isSuperAdmin ? null : scope.codeUker
      )
      const expected = Number(verifiedSnapshot?.summary?.total_keys || 0)
      const scanned = Number(verifiedSnapshot?.summary?.scanned_keys || 0)

      if (expected === 0) {
        await transaction.rollback()
        finished = true
        return errorResponse("Work order belum memiliki ATM/CRM untuk diverifikasi.", 409)
      }
      if (!verifiedSnapshot?.verified_at || scanned !== expected) {
        await transaction.rollback()
        finished = true
        return errorResponse(
          `Snapshot verifikasi Serah Terima Kunci belum lengkap. ${Math.max(0, expected - scanned)} kunci masih belum memiliki bukti scan.`,
          409
        )
      }

      if (action === "PREPARE_PRINT") {
        await new sql.Request(transaction)
          .input("handoverId", sql.BigInt, handover.id)
          .input("receiptNo", sql.VarChar(50), `STK-${current.work_order_no}`)
          .query(`
            UPDATE dbo.replenish_key_handovers
            SET receipt_no = COALESCE(receipt_no, @receiptNo), updated_at = SYSDATETIME()
            WHERE id = @handoverId;
          `)
        message = "Dokumen PDF Serah Terima Kunci siap dibentuk."
      } else {
        // MARK_PRINTED hanya sah jika PDF server-side yang immutable sudah ada
        // dan hash snapshot-nya masih sama dengan data serah terima saat ini.
        await new sql.Request(transaction)
          .input("handoverId", sql.BigInt, handover.id)
          .input("receiptNo", sql.VarChar(50), `STK-${current.work_order_no}`)
          .query(`
            UPDATE dbo.replenish_key_handovers
            SET receipt_no = COALESCE(receipt_no, @receiptNo), updated_at = SYSDATETIME()
            WHERE id = @handoverId;
          `)

        const confirmationSnapshot = await loadSnapshot(
          transaction,
          workOrderId,
          scope.isSuperAdmin ? null : scope.codeUker
        )
        const confirmationDocumentHash = hashKeyHandoverDocument(confirmationSnapshot)
        const confirmationApprovalHash = createKeyHandoverApprovalHash({
          documentHash: confirmationDocumentHash,
          verificationToken: confirmationSnapshot.verification_token,
          approvedBy: confirmationSnapshot.handover_approved_by,
          approvedAt: confirmationSnapshot.handover_approved_at,
        })
        const storedPdf = await readStoredKeyHandoverPdf(workOrderId)
        if (
          !storedPdf
          || storedPdf.document_hash !== confirmationDocumentHash
          || confirmationSnapshot.document_hash !== confirmationDocumentHash
          || confirmationSnapshot.approval_hash !== confirmationApprovalHash
        ) {
          await transaction.rollback()
          finished = true
          return errorResponse(
            "Bentuk dan buka PDF Serah Terima Kunci terbaru sebelum mengonfirmasi hasil cetak.",
            409
          )
        }

        await new sql.Request(transaction)
          .input("handoverId", sql.BigInt, handover.id)
          .input("userId", sql.Int, authorization.user.id)
          .query(`
            UPDATE dbo.replenish_key_handovers
            SET printed_at = SYSDATETIME(), printed_by = @userId, updated_at = SYSDATETIME()
            WHERE id = @handoverId;
          `)
        message = "Serah Terima Kunci telah dikonfirmasi tercetak setelah Work Order disetujui."
        const printedSnapshot = await loadSnapshot(
          transaction,
          workOrderId,
          scope.isSuperAdmin ? null : scope.codeUker
        )
        await insertAuditLog(transaction, {
          request,
          userId: authorization.user.id,
          action: "KEY_HANDOVER_PRINT",
          module: "transactions.replenish.key-handover",
          entityType: "replenish_work_order",
          entityId: workOrderId,
          metadata: {
            work_order_no: current.work_order_no,
            receipt_no: storedPdf.receipt_no,
            document_hash: storedPdf.document_hash,
            pdf_hash: storedPdf.pdf_hash,
            file_name: storedPdf.file_name,
            total_keys: expected,
            custody: printedSnapshot?.custody_name || null,
            verified_by: printedSnapshot?.verified_by_name || null,
            keys: (printedSnapshot?.items || []).map((item) => ({
              machine_id: item.machine_id,
              tid: item.tid || null,
              sn: item.sn || null,
              lokasi: item.lokasi || null,
              position: item.position || null,
              barcode: item.barcode_snapshot || null,
            })),
          },
        })
      }
    }

    await transaction.commit()
    finished = true

    let snapshot = await loadSnapshot(db, workOrderId, scope.isSuperAdmin ? null : scope.codeUker)
    if (snapshot) {
      snapshot.capabilities = {
        can_print_key_handover: Boolean(
          scope.isSuperAdmin ||
          Number(snapshot.created_by) === Number(authorization.user.id) ||
          hasMutationPermission ||
          isReplenishKeyHandoverPrinter(authorization.user)
        ),
      }
    }
    let storedPdf = null

    if (action === "PREPARE_PRINT") {
      const documentHash = hashKeyHandoverDocument(snapshot)
      const existingPdf = await readStoredKeyHandoverPdf(workOrderId)
      const templateNeedsRefresh = Boolean(
        existingPdf && existingPdf.template_version < KEY_HANDOVER_PDF_TEMPLATE_VERSION
      )
      if (existingPdf && existingPdf.document_hash !== documentHash && !templateNeedsRefresh) {
        return errorResponse(
          "PDF Serah Terima Kunci yang tersimpan tidak sama dengan snapshot verifikasi saat ini. Dokumen tidak ditimpa otomatis untuk menjaga integritas audit.",
          409
        )
      }

      const reusedStoredPdf = Boolean(existingPdf && !templateNeedsRefresh)
      if (reusedStoredPdf) {
        storedPdf = existingPdf
        message = "File PDF Serah Terima Kunci sudah tersedia dan siap dicetak ulang."
      } else {
        const verificationUrl = keyHandoverVerificationUrl(request, snapshot.verification_token)
        const pdfBuffer = generateKeyHandoverPdf(snapshot, { verificationUrl })
        const pdfHash = hashKeyHandoverPdfBuffer(pdfBuffer)
        storedPdf = await writeStoredKeyHandoverPdf(workOrderId, pdfBuffer, {
          receipt_no: snapshot.receipt_no,
          codeuker: snapshot.codeuker,
          owner_user_id: snapshot.created_by,
          document_hash: documentHash,
          template_version: KEY_HANDOVER_PDF_TEMPLATE_VERSION,
          pdf_hash: pdfHash,
          generated_at: new Date().toISOString(),
          generated_by: authorization.user.id,
        }, {
          replaceTemplate: templateNeedsRefresh,
          replaceDocumentForTemplateUpgrade: templateNeedsRefresh,
        })
        message = templateNeedsRefresh
          ? "Format PDF Serah Terima Kunci berhasil diperbarui ke template terbaru dan siap dicetak."
          : "File PDF Serah Terima Kunci berhasil dibentuk, di-hash, dan disimpan pada private storage."
      }

      const approvalHash = createKeyHandoverApprovalHash({
        documentHash,
        verificationToken: snapshot.verification_token,
        approvedBy: snapshot.handover_approved_by,
        approvedAt: snapshot.handover_approved_at,
      })
      await new sql.Request(db)
        .input("workOrderId", sql.BigInt, workOrderId)
        .input("documentHash", sql.Char(64), documentHash)
        .input("approvalHash", sql.Char(64), approvalHash)
        .input("verificationToken", sql.UniqueIdentifier, snapshot.verification_token)
        .query(`
          UPDATE dbo.replenish_key_handovers
          SET document_hash = @documentHash,
              approval_hash = @approvalHash,
              updated_at = SYSDATETIME()
          WHERE work_order_id = @workOrderId
            AND verification_token = @verificationToken;

          IF @@ROWCOUNT <> 1
            THROW 55303, 'Hash QR Serah Terima Kunci gagal disimpan.', 1;
        `)
      snapshot = await loadSnapshot(db, workOrderId, scope.isSuperAdmin ? null : scope.codeUker)

      // Audit dilakukan juga saat file direuse. Ini membuat retry setelah kegagalan
      // audit tetap meninggalkan jejak tanpa perlu menimpa PDF immutable.
      await insertAuditLog(db, {
        request,
        userId: authorization.user.id,
        action: "GENERATE_PDF",
        module: "transactions.replenish.key-handover",
        entityType: "replenish_key_handover",
        entityId: snapshot.handover_id,
        metadata: {
          work_order_id: workOrderId,
          work_order_no: snapshot.work_order_no,
          receipt_no: snapshot.receipt_no,
          document_hash: storedPdf.document_hash,
          template_version: storedPdf.template_version,
          pdf_hash: storedPdf.pdf_hash,
          file_name: storedPdf.file_name,
          total_keys: snapshot.summary?.total_keys || 0,
          reused_stored_pdf: reusedStoredPdf,
        },
      })
    } else if (action === "MARK_PRINTED") {
      // Kembalikan metadata file yang sama setelah konfirmasi cetak agar UI
      // tetap membaca PDF tersimpan tanpa menjalankan PREPARE_PRINT kembali.
      storedPdf = await readStoredKeyHandoverPdf(workOrderId)
    }

    return NextResponse.json({
      success: true,
      message,
      data: {
        key_handover: snapshot,
        key_handover_pdf: keyHandoverPdfMetadata(request, storedPdf, snapshot),
      },
    })
  } catch (error) {
    if (!finished) {
      try { await transaction.rollback() } catch { /* transaction may already be rolled back */ }
    }
    console.error("POST replenish key handover error:", error)
    const detail = process.env.NODE_ENV === "production" ? "" : ` Detail: ${error.message}`
    return errorResponse(`Gagal memproses pengecekan kunci.${detail}`, 500)
  }
}
