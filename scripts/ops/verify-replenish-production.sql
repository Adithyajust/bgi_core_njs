SET NOCOUNT ON;

DECLARE @problems TABLE (problem NVARCHAR(500) NOT NULL);

IF COL_LENGTH(N'dbo.replenish_work_orders', N'client_request_id') IS NULL
  INSERT INTO @problems VALUES (N'Kolom client_request_id belum tersedia.');
IF OBJECT_ID(N'dbo.replenish_work_order_summary', N'U') IS NULL
  INSERT INTO @problems VALUES (N'Tabel ringkasan replenish belum tersedia.');
IF OBJECT_ID(N'dbo.TR_replenish_work_orders_summary', N'TR') IS NULL
  INSERT INTO @problems VALUES (N'Trigger ringkasan replenish belum tersedia.');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.replenish_work_orders') AND name = N'UX_replenish_wo_creator_request')
  INSERT INTO @problems VALUES (N'Indeks idempotensi replenish belum tersedia.');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.replenish_work_orders') AND name = N'IX_replenish_wo_scope_cursor')
  INSERT INTO @problems VALUES (N'Indeks cursor replenish belum tersedia.');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.replenish_work_orders') AND name = N'IX_replenish_wo_vehicle_conflict')
  INSERT INTO @problems VALUES (N'Indeks konflik kendaraan belum tersedia.');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.replenish_team_members') AND name = N'IX_replenish_team_conflict')
  INSERT INTO @problems VALUES (N'Indeks konflik pegawai belum tersedia.');
IF COL_LENGTH(N'dbo.replenish_work_order_points', N'activity_type') IS NULL
  INSERT INTO @problems VALUES (N'Kolom activity_type per point belum tersedia.');
IF COL_LENGTH(N'dbo.replenish_work_order_points', N'pagu') IS NULL
  INSERT INTO @problems VALUES (N'Kolom pagu per point belum tersedia.');
IF COL_LENGTH(N'dbo.replenish_work_order_points', N'denomination_value') IS NULL
  INSERT INTO @problems VALUES (N'Kolom snapshot denom per point belum tersedia.');
IF COL_LENGTH(N'dbo.replenish_work_order_points', N'required_cassettes') IS NULL
  INSERT INTO @problems VALUES (N'Kolom kebutuhan kaset per point belum tersedia.');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.replenish_work_order_points') AND name = N'IX_replenish_points_activity_work_order')
  INSERT INTO @problems VALUES (N'Indeks aktivitas point replenish belum tersedia.');

IF OBJECT_ID(N'dbo.replenish_work_order_summary', N'U') IS NOT NULL
AND EXISTS (
  SELECT 1
  FROM (
    SELECT
      uker_id,
      COUNT_BIG(1) AS total_count,
      SUM(CASE WHEN status = 'DRAFT' THEN CONVERT(BIGINT,1) ELSE 0 END) AS draft_count,
      SUM(CASE WHEN status = 'MENUNGGU_PERSETUJUAN_TIM' THEN CONVERT(BIGINT,1) ELSE 0 END) AS waiting_count,
      SUM(CASE WHEN status = 'DISETUJUI' THEN CONVERT(BIGINT,1) ELSE 0 END) AS approved_count,
      SUM(CASE WHEN status IN ('GAGAL','TERDAPAT_SELISIH','DALAM_INVESTIGASI') THEN CONVERT(BIGINT,1) ELSE 0 END) AS attention_count,
      CONVERT(DECIMAL(38,2), SUM(CONVERT(DECIMAL(38,2), total_requested_amount))) AS amount
    FROM dbo.replenish_work_orders
    GROUP BY uker_id
  ) actual
  FULL OUTER JOIN dbo.replenish_work_order_summary summary ON summary.uker_id = actual.uker_id
  WHERE ISNULL(actual.total_count,0) <> ISNULL(summary.total_count,0)
     OR ISNULL(actual.draft_count,0) <> ISNULL(summary.draft_count,0)
     OR ISNULL(actual.waiting_count,0) <> ISNULL(summary.waiting_approval_count,0)
     OR ISNULL(actual.approved_count,0) <> ISNULL(summary.approved_count,0)
     OR ISNULL(actual.attention_count,0) <> ISNULL(summary.attention_count,0)
     OR ISNULL(actual.amount,0) <> ISNULL(summary.total_requested_amount,0)
)
  INSERT INTO @problems VALUES (N'Isi tabel ringkasan replenish tidak konsisten dengan tabel transaksi.');

SELECT problem FROM @problems;
IF EXISTS (SELECT 1 FROM @problems)
  THROW 53120, 'Verifikasi production replenish gagal.', 1;

SELECT N'OK' AS verification_status, SYSDATETIME() AS verified_at;
