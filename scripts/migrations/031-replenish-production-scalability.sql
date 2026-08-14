SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.replenish_work_orders', N'U') IS NULL
    THROW 53101, 'Tabel dbo.replenish_work_orders belum tersedia.', 1;

  IF COL_LENGTH(N'dbo.replenish_work_orders', N'client_request_id') IS NULL
    ALTER TABLE dbo.replenish_work_orders ADD client_request_id UNIQUEIDENTIFIER NULL;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.replenish_work_orders')
      AND name = N'UX_replenish_wo_creator_request'
  )
    CREATE UNIQUE INDEX UX_replenish_wo_creator_request
      ON dbo.replenish_work_orders(created_by, client_request_id)
      WHERE client_request_id IS NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.replenish_work_orders')
      AND name = N'IX_replenish_wo_vehicle_conflict'
  )
    CREATE INDEX IX_replenish_wo_vehicle_conflict
      ON dbo.replenish_work_orders(schedule_date, vehicle_id, status, id DESC)
      INCLUDE (work_order_no, uker_id);

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.replenish_work_orders')
      AND name = N'IX_replenish_wo_scope_cursor'
  )
    CREATE INDEX IX_replenish_wo_scope_cursor
      ON dbo.replenish_work_orders(uker_id, id DESC)
      INCLUDE (
        work_order_no, activity_type, schedule_date, departure_time,
        estimated_finish_time, priority, vehicle_id, escort_name, status,
        total_points, total_requested_amount, created_by, created_at, updated_at
      );

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.replenish_team_members')
      AND name = N'IX_replenish_team_conflict'
  )
    CREATE INDEX IX_replenish_team_conflict
      ON dbo.replenish_team_members(employee_id, work_order_id DESC)
      INCLUDE (member_role);

  IF OBJECT_ID(N'dbo.replenish_work_order_summary', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.replenish_work_order_summary (
      uker_id BIGINT NOT NULL,
      total_count BIGINT NOT NULL CONSTRAINT DF_replenish_summary_total DEFAULT (0),
      draft_count BIGINT NOT NULL CONSTRAINT DF_replenish_summary_draft DEFAULT (0),
      waiting_approval_count BIGINT NOT NULL CONSTRAINT DF_replenish_summary_waiting DEFAULT (0),
      approved_count BIGINT NOT NULL CONSTRAINT DF_replenish_summary_approved DEFAULT (0),
      attention_count BIGINT NOT NULL CONSTRAINT DF_replenish_summary_attention DEFAULT (0),
      total_requested_amount DECIMAL(38,2) NOT NULL CONSTRAINT DF_replenish_summary_amount DEFAULT (0),
      updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_replenish_summary_updated DEFAULT (SYSDATETIME()),
      CONSTRAINT PK_replenish_work_order_summary PRIMARY KEY CLUSTERED (uker_id),
      CONSTRAINT FK_replenish_summary_uker FOREIGN KEY (uker_id) REFERENCES dbo.master_uker(id)
    );
  END;

  DELETE FROM dbo.replenish_work_order_summary;

  INSERT INTO dbo.replenish_work_order_summary
  (
    uker_id, total_count, draft_count, waiting_approval_count,
    approved_count, attention_count, total_requested_amount, updated_at
  )
  SELECT
    uker_id,
    COUNT_BIG(1),
    SUM(CASE WHEN status = 'DRAFT' THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END),
    SUM(CASE WHEN status = 'MENUNGGU_PERSETUJUAN_TIM' THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END),
    SUM(CASE WHEN status = 'DISETUJUI' THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END),
    SUM(CASE WHEN status IN ('GAGAL', 'TERDAPAT_SELISIH', 'DALAM_INVESTIGASI') THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END),
    CONVERT(DECIMAL(38,2), SUM(CONVERT(DECIMAL(38,2), total_requested_amount))),
    SYSDATETIME()
  FROM dbo.replenish_work_orders
  GROUP BY uker_id;

  EXEC(N'
    CREATE OR ALTER TRIGGER dbo.TR_replenish_work_orders_summary
    ON dbo.replenish_work_orders
    AFTER INSERT, UPDATE, DELETE
    AS
    BEGIN
      SET NOCOUNT ON;
      SET XACT_ABORT ON;

      ;WITH changes AS (
        SELECT
          uker_id,
          CONVERT(BIGINT, 1) AS total_delta,
          CONVERT(BIGINT, CASE WHEN status = ''DRAFT'' THEN 1 ELSE 0 END) AS draft_delta,
          CONVERT(BIGINT, CASE WHEN status = ''MENUNGGU_PERSETUJUAN_TIM'' THEN 1 ELSE 0 END) AS waiting_delta,
          CONVERT(BIGINT, CASE WHEN status = ''DISETUJUI'' THEN 1 ELSE 0 END) AS approved_delta,
          CONVERT(BIGINT, CASE WHEN status IN (''GAGAL'', ''TERDAPAT_SELISIH'', ''DALAM_INVESTIGASI'') THEN 1 ELSE 0 END) AS attention_delta,
          CONVERT(DECIMAL(38,2), total_requested_amount) AS amount_delta
        FROM inserted
        UNION ALL
        SELECT
          uker_id,
          CONVERT(BIGINT, -1),
          CONVERT(BIGINT, CASE WHEN status = ''DRAFT'' THEN -1 ELSE 0 END),
          CONVERT(BIGINT, CASE WHEN status = ''MENUNGGU_PERSETUJUAN_TIM'' THEN -1 ELSE 0 END),
          CONVERT(BIGINT, CASE WHEN status = ''DISETUJUI'' THEN -1 ELSE 0 END),
          CONVERT(BIGINT, CASE WHEN status IN (''GAGAL'', ''TERDAPAT_SELISIH'', ''DALAM_INVESTIGASI'') THEN -1 ELSE 0 END),
          -CONVERT(DECIMAL(38,2), total_requested_amount)
        FROM deleted
      ), delta AS (
        SELECT
          uker_id,
          SUM(total_delta) AS total_delta,
          SUM(draft_delta) AS draft_delta,
          SUM(waiting_delta) AS waiting_delta,
          SUM(approved_delta) AS approved_delta,
          SUM(attention_delta) AS attention_delta,
          SUM(amount_delta) AS amount_delta
        FROM changes
        GROUP BY uker_id
      )
      UPDATE target WITH (UPDLOCK, HOLDLOCK)
      SET
        total_count = target.total_count + source.total_delta,
        draft_count = target.draft_count + source.draft_delta,
        waiting_approval_count = target.waiting_approval_count + source.waiting_delta,
        approved_count = target.approved_count + source.approved_delta,
        attention_count = target.attention_count + source.attention_delta,
        total_requested_amount = target.total_requested_amount + source.amount_delta,
        updated_at = SYSDATETIME()
      FROM dbo.replenish_work_order_summary target
      INNER JOIN delta source ON source.uker_id = target.uker_id;

      INSERT INTO dbo.replenish_work_order_summary
      (
        uker_id, total_count, draft_count, waiting_approval_count,
        approved_count, attention_count, total_requested_amount, updated_at
      )
      SELECT
        source.uker_id, source.total_delta, source.draft_delta,
        source.waiting_delta, source.approved_delta, source.attention_delta,
        source.amount_delta, SYSDATETIME()
      FROM delta source
      WHERE NOT EXISTS (
        SELECT 1
        FROM dbo.replenish_work_order_summary target WITH (UPDLOCK, HOLDLOCK)
        WHERE target.uker_id = source.uker_id
      );

      IF EXISTS (
        SELECT 1
        FROM dbo.replenish_work_order_summary summary
        INNER JOIN delta affected ON affected.uker_id = summary.uker_id
        WHERE summary.total_count < 0 OR summary.draft_count < 0
          OR summary.waiting_approval_count < 0 OR summary.approved_count < 0
          OR summary.attention_count < 0 OR summary.total_requested_amount < 0
      )
        THROW 53102, ''Ringkasan replenish menjadi tidak konsisten.'', 1;
    END;
  ');

  IF OBJECT_ID(N'dbo.user_sessions', N'U') IS NOT NULL
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM sys.indexes
      WHERE object_id = OBJECT_ID(N'dbo.user_sessions')
        AND name = N'IX_user_sessions_expiry_cleanup'
    )
      CREATE INDEX IX_user_sessions_expiry_cleanup
        ON dbo.user_sessions(expires_at, id)
        INCLUDE (revoked_at);

    IF NOT EXISTS (
      SELECT 1 FROM sys.indexes
      WHERE object_id = OBJECT_ID(N'dbo.user_sessions')
        AND name = N'IX_user_sessions_revoked_cleanup'
    )
      CREATE INDEX IX_user_sessions_revoked_cleanup
        ON dbo.user_sessions(revoked_at, id)
        WHERE revoked_at IS NOT NULL;

    EXEC(N'
      CREATE OR ALTER PROCEDURE dbo.cleanup_user_sessions
        @revoked_retention_days INT = 7,
        @batch_size INT = 5000
      AS
      BEGIN
        SET NOCOUNT ON;
        SET XACT_ABORT ON;
        IF @revoked_retention_days < 1 OR @revoked_retention_days > 90
          THROW 53105, ''revoked_retention_days harus 1 sampai 90.'', 1;
        IF @batch_size < 100 OR @batch_size > 50000
          THROW 53106, ''batch_size harus 100 sampai 50000.'', 1;

        WHILE 1 = 1
        BEGIN
          DELETE TOP (@batch_size)
          FROM dbo.user_sessions
          WHERE expires_at < SYSDATETIME();
          IF @@ROWCOUNT < @batch_size BREAK;
        END;

        WHILE 1 = 1
        BEGIN
          DELETE TOP (@batch_size)
          FROM dbo.user_sessions
          WHERE revoked_at IS NOT NULL
            AND revoked_at < DATEADD(DAY, -@revoked_retention_days, SYSDATETIME());
          IF @@ROWCOUNT < @batch_size BREAK;
        END;
      END;
    ');
  END;

  IF OBJECT_ID(N'dbo.security_rate_limits', N'U') IS NOT NULL
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM sys.indexes
      WHERE object_id = OBJECT_ID(N'dbo.security_rate_limits')
        AND name = N'IX_security_rate_limits_cleanup'
    )
      CREATE INDEX IX_security_rate_limits_cleanup
        ON dbo.security_rate_limits(updated_at)
        INCLUDE (key_hash);

    EXEC(N'
      CREATE OR ALTER PROCEDURE dbo.cleanup_security_rate_limits
        @retention_days INT = 2,
        @batch_size INT = 5000
      AS
      BEGIN
        SET NOCOUNT ON;
        SET XACT_ABORT ON;
        IF @retention_days < 1 OR @retention_days > 30
          THROW 53103, ''retention_days harus 1 sampai 30.'', 1;
        IF @batch_size < 100 OR @batch_size > 50000
          THROW 53104, ''batch_size harus 100 sampai 50000.'', 1;
        WHILE 1 = 1
        BEGIN
          DELETE TOP (@batch_size)
          FROM dbo.security_rate_limits
          WHERE updated_at < DATEADD(DAY, -@retention_days, SYSDATETIME());
          IF @@ROWCOUNT < @batch_size BREAK;
        END;
      END;
    ');
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
