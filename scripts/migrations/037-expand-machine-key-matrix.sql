SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.machine_key_mappings', N'U') IS NULL
    THROW 53701, 'Tabel dbo.machine_key_mappings belum tersedia. Jalankan migration 036 terlebih dahulu.', 1;

  IF EXISTS (
    SELECT 1
    FROM dbo.machine_key_mappings
    GROUP BY machine_id
    HAVING COUNT_BIG(1) > 1
  )
    THROW 53702, 'Terdapat mesin dengan lebih dari satu mapping. Selesaikan duplikasi sebelum menerapkan aturan satu mesin satu mapping.', 1;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.machine_key_mappings')
      AND name = N'UX_machine_key_machine'
  )
    CREATE UNIQUE INDEX UX_machine_key_machine
      ON dbo.machine_key_mappings(machine_id);

  IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.machine_key_mappings')
      AND name = N'CK_machine_key_wall'
  )
    ALTER TABLE dbo.machine_key_mappings
      DROP CONSTRAINT CK_machine_key_wall;

  ALTER TABLE dbo.machine_key_mappings WITH CHECK
    ADD CONSTRAINT CK_machine_key_wall
    CHECK (
      LEN(matrix_wall) = 2
      AND LEFT(matrix_wall, 1) = 'A'
      AND RIGHT(matrix_wall, 1) COLLATE Latin1_General_100_BIN2 LIKE '[1-9]'
    );

  IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.machine_key_mappings')
      AND name = N'CK_machine_key_column'
  )
    ALTER TABLE dbo.machine_key_mappings
      DROP CONSTRAINT CK_machine_key_column;

  ALTER TABLE dbo.machine_key_mappings WITH CHECK
    ADD CONSTRAINT CK_machine_key_column
    CHECK (
      matrix_column COLLATE Latin1_General_100_BIN2 LIKE '[A-Z]'
    );

  IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.machine_key_mappings')
      AND name = N'CK_machine_key_row'
  )
    ALTER TABLE dbo.machine_key_mappings
      DROP CONSTRAINT CK_machine_key_row;

  ALTER TABLE dbo.machine_key_mappings WITH CHECK
    ADD CONSTRAINT CK_machine_key_row
    CHECK (
      matrix_row COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^0-9]%'
      AND TRY_CONVERT(INT, matrix_row) BETWEEN 1 AND 99
    );

  ALTER TABLE dbo.machine_key_mappings CHECK CONSTRAINT CK_machine_key_wall;
  ALTER TABLE dbo.machine_key_mappings CHECK CONSTRAINT CK_machine_key_column;
  ALTER TABLE dbo.machine_key_mappings CHECK CONSTRAINT CK_machine_key_row;

  COMMIT TRANSACTION;

  SELECT
    'Matrix kunci mendukung konfigurasi dinamis hingga A1-A9, kolom A-Z, dan baris 01-99. Default aplikasi: A1-A5, A-Z, dan 01-15.' AS message;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
