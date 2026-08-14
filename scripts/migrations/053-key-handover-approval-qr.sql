SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.replenish_key_handovers', N'U') IS NULL
    THROW 55301, 'Tabel dbo.replenish_key_handovers belum tersedia. Jalankan migration 038 terlebih dahulu.', 1;

  IF COL_LENGTH(N'dbo.replenish_key_handovers', N'verification_token') IS NULL
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.replenish_key_handovers
        ADD verification_token UNIQUEIDENTIFIER NULL;
    ';

  IF COL_LENGTH(N'dbo.replenish_key_handovers', N'approved_by') IS NULL
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.replenish_key_handovers
        ADD approved_by INT NULL;
    ';

  IF COL_LENGTH(N'dbo.replenish_key_handovers', N'approved_at') IS NULL
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.replenish_key_handovers
        ADD approved_at DATETIME2(0) NULL;
    ';

  IF COL_LENGTH(N'dbo.replenish_key_handovers', N'giver_name_snapshot') IS NULL
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.replenish_key_handovers
        ADD giver_name_snapshot NVARCHAR(150) NULL;
    ';

  IF COL_LENGTH(N'dbo.replenish_key_handovers', N'giver_nip_snapshot') IS NULL
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.replenish_key_handovers
        ADD giver_nip_snapshot VARCHAR(50) NULL;
    ';

  IF COL_LENGTH(N'dbo.replenish_key_handovers', N'giver_position_snapshot') IS NULL
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.replenish_key_handovers
        ADD giver_position_snapshot NVARCHAR(150) NULL;
    ';

  IF COL_LENGTH(N'dbo.replenish_key_handovers', N'recipient_name_snapshot') IS NULL
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.replenish_key_handovers
        ADD recipient_name_snapshot NVARCHAR(150) NULL;
    ';

  IF COL_LENGTH(N'dbo.replenish_key_handovers', N'recipient_nip_snapshot') IS NULL
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.replenish_key_handovers
        ADD recipient_nip_snapshot VARCHAR(50) NULL;
    ';

  IF COL_LENGTH(N'dbo.replenish_key_handovers', N'recipient_position_snapshot') IS NULL
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.replenish_key_handovers
        ADD recipient_position_snapshot NVARCHAR(150) NULL;
    ';

  IF COL_LENGTH(N'dbo.replenish_key_handovers', N'document_hash') IS NULL
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.replenish_key_handovers
        ADD document_hash CHAR(64) NULL;
    ';

  IF COL_LENGTH(N'dbo.replenish_key_handovers', N'approval_hash') IS NULL
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.replenish_key_handovers
        ADD approval_hash CHAR(64) NULL;
    ';

  IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID(N'dbo.replenish_key_handovers')
      AND name = N'FK_replenish_key_handover_approved_by'
  )
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.replenish_key_handovers WITH CHECK
        ADD CONSTRAINT FK_replenish_key_handover_approved_by
        FOREIGN KEY (approved_by) REFERENCES dbo.users(id);
    ';

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.replenish_key_handovers')
      AND name = N'UX_replenish_key_handover_verification_token'
  )
    EXEC sys.sp_executesql N'
      CREATE UNIQUE INDEX UX_replenish_key_handover_verification_token
        ON dbo.replenish_key_handovers(verification_token)
        WHERE verification_token IS NOT NULL;
    ';

  /*
    Backfill Work Order lama yang sudah disetujui. Identitas pihak dibekukan
    dari data yang berlaku saat migration dijalankan. Hash dokumen/approval
    akan diisi ketika PDF template QR dibentuk pertama kali.
  */
  EXEC sys.sp_executesql N'
    UPDATE handover
    SET
      verification_token = COALESCE(handover.verification_token, NEWID()),
      approved_by = COALESCE(handover.approved_by, work_order.approved_by),
      approved_at = COALESCE(handover.approved_at, work_order.approved_at),
      giver_name_snapshot = COALESCE(
        NULLIF(handover.giver_name_snapshot, N''''),
        NULLIF(verifier.full_name, N''''),
        N''Petugas Admin CRO''
      ),
      giver_nip_snapshot = COALESCE(
        NULLIF(handover.giver_nip_snapshot, ''''),
        verifier_employee.nip
      ),
      giver_position_snapshot = COALESCE(
        NULLIF(handover.giver_position_snapshot, N''''),
        NULLIF(verifier_employee.jabatan, N''''),
        NULLIF(verifier_role.role_name, N''''),
        N''Admin CRO''
      ),
      recipient_name_snapshot = COALESCE(
        NULLIF(handover.recipient_name_snapshot, N''''),
        NULLIF(custody.nama, N''''),
        N''Custody''
      ),
      recipient_nip_snapshot = COALESCE(
        NULLIF(handover.recipient_nip_snapshot, ''''),
        custody.nip
      ),
      recipient_position_snapshot = COALESCE(
        NULLIF(handover.recipient_position_snapshot, N''''),
        NULLIF(custody.jabatan, N''''),
        N''Custody''
      ),
      updated_at = SYSDATETIME()
    FROM dbo.replenish_key_handovers handover
    INNER JOIN dbo.replenish_work_orders work_order
      ON work_order.id = handover.work_order_id
    LEFT JOIN dbo.users verifier
      ON verifier.id = handover.verified_by
    LEFT JOIN dbo.roles verifier_role
      ON verifier_role.id = verifier.role_id
    LEFT JOIN dbo.pegawai verifier_employee
      ON verifier_employee.id = verifier.pegawai_id
    OUTER APPLY
    (
      SELECT TOP (1)
        employee.nip,
        employee.nama,
        employee.jabatan
      FROM dbo.replenish_team_members member
      INNER JOIN dbo.pegawai employee
        ON employee.id = member.employee_id
      WHERE member.work_order_id = work_order.id
        AND member.member_role = ''CUSTODY''
      ORDER BY member.id
    ) custody
    WHERE handover.verified_at IS NOT NULL
      AND work_order.approved_at IS NOT NULL;
  ';

  COMMIT TRANSACTION;

  SELECT 'Migration 053 QR approval Serah Terima Kunci berhasil dijalankan.' AS message;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
