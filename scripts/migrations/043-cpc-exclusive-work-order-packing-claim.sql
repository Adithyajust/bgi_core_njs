SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.cpc_packing_batches', N'U') IS NULL
    THROW 54301, 'Tabel dbo.cpc_packing_batches belum tersedia. Jalankan migration 039 terlebih dahulu.', 1;

  IF OBJECT_ID(N'dbo.cpc_packing_tid_assets', N'U') IS NULL
    THROW 54302, 'Tabel dbo.cpc_packing_tid_assets belum tersedia. Jalankan migration 041 dan 042 terlebih dahulu.', 1;

  IF OBJECT_ID(N'dbo.users', N'U') IS NULL
    THROW 54303, 'Tabel dbo.users belum tersedia.', 1;

  /*
    Exclusive packing claim per Work Order.

    Satu Work Order CPC hanya boleh memiliki satu operator packing aktif. Begitu
    operator mengambil/memulai packing, seluruh TID pada batch tersebut mengikuti
    owner Work Order yang sama. Kolom assignment per TID tetap dipertahankan untuk
    histori/audit dan kompatibilitas, tetapi tidak lagi dipakai untuk membagi satu
    Work Order ke beberapa operator biasa.
  */
  IF COL_LENGTH(N'dbo.cpc_packing_batches', N'packing_owner_user_id') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_batches ADD packing_owner_user_id INT NULL;
    ';
  END;

  IF COL_LENGTH(N'dbo.cpc_packing_batches', N'packing_claimed_at') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_batches ADD packing_claimed_at DATETIME2(0) NULL;
    ';
  END;

  /*
    Backfill aman untuk data sebelum exclusive claim:
    - submitted_by adalah kandidat paling kuat karena dia yang menyelesaikan packing;
    - bila belum submit dan seluruh TID hanya dimiliki satu operator, gunakan operator itu;
    - bila belum ada assignment sama sekali, created_by dipakai sebagai pemilik awal;
    - bila ada lebih dari satu owner TID legacy, owner WO dibiarkan NULL agar tidak
      memilih operator secara arbitrer. Supervisor dapat menyelesaikan lewat alih job.
  */
  EXEC sys.sp_executesql N'
    ;WITH assignee_summary AS (
      SELECT
        batch.id AS batch_id,
        COUNT(DISTINCT asset.assigned_to) AS distinct_assignees,
        MIN(asset.assigned_to) AS single_assignee,
        MIN(asset.assigned_at) AS first_assigned_at
      FROM dbo.cpc_packing_batches batch
      LEFT JOIN dbo.cpc_packing_tid_assets asset
        ON asset.batch_id = batch.id
       AND asset.assigned_to IS NOT NULL
      GROUP BY batch.id
    )
    UPDATE batch
    SET
      packing_owner_user_id = COALESCE(
        batch.submitted_by,
        CASE WHEN summary.distinct_assignees = 1 THEN summary.single_assignee END,
        CASE WHEN summary.distinct_assignees = 0 THEN batch.created_by END
      ),
      packing_claimed_at = CASE
        WHEN batch.submitted_by IS NOT NULL THEN COALESCE(batch.submitted_at, batch.created_at)
        WHEN summary.distinct_assignees = 1 THEN COALESCE(summary.first_assigned_at, batch.created_at)
        WHEN summary.distinct_assignees = 0 THEN batch.created_at
        ELSE NULL
      END
    FROM dbo.cpc_packing_batches batch
    INNER JOIN assignee_summary summary ON summary.batch_id = batch.id
    WHERE batch.packing_owner_user_id IS NULL;
  ';

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_cpc_packing_batches_packing_owner')
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_batches WITH CHECK
        ADD CONSTRAINT FK_cpc_packing_batches_packing_owner
        FOREIGN KEY (packing_owner_user_id) REFERENCES dbo.users(id);
    ';
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.cpc_packing_batches')
      AND name = N'CK_cpc_packing_batches_claim_pair'
  )
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_batches WITH CHECK
        ADD CONSTRAINT CK_cpc_packing_batches_claim_pair
        CHECK (
          (packing_owner_user_id IS NULL AND packing_claimed_at IS NULL)
          OR (packing_owner_user_id IS NOT NULL AND packing_claimed_at IS NOT NULL)
        );
    ';
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.cpc_packing_batches')
      AND name = N'IX_cpc_packing_batches_owner'
  )
  BEGIN
    EXEC sys.sp_executesql N'
      CREATE INDEX IX_cpc_packing_batches_owner
        ON dbo.cpc_packing_batches(packing_owner_user_id, status, work_order_id)
        INCLUDE (packing_claimed_at, updated_at);
    ';
  END;

  COMMIT TRANSACTION;

  SELECT 'Migration 043 exclusive claim packing CPC per Work Order berhasil dijalankan.' AS message;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
