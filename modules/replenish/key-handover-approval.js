import "server-only"

import { sql } from "@/lib/mssql"

export async function freezeApprovedKeyHandover(executor, {
  workOrderId,
  approvedBy,
  approvedAt,
}) {
  const result = await new sql.Request(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("approvedBy", sql.Int, approvedBy)
    .input("approvedAt", sql.DateTime2(0), approvedAt)
    .query(`
      SET NOCOUNT ON;

      UPDATE handover
      SET
        verification_token = COALESCE(handover.verification_token, NEWID()),
        approved_by = COALESCE(handover.approved_by, @approvedBy),
        approved_at = COALESCE(handover.approved_at, @approvedAt),
        giver_name_snapshot = COALESCE(
          NULLIF(handover.giver_name_snapshot, N''),
          NULLIF(verifier.full_name, N''),
          N'Petugas Admin CRO'
        ),
        giver_nip_snapshot = COALESCE(NULLIF(handover.giver_nip_snapshot, ''), verifier_employee.nip),
        giver_position_snapshot = COALESCE(
          NULLIF(handover.giver_position_snapshot, N''),
          NULLIF(verifier_employee.jabatan, N''),
          NULLIF(verifier_role.role_name, N''),
          N'Admin CRO'
        ),
        recipient_name_snapshot = COALESCE(
          NULLIF(handover.recipient_name_snapshot, N''),
          NULLIF(custody.nama, N''),
          N'Custody'
        ),
        recipient_nip_snapshot = COALESCE(NULLIF(handover.recipient_nip_snapshot, ''), custody.nip),
        recipient_position_snapshot = COALESCE(
          NULLIF(handover.recipient_position_snapshot, N''),
          NULLIF(custody.jabatan, N''),
          N'Custody'
        ),
        document_hash = NULL,
        approval_hash = NULL,
        updated_at = SYSDATETIME()
      FROM dbo.replenish_key_handovers handover
      INNER JOIN dbo.replenish_work_orders work_order
        ON work_order.id = handover.work_order_id
      LEFT JOIN dbo.users verifier ON verifier.id = handover.verified_by
      LEFT JOIN dbo.roles verifier_role ON verifier_role.id = verifier.role_id
      LEFT JOIN dbo.pegawai verifier_employee ON verifier_employee.id = verifier.pegawai_id
      OUTER APPLY
      (
        SELECT TOP (1) employee.nip, employee.nama, employee.jabatan
        FROM dbo.replenish_team_members member
        INNER JOIN dbo.pegawai employee ON employee.id = member.employee_id
        WHERE member.work_order_id = work_order.id
          AND member.member_role = 'CUSTODY'
        ORDER BY member.id
      ) custody
      WHERE handover.work_order_id = @workOrderId
        AND handover.verified_at IS NOT NULL;

      IF @@ROWCOUNT <> 1
        THROW 55302,
          'Serah Terima Kunci belum terverifikasi sehingga QR approval tidak dapat dibentuk.',
          1;

      SELECT TOP (1)
        handover.id,
        CONVERT(VARCHAR(36), handover.verification_token) AS verification_token,
        handover.giver_name_snapshot,
        handover.giver_position_snapshot,
        handover.recipient_name_snapshot,
        handover.recipient_position_snapshot
      FROM dbo.replenish_key_handovers handover
      WHERE handover.work_order_id = @workOrderId;
    `)

  const row = result.recordset[0]
  if (!row?.verification_token) throw new Error("Token QR Serah Terima Kunci tidak berhasil dibentuk.")
  return row
}
