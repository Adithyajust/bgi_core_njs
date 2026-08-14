SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.replenish_work_orders', N'U') IS NULL
    THROW 53301, 'Tabel dbo.replenish_work_orders belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.replenish_work_order_summary', N'U') IS NULL
    THROW 53302, 'Tabel dbo.replenish_work_order_summary belum tersedia.', 1;

  /*
    Pulihkan ringkasan dari source of truth sebelum trigger diganti. Ini juga
    memastikan database tetap konsisten apabila trigger lama pernah gagal
    saat memproses INSERT, UPDATE, atau DELETE.
  */
  DELETE FROM dbo.replenish_work_order_summary;

  INSERT INTO dbo.replenish_work_order_summary
  (
    uker_id,
    total_count,
    draft_count,
    waiting_approval_count,
    approved_count,
    attention_count,
    total_requested_amount,
    updated_at
  )
  SELECT
    uker_id,
    COUNT_BIG(1),
    SUM(CASE WHEN status = 'DRAFT' THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END),
    SUM(CASE WHEN status = 'MENUNGGU_PERSETUJUAN_TIM' THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END),
    SUM(CASE WHEN status = 'DISETUJUI' THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END),
    SUM(CASE WHEN status IN ('GAGAL', 'TERDAPAT_SELISIH', 'DALAM_INVESTIGASI')
      THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END),
    CONVERT(
      DECIMAL(38,2),
      SUM(CONVERT(DECIMAL(38,2), COALESCE(total_requested_amount, 0)))
    ),
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

      /*
        CTE hanya dapat dipakai oleh satu statement di SQL Server. Simpan hasil
        agregasi perubahan ke table variable agar dapat digunakan oleh UPDATE,
        INSERT, dan pemeriksaan konsistensi dalam trigger yang sama.
      */
      DECLARE @delta TABLE
      (
        uker_id BIGINT NOT NULL PRIMARY KEY,
        total_delta BIGINT NOT NULL,
        draft_delta BIGINT NOT NULL,
        waiting_delta BIGINT NOT NULL,
        approved_delta BIGINT NOT NULL,
        attention_delta BIGINT NOT NULL,
        amount_delta DECIMAL(38,2) NOT NULL
      );

      INSERT INTO @delta
      (
        uker_id,
        total_delta,
        draft_delta,
        waiting_delta,
        approved_delta,
        attention_delta,
        amount_delta
      )
      SELECT
        changes.uker_id,
        SUM(changes.total_delta),
        SUM(changes.draft_delta),
        SUM(changes.waiting_delta),
        SUM(changes.approved_delta),
        SUM(changes.attention_delta),
        SUM(changes.amount_delta)
      FROM
      (
        SELECT
          uker_id,
          CONVERT(BIGINT, 1) AS total_delta,
          CONVERT(BIGINT, CASE WHEN status = ''DRAFT'' THEN 1 ELSE 0 END) AS draft_delta,
          CONVERT(BIGINT, CASE WHEN status = ''MENUNGGU_PERSETUJUAN_TIM'' THEN 1 ELSE 0 END) AS waiting_delta,
          CONVERT(BIGINT, CASE WHEN status = ''DISETUJUI'' THEN 1 ELSE 0 END) AS approved_delta,
          CONVERT(BIGINT, CASE WHEN status IN (''GAGAL'', ''TERDAPAT_SELISIH'', ''DALAM_INVESTIGASI'') THEN 1 ELSE 0 END) AS attention_delta,
          CONVERT(DECIMAL(38,2), COALESCE(total_requested_amount, 0)) AS amount_delta
        FROM inserted

        UNION ALL

        SELECT
          uker_id,
          CONVERT(BIGINT, -1),
          CONVERT(BIGINT, CASE WHEN status = ''DRAFT'' THEN -1 ELSE 0 END),
          CONVERT(BIGINT, CASE WHEN status = ''MENUNGGU_PERSETUJUAN_TIM'' THEN -1 ELSE 0 END),
          CONVERT(BIGINT, CASE WHEN status = ''DISETUJUI'' THEN -1 ELSE 0 END),
          CONVERT(BIGINT, CASE WHEN status IN (''GAGAL'', ''TERDAPAT_SELISIH'', ''DALAM_INVESTIGASI'') THEN -1 ELSE 0 END),
          -CONVERT(DECIMAL(38,2), COALESCE(total_requested_amount, 0))
        FROM deleted
      ) changes
      GROUP BY changes.uker_id;

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
      INNER JOIN @delta source ON source.uker_id = target.uker_id;

      INSERT INTO dbo.replenish_work_order_summary
      (
        uker_id,
        total_count,
        draft_count,
        waiting_approval_count,
        approved_count,
        attention_count,
        total_requested_amount,
        updated_at
      )
      SELECT
        source.uker_id,
        source.total_delta,
        source.draft_delta,
        source.waiting_delta,
        source.approved_delta,
        source.attention_delta,
        source.amount_delta,
        SYSDATETIME()
      FROM @delta source
      WHERE NOT EXISTS
      (
        SELECT 1
        FROM dbo.replenish_work_order_summary target WITH (UPDLOCK, HOLDLOCK)
        WHERE target.uker_id = source.uker_id
      );

      IF EXISTS
      (
        SELECT 1
        FROM dbo.replenish_work_order_summary summary
        INNER JOIN @delta affected ON affected.uker_id = summary.uker_id
        WHERE
          summary.total_count < 0
          OR summary.draft_count < 0
          OR summary.waiting_approval_count < 0
          OR summary.approved_count < 0
          OR summary.attention_count < 0
          OR summary.total_requested_amount < 0
      )
        THROW 53303, ''Ringkasan replenish menjadi tidak konsisten.'', 1;
    END;
  ');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0
    ROLLBACK TRANSACTION;
  THROW;
END CATCH;
