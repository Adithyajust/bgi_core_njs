SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.master_mesin', N'U') IS NULL
    THROW 51300, 'Tabel dbo.master_mesin belum tersedia. Jalankan migration 009 terlebih dahulu.', 1;

  IF COL_LENGTH(N'dbo.master_mesin', N'denom') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.master_mesin
        ADD denom NVARCHAR(50) NULL;
    ';
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
      AND name = N'CK_master_mesin_denom_not_blank'
  )
  BEGIN
    -- Dynamic SQL memastikan kolom yang baru ditambahkan dikenali pada batch yang sama.
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.master_mesin WITH CHECK
        ADD CONSTRAINT CK_master_mesin_denom_not_blank
        CHECK (denom IS NULL OR LEN(LTRIM(RTRIM(denom))) > 0);
    ';
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_mesin')
      AND name = N'IX_master_mesin_denom_active'
  )
  BEGIN
    EXEC sys.sp_executesql N'
      CREATE INDEX IX_master_mesin_denom_active
        ON dbo.master_mesin(denom, is_active, id DESC)
        INCLUDE (tid, sn, lokasi, project_id, tipe_mesin_id, updated_at)
        WHERE denom IS NOT NULL;
    ';
  END;

  COMMIT TRANSACTION;

  SELECT
    'Migration 030 Denom Master Mesin berhasil diterapkan.' AS message,
    COL_LENGTH(N'dbo.master_mesin', N'denom') AS denom_column_length;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
