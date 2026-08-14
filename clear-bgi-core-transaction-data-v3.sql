/*
  BGI Core - Clear Business Transaction Data (backup-specific v3)

  Disusun dari katalog backup database bgi_core yang diberikan pada 2026-08-11.

  Tujuan:
  - Menghapus seluruh data transaksi Replenish, CPC, Replenish Lapangan,
    Surat Tugas, dan dokumen serah-terima yang tersimpan di SQL Server.
  - Mempertahankan seluruh tabel master, pegawai, user, role, menu, permission,
    konfigurasi, machine key mapping, dan schema migration.

  PENGAMAN:
  1. Default @Execute = 0 sehingga hanya menampilkan preview.
  2. Eksekusi membutuhkan nama database yang sama persis dan confirmation phrase.
  3. Tidak menggunakan TRUNCATE TABLE atau DROP TABLE.
  4. Daftar target eksplisit dan ditolak bila menyentuh tabel master/configuration.
  5. Seluruh penghapusan berjalan dalam satu transaksi; kegagalan menyebabkan rollback.
  6. Tabel transaksi tambahan dengan prefix replenish_, cpc_, atau surat_tugas
     ditemukan otomatis dan urutan DELETE dihitung dari foreign key database.
  7. Tidak menonaktifkan atau menghapus foreign key, trigger, index, maupun tabel.

  PENTING:
  - Hentikan aplikasi/worker dan lakukan backup database sebelum @Execute = 1.
  - Script ini hanya membersihkan DATA TABEL. File PDF/foto evidence pada filesystem
    tidak dihapus oleh script ini.
  - Jalankan menggunakan akun yang memiliki permission DELETE dan UPDATE yang sesuai.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

/* =========================
   KONFIGURASI OPERATOR
   ========================= */
DECLARE @Execute BIT = 1;
DECLARE @ExpectedDatabase SYSNAME = N'bgi_core';
/*DECLARE @ConfirmationPhrase NVARCHAR(100) = N'';*/
DECLARE @ConfirmationPhrase NVARCHAR(100) =
  N'CLEAR BGI TRANSACTION DATA';

/* Opsional; default tidak mengubah sequence identity. */
DECLARE @ResetTransactionIdentities BIT = 0;

/* Memasukkan tabel transaksi tambahan yang mungkin tidak ada di source ZIP. */
DECLARE @AutoDiscoverTransactionTables BIT = 1;

/* Data operasional/non-master ikut dibersihkan agar hasil benar-benar fresh. */
DECLARE @ClearAuditLogs BIT = 1;
DECLARE @ClearSessionsAndRateLimits BIT = 1;

DECLARE @RequiredConfirmationPhrase NVARCHAR(100) =
  N'CLEAR BGI TRANSACTION DATA';

/* =========================
   TARGET TRANSAKSI
   Child table harus berada sebelum parent table.
   ========================= */
DECLARE @Targets TABLE
(
  delete_order INT NOT NULL PRIMARY KEY,
  schema_name SYSNAME NOT NULL,
  table_name SYSNAME NOT NULL UNIQUE,
  data_group NVARCHAR(100) NOT NULL
);

INSERT INTO @Targets
  (delete_order, schema_name, table_name, data_group)
VALUES
  (10,  N'dbo', N'replenish_field_exception_evidence', N'Replenish Lapangan'),
  (20,  N'dbo', N'replenish_field_exceptions',         N'Replenish Lapangan'),
  (30,  N'dbo', N'replenish_field_cassette_exchanges', N'Replenish Lapangan'),
  (40,  N'dbo', N'replenish_field_point_checks',       N'Replenish Lapangan'),
  (50,  N'dbo', N'replenish_field_events',             N'Replenish Lapangan'),

  (100, N'dbo', N'cpc_cassette_handover_items',        N'CPC Serah Terima'),
  (110, N'dbo', N'cpc_cassette_handovers',             N'CPC Serah Terima'),
  (120, N'dbo', N'cpc_packing_cassettes',              N'CPC Packing'),
  /* Dua tabel berikut ditemukan langsung pada backup yang diberikan. */
  (125, N'dbo', N'cpc_sorted_cassettes',               N'CPC Sorting'),
  (130, N'dbo', N'cpc_packing_tid_assets',             N'CPC Packing'),
  (135, N'dbo', N'cpc_sorting_batches',                N'CPC Sorting'),
  (140, N'dbo', N'cpc_packing_batches',                N'CPC Packing'),

  (200, N'dbo', N'replenish_key_handover_items',       N'Serah Terima Kunci'),
  (210, N'dbo', N'replenish_key_handovers',            N'Serah Terima Kunci'),
  (220, N'dbo', N'replenish_assignment_letters',       N'Surat Tugas Replenish'),
  (230, N'dbo', N'surat_tugas_verifikasi',             N'Surat Tugas Legacy'),
  (240, N'dbo', N'surat_tugas',                        N'Surat Tugas Legacy'),

  (300, N'dbo', N'replenish_status_history',           N'Replenish Core'),
  (310, N'dbo', N'replenish_team_members',             N'Replenish Core'),
  (320, N'dbo', N'replenish_work_order_points',        N'Replenish Core'),
  (330, N'dbo', N'replenish_work_orders',              N'Replenish Core'),

  /* Dihapus setelah work order agar trigger summary dapat memproses DELETE. */
  (340, N'dbo', N'replenish_work_order_summary',       N'Replenish Summary');

IF @ClearAuditLogs = 1
BEGIN
  INSERT INTO @Targets
    (delete_order, schema_name, table_name, data_group)
  VALUES
    (9000, N'dbo', N'audit_logs', N'Operational Audit');
END;

IF @ClearSessionsAndRateLimits = 1
BEGIN
  INSERT INTO @Targets
    (delete_order, schema_name, table_name, data_group)
  VALUES
    (9010, N'dbo', N'user_sessions',       N'Operational Session'),
    (9020, N'dbo', N'security_rate_limits', N'Operational Security');
END;

/*
  Database deployment dapat memiliki tabel transaksi tambahan yang tidak ada
  di arsip source. Tabel tersebut dimasukkan otomatis hanya bila namanya berada
  pada namespace transaksi aplikasi. Tabel master tidak cocok dengan filter ini.
*/
IF @AutoDiscoverTransactionTables = 1
BEGIN
  ;WITH discovered AS
  (
    SELECT
      schema_item.name AS schema_name,
      table_item.name AS table_name,
      ROW_NUMBER() OVER
        (ORDER BY schema_item.name, table_item.name) AS sequence_no
    FROM sys.tables table_item
    INNER JOIN sys.schemas schema_item
      ON schema_item.schema_id = table_item.schema_id
    WHERE schema_item.name = N'dbo'
      AND
      (
        table_item.name LIKE N'replenish[_]%'
        OR table_item.name LIKE N'cpc[_]%'
        OR table_item.name = N'surat_tugas'
        OR table_item.name LIKE N'surat_tugas[_]%'
      )
      AND NOT EXISTS
      (
        SELECT 1
        FROM @Targets target
        WHERE target.schema_name = schema_item.name
          AND target.table_name = table_item.name
      )
  )
  INSERT INTO @Targets
    (delete_order, schema_name, table_name, data_group)
  SELECT
    5000 + CONVERT(INT, sequence_no),
    schema_name,
    table_name,
    N'Auto-discovered Transaction'
  FROM discovered;
END;

/* =========================
   SAFETY CHECKS
   ========================= */
IF EXISTS
(
  SELECT 1
  FROM @Targets
  WHERE table_name LIKE N'master[_]%'
     OR table_name IN
        (
          N'pegawai', N'users', N'roles', N'sidebar_routes',
          N'navbar_routes', N'role_sidebar_routes', N'machine_key_mappings',
          N'schema_migrations', N'column_master_keys'
        )
)
  THROW 55001,
    'Safety stop: daftar DELETE menyentuh tabel master/configuration.',
    1;

IF @Execute = 1
BEGIN
  IF @ExpectedDatabase = N'__SET_DATABASE_NAME__'
     OR DB_NAME() <> @ExpectedDatabase
    THROW 55003,
      'Safety stop: @ExpectedDatabase belum diisi atau tidak sama dengan database aktif.',
      1;

  IF @ConfirmationPhrase <> @RequiredConfirmationPhrase
    THROW 55004,
      'Safety stop: confirmation phrase tidak sesuai.',
      1;
END;

/* =========================
   PREVIEW
   ========================= */
SELECT
  target.delete_order,
  target.data_group,
  QUOTENAME(target.schema_name) + N'.' + QUOTENAME(target.table_name)
    AS target_table,
  CASE
    WHEN table_item.object_id IS NULL THEN N'NOT PRESENT'
    ELSE N'WILL DELETE'
  END AS planned_action,
  COALESCE(row_count.rows_to_delete, 0) AS estimated_rows
FROM @Targets target
LEFT JOIN sys.schemas schema_item
  ON schema_item.name = target.schema_name
LEFT JOIN sys.tables table_item
  ON table_item.schema_id = schema_item.schema_id
 AND table_item.name = target.table_name
OUTER APPLY
(
  SELECT SUM(CONVERT(BIGINT, partition_item.rows)) AS rows_to_delete
  FROM sys.partitions partition_item
  WHERE partition_item.object_id = table_item.object_id
    AND partition_item.index_id IN (0, 1)
) row_count
ORDER BY target.delete_order;

SELECT
  N'PRESERVED' AS planned_action,
  QUOTENAME(schema_item.name) + N'.' + QUOTENAME(table_item.name)
    AS protected_table,
  COALESCE(SUM(CONVERT(BIGINT, partition_item.rows)), 0) AS estimated_rows
FROM sys.tables table_item
INNER JOIN sys.schemas schema_item
  ON schema_item.schema_id = table_item.schema_id
LEFT JOIN sys.partitions partition_item
  ON partition_item.object_id = table_item.object_id
 AND partition_item.index_id IN (0, 1)
WHERE schema_item.name = N'dbo'
  AND
  (
    table_item.name LIKE N'master[_]%'
    OR table_item.name IN
       (
         N'pegawai', N'users', N'roles', N'sidebar_routes',
         N'navbar_routes', N'role_sidebar_routes', N'machine_key_mappings',
         N'schema_migrations', N'column_master_keys'
       )
  )
GROUP BY schema_item.name, table_item.name
ORDER BY protected_table;

IF OBJECT_ID(N'dbo.machine_key_mappings', N'U') IS NOT NULL
BEGIN
  SELECT
    N'RESET STATE ONLY - ROWS PRESERVED' AS planned_action,
    COUNT_BIG(1) AS machine_key_rows_to_reset
  FROM dbo.machine_key_mappings
  WHERE current_work_order_id IS NOT NULL
     OR status = 'OUT';
END;

IF @Execute = 0
BEGIN
  SELECT
    N'PREVIEW ONLY' AS execution_status,
    DB_NAME() AS active_database,
    N'Periksa daftar preview. Untuk eksekusi, set @Execute = 1 dan isi @ConfirmationPhrase = CLEAR BGI TRANSACTION DATA.'
      AS next_step;
  RETURN;
END;

/* =========================
   EXECUTION
   ========================= */
DECLARE @Results TABLE
(
  delete_order INT NOT NULL,
  target_table NVARCHAR(517) NOT NULL,
  operation NVARCHAR(30) NOT NULL,
  affected_rows BIGINT NULL,
  execution_status NVARCHAR(30) NOT NULL
);

BEGIN TRY
  BEGIN TRANSACTION;

  DECLARE @ApplicationLockResult INT;

  EXEC @ApplicationLockResult = sys.sp_getapplock
    @Resource = N'bgi-clear-business-transaction-data',
    @LockMode = N'Exclusive',
    @LockOwner = N'Transaction',
    @LockTimeout = 10000;

  IF @ApplicationLockResult < 0
    THROW 55005,
      'Tidak dapat memperoleh cleanup lock. Pastikan tidak ada cleanup lain yang berjalan.',
      1;

  /*
    machine_key_mappings adalah master dan seluruh barisnya dipertahankan.
    Kolom state transaksi wajib dilepas lebih dahulu karena current_work_order_id
    memiliki foreign key ke replenish_work_orders.
  */
  IF OBJECT_ID(N'dbo.machine_key_mappings', N'U') IS NOT NULL
  BEGIN
    UPDATE dbo.machine_key_mappings
    SET
      status = 'IN',
      current_work_order_id = NULL,
      checked_out_at = NULL,
      checked_in_at = SYSDATETIME(),
      updated_at = SYSDATETIME()
    WHERE current_work_order_id IS NOT NULL
       OR status = 'OUT';

    INSERT INTO @Results
      (delete_order, target_table, operation, affected_rows, execution_status)
    VALUES
      (
        0,
        N'[dbo].[machine_key_mappings]',
        N'UPDATE STATE',
        @@ROWCOUNT,
        N'ROWS PRESERVED'
      );
  END;

  DECLARE @DeleteOrder INT;
  DECLARE @SchemaName SYSNAME;
  DECLARE @TableName SYSNAME;
  DECLARE @QualifiedTable NVARCHAR(517);
  DECLARE @Sql NVARCHAR(MAX);
  DECLARE @AffectedRows BIGINT;
  DECLARE @ObjectId INT;
  DECLARE @CyclicTables NVARCHAR(MAX);
  DECLARE @CycleError NVARCHAR(2048);

  DECLARE @PendingTargets TABLE
  (
    object_id INT NOT NULL PRIMARY KEY,
    preferred_order INT NOT NULL,
    schema_name SYSNAME NOT NULL,
    table_name SYSNAME NOT NULL
  );

  INSERT INTO @PendingTargets
    (object_id, preferred_order, schema_name, table_name)
  SELECT
    table_item.object_id,
    target.delete_order,
    target.schema_name,
    target.table_name
  FROM @Targets target
  INNER JOIN sys.schemas schema_item
    ON schema_item.name = target.schema_name
  INNER JOIN sys.tables table_item
    ON table_item.schema_id = schema_item.schema_id
   AND table_item.name = target.table_name;

  INSERT INTO @Results
    (delete_order, target_table, operation, affected_rows, execution_status)
  SELECT
    target.delete_order,
    QUOTENAME(target.schema_name) + N'.' + QUOTENAME(target.table_name),
    N'DELETE',
    NULL,
    N'NOT PRESENT'
  FROM @Targets target
  WHERE NOT EXISTS
  (
    SELECT 1
    FROM @PendingTargets pending
    WHERE pending.schema_name = target.schema_name
      AND pending.table_name = target.table_name
  );

  /*
    Self-referencing foreign key tidak dapat diurutkan secara generik dengan aman.
    Jika deployment menambah tabel seperti itu, script berhenti dan rollback.
  */
  IF EXISTS
  (
    SELECT 1
    FROM sys.foreign_keys foreign_key
    INNER JOIN @PendingTargets pending
      ON pending.object_id = foreign_key.parent_object_id
    WHERE foreign_key.parent_object_id = foreign_key.referenced_object_id
      AND foreign_key.is_disabled = 0
  )
  BEGIN
    SELECT
      foreign_key.name AS blocking_foreign_key,
      QUOTENAME(pending.schema_name) + N'.' + QUOTENAME(pending.table_name)
        AS self_referencing_table
    FROM sys.foreign_keys foreign_key
    INNER JOIN @PendingTargets pending
      ON pending.object_id = foreign_key.parent_object_id
    WHERE foreign_key.parent_object_id = foreign_key.referenced_object_id
      AND foreign_key.is_disabled = 0;

    THROW 55007,
      'Safety stop: ditemukan self-referencing foreign key pada tabel transaksi.',
      1;
  END;

  /*
    Pilih leaf/child table yang tidak sedang menjadi parent bagi target lain.
    Setelah leaf dihapus, keluarkan dari daftar dan hitung ulang sampai parent
    terakhir terhapus. Ini membuat tabel tambahan mengikuti foreign key aktual.
  */
  WHILE EXISTS (SELECT 1 FROM @PendingTargets)
  BEGIN
    SET @ObjectId = NULL;
    SET @DeleteOrder = NULL;
    SET @SchemaName = NULL;
    SET @TableName = NULL;

    SELECT TOP (1)
      @ObjectId = candidate.object_id,
      @DeleteOrder = candidate.preferred_order,
      @SchemaName = candidate.schema_name,
      @TableName = candidate.table_name
    FROM @PendingTargets candidate
    WHERE NOT EXISTS
    (
      SELECT 1
      FROM sys.foreign_keys foreign_key
      INNER JOIN @PendingTargets child
        ON child.object_id = foreign_key.parent_object_id
      WHERE foreign_key.referenced_object_id = candidate.object_id
        AND foreign_key.parent_object_id <> foreign_key.referenced_object_id
        AND foreign_key.is_disabled = 0
    )
      /*
        Summary dipertahankan sampai work order selesai dihapus. Trigger summary
        pada replenish_work_orders dapat menulis ulang tabel summary saat DELETE.
      */
      AND NOT
      (
        candidate.schema_name = N'dbo'
        AND candidate.table_name = N'replenish_work_order_summary'
        AND EXISTS
        (
          SELECT 1
          FROM @PendingTargets work_order_target
          WHERE work_order_target.schema_name = N'dbo'
            AND work_order_target.table_name = N'replenish_work_orders'
        )
      )
    ORDER BY candidate.preferred_order, candidate.object_id;

    IF @ObjectId IS NULL
    BEGIN
      SELECT @CyclicTables = STRING_AGG(
        QUOTENAME(pending.schema_name) + N'.' + QUOTENAME(pending.table_name),
        N', '
      )
      FROM @PendingTargets pending;

      SET @CycleError = LEFT(
        N'Safety stop: siklus foreign key terdeteksi pada tabel transaksi: '
        + COALESCE(@CyclicTables, N'(tidak diketahui)'),
        2048
      );

      THROW 55008, @CycleError, 1;
    END;

    SET @QualifiedTable =
      QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName);

    SET @AffectedRows = 0;
    SET @Sql =
      N'DELETE FROM ' + @QualifiedTable + N';'
      + N' SET @DeletedRows = CONVERT(BIGINT, @@ROWCOUNT);'
      + N' IF EXISTS (SELECT TOP (1) 1 FROM ' + @QualifiedTable + N')'
      + N' THROW 55006, ''Cleanup verification failed: tabel masih berisi data.'', 1;';

    EXEC sys.sp_executesql
      @Sql,
      N'@DeletedRows BIGINT OUTPUT',
      @DeletedRows = @AffectedRows OUTPUT;

    INSERT INTO @Results
      (delete_order, target_table, operation, affected_rows, execution_status)
    VALUES
      (@DeleteOrder, @QualifiedTable, N'DELETE', @AffectedRows, N'DELETED');

    IF @ResetTransactionIdentities = 1
       AND EXISTS
       (
         SELECT 1
         FROM sys.identity_columns identity_column
         WHERE identity_column.object_id = @ObjectId
       )
    BEGIN
      SET @Sql =
        N'DBCC CHECKIDENT ('
        + QUOTENAME(@QualifiedTable, '''')
        + N', RESEED, 0) WITH NO_INFOMSGS;';

      EXEC sys.sp_executesql @Sql;

      UPDATE @Results
      SET operation = N'DELETE + RESEED'
      WHERE delete_order = @DeleteOrder;
    END;

    DELETE FROM @PendingTargets
    WHERE object_id = @ObjectId;
  END;

  /* Verifikasi akhir, termasuk tabel yang mungkin disentuh trigger lain. */
  DECLARE @VerifySchema SYSNAME;
  DECLARE @VerifyTable SYSNAME;
  DECLARE @VerifyQualifiedTable NVARCHAR(517);

  DECLARE verify_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT target.schema_name, target.table_name
    FROM @Targets target
    INNER JOIN sys.schemas schema_item
      ON schema_item.name = target.schema_name
    INNER JOIN sys.tables table_item
      ON table_item.schema_id = schema_item.schema_id
     AND table_item.name = target.table_name
    ORDER BY target.delete_order;

  OPEN verify_cursor;
  FETCH NEXT FROM verify_cursor INTO @VerifySchema, @VerifyTable;

  WHILE @@FETCH_STATUS = 0
  BEGIN
    SET @VerifyQualifiedTable =
      QUOTENAME(@VerifySchema) + N'.' + QUOTENAME(@VerifyTable);

    SET @Sql =
      N'IF EXISTS (SELECT TOP (1) 1 FROM ' + @VerifyQualifiedTable + N') '
      + N'THROW 55009, ''Cleanup verification failed: masih ada data transaksi pada '
      + REPLACE(@VerifyQualifiedTable, N'''', N'''''') + N'.'', 1;';

    EXEC sys.sp_executesql @Sql;

    FETCH NEXT FROM verify_cursor INTO @VerifySchema, @VerifyTable;
  END;

  CLOSE verify_cursor;
  DEALLOCATE verify_cursor;

  COMMIT TRANSACTION;

  SELECT
    delete_order,
    target_table,
    operation,
    affected_rows,
    execution_status
  FROM @Results
  ORDER BY delete_order;

  SELECT
    N'COMPLETED' AS execution_status,
    DB_NAME() AS database_name,
    SYSDATETIME() AS completed_at,
    N'Tabel master/configuration tidak dihapus.' AS master_data_status;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0
    ROLLBACK TRANSACTION;

  THROW;
END CATCH;


  ALTER SEQUENCE dbo.replenish_work_order_sequence
  RESTART WITH 1;