SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.cpc_packing_tid_assets', N'U') IS NULL
    THROW 54201, 'Tabel dbo.cpc_packing_tid_assets belum tersedia. Jalankan migration 041 terlebih dahulu.', 1;

  IF OBJECT_ID(N'dbo.users', N'U') IS NULL
    THROW 54202, 'Tabel dbo.users belum tersedia.', 1;

  /*
    Ownership packing CPC per TID.
    Satu TID hanya dapat memiliki satu operator aktif pada satu waktu.
    Assignment status bersifat operasional dan tidak mengganti status utama Work Order.

    IMPORTANT SQL SERVER:
    Kolom-kolom di bawah ditambahkan dan kemudian dipakai pada migration yang sama.
    Seluruh statement yang mereferensikan kolom baru harus dieksekusi melalui
    sys.sp_executesql agar SQL Server melakukan name resolution setelah ALTER TABLE selesai.
  */
  IF COL_LENGTH(N'dbo.cpc_packing_tid_assets', N'assigned_to') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_tid_assets ADD assigned_to INT NULL;
    ';
  END;

  IF COL_LENGTH(N'dbo.cpc_packing_tid_assets', N'assigned_at') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_tid_assets ADD assigned_at DATETIME2(0) NULL;
    ';
  END;

  IF COL_LENGTH(N'dbo.cpc_packing_tid_assets', N'assignment_status') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_tid_assets ADD assignment_status VARCHAR(20) NULL;
    ';
  END;

  IF COL_LENGTH(N'dbo.cpc_packing_tid_assets', N'started_by') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_tid_assets ADD started_by INT NULL;
    ';
  END;

  IF COL_LENGTH(N'dbo.cpc_packing_tid_assets', N'started_at') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_tid_assets ADD started_at DATETIME2(0) NULL;
    ';
  END;

  IF COL_LENGTH(N'dbo.cpc_packing_tid_assets', N'completed_by') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_tid_assets ADD completed_by INT NULL;
    ';
  END;

  IF COL_LENGTH(N'dbo.cpc_packing_tid_assets', N'completed_at') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_tid_assets ADD completed_at DATETIME2(0) NULL;
    ';
  END;

  /*
    Backfill data legacy. Bila packing sudah pernah dikerjakan sebelum migration
    assignment tersedia, operator terakhir yang tercatat pada asset/kaset uang
    dijadikan owner awal agar histori lama tetap dapat diteruskan.
  */
  EXEC sys.sp_executesql N'
    ;WITH legacy AS (
      SELECT
        asset.id,
        COALESCE(asset.prepared_by, cash_actor.actor_user_id) AS actor_user_id,
        CASE
          WHEN asset.reject_cassette_serial IS NOT NULL
            AND asset.departure_bag_seal_no IS NOT NULL
            AND asset.return_bag_seal_no IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM dbo.cpc_packing_cassettes cassette
              WHERE cassette.batch_id = asset.batch_id
                AND cassette.work_order_point_id = asset.work_order_point_id
                AND (cassette.cassette_serial IS NULL OR cassette.seal_no IS NULL)
            ) THEN ''PACKING_COMPLETE''
          WHEN asset.reject_cassette_serial IS NOT NULL
            OR asset.departure_bag_seal_no IS NOT NULL
            OR asset.return_bag_seal_no IS NOT NULL
            OR EXISTS (
              SELECT 1
              FROM dbo.cpc_packing_cassettes cassette
              WHERE cassette.batch_id = asset.batch_id
                AND cassette.work_order_point_id = asset.work_order_point_id
                AND (cassette.cassette_serial IS NOT NULL OR cassette.seal_no IS NOT NULL)
            ) THEN ''IN_PROGRESS''
          ELSE ''UNASSIGNED''
        END AS derived_status,
        COALESCE(asset.prepared_at, cash_actor.actor_at) AS actor_at
      FROM dbo.cpc_packing_tid_assets asset
      OUTER APPLY (
        SELECT TOP (1)
          COALESCE(cassette.sealed_by, cassette.packed_by) AS actor_user_id,
          COALESCE(cassette.sealed_at, cassette.packed_at) AS actor_at
        FROM dbo.cpc_packing_cassettes cassette
        WHERE cassette.batch_id = asset.batch_id
          AND cassette.work_order_point_id = asset.work_order_point_id
          AND (cassette.packed_by IS NOT NULL OR cassette.sealed_by IS NOT NULL)
        ORDER BY COALESCE(cassette.sealed_at, cassette.packed_at) DESC, cassette.id DESC
      ) cash_actor
    )
    UPDATE asset
    SET
      assigned_to = CASE WHEN legacy.derived_status = ''UNASSIGNED'' THEN NULL ELSE legacy.actor_user_id END,
      assigned_at = CASE WHEN legacy.derived_status = ''UNASSIGNED'' THEN NULL ELSE COALESCE(legacy.actor_at, asset.created_at) END,
      assignment_status = legacy.derived_status,
      started_by = CASE WHEN legacy.derived_status = ''UNASSIGNED'' THEN NULL ELSE legacy.actor_user_id END,
      started_at = CASE WHEN legacy.derived_status = ''UNASSIGNED'' THEN NULL ELSE COALESCE(legacy.actor_at, asset.created_at) END,
      completed_by = CASE WHEN legacy.derived_status = ''PACKING_COMPLETE'' THEN legacy.actor_user_id ELSE NULL END,
      completed_at = CASE WHEN legacy.derived_status = ''PACKING_COMPLETE'' THEN COALESCE(legacy.actor_at, asset.updated_at) ELSE NULL END
    FROM dbo.cpc_packing_tid_assets asset
    INNER JOIN legacy ON legacy.id = asset.id
    WHERE asset.assignment_status IS NULL;

    UPDATE dbo.cpc_packing_tid_assets
    SET assignment_status = ''UNASSIGNED''
    WHERE assignment_status IS NULL;
  ';

  EXEC sys.sp_executesql N'
    ALTER TABLE dbo.cpc_packing_tid_assets
      ALTER COLUMN assignment_status VARCHAR(20) NOT NULL;
  ';

  IF NOT EXISTS (
    SELECT 1 FROM sys.default_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.cpc_packing_tid_assets')
      AND name = N'DF_cpc_packing_tid_assignment_status'
  )
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_tid_assets
        ADD CONSTRAINT DF_cpc_packing_tid_assignment_status
        DEFAULT (''UNASSIGNED'') FOR assignment_status;
    ';
  END;

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_cpc_packing_tid_assets_assigned_to')
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_tid_assets WITH CHECK
        ADD CONSTRAINT FK_cpc_packing_tid_assets_assigned_to
        FOREIGN KEY (assigned_to) REFERENCES dbo.users(id);
    ';
  END;

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_cpc_packing_tid_assets_started_by')
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_tid_assets WITH CHECK
        ADD CONSTRAINT FK_cpc_packing_tid_assets_started_by
        FOREIGN KEY (started_by) REFERENCES dbo.users(id);
    ';
  END;

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_cpc_packing_tid_assets_completed_by')
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_tid_assets WITH CHECK
        ADD CONSTRAINT FK_cpc_packing_tid_assets_completed_by
        FOREIGN KEY (completed_by) REFERENCES dbo.users(id);
    ';
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.cpc_packing_tid_assets')
      AND name = N'CK_cpc_packing_tid_assignment_status'
  )
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_tid_assets WITH CHECK
        ADD CONSTRAINT CK_cpc_packing_tid_assignment_status
        CHECK (assignment_status IN (''UNASSIGNED'', ''ASSIGNED'', ''IN_PROGRESS'', ''PACKING_COMPLETE''));
    ';
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.cpc_packing_tid_assets')
      AND name = N'CK_cpc_packing_tid_assignment_owner'
  )
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_tid_assets WITH CHECK
        ADD CONSTRAINT CK_cpc_packing_tid_assignment_owner
        CHECK (
          (assignment_status = ''UNASSIGNED'' AND assigned_to IS NULL)
          OR (assignment_status <> ''UNASSIGNED'' AND assigned_to IS NOT NULL)
        );
    ';
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.cpc_packing_tid_assets')
      AND name = N'IX_cpc_packing_tid_assets_assignment'
  )
  BEGIN
    EXEC sys.sp_executesql N'
      CREATE INDEX IX_cpc_packing_tid_assets_assignment
        ON dbo.cpc_packing_tid_assets(batch_id, assignment_status, assigned_to, work_order_point_id)
        INCLUDE (assigned_at, started_by, started_at, completed_by, completed_at);
    ';
  END;

  COMMIT TRANSACTION;

  SELECT 'Migration 042 assignment packing CPC per TID berhasil dijalankan.' AS message;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
