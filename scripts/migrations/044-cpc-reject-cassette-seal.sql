SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.cpc_packing_tid_assets', N'U') IS NULL
    THROW 54401, 'Tabel dbo.cpc_packing_tid_assets belum tersedia.', 1;

  IF COL_LENGTH(N'dbo.cpc_packing_tid_assets', N'reject_cassette_seal_no') IS NULL
  BEGIN
    ALTER TABLE dbo.cpc_packing_tid_assets
      ADD reject_cassette_seal_no VARCHAR(100) NULL;
  END;

  -- SQL Server mengompilasi referensi kolom pada satu batch sebelum ALTER TABLE
  -- dijalankan. CREATE INDEX harus memakai dynamic SQL agar kolom yang baru
  -- ditambahkan dapat di-resolve setelah ALTER TABLE selesai.
  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.cpc_packing_tid_assets')
      AND name = N'UX_cpc_packing_tid_assets_reject_seal'
  )
  BEGIN
    EXEC sys.sp_executesql N'
      CREATE UNIQUE INDEX UX_cpc_packing_tid_assets_reject_seal
        ON dbo.cpc_packing_tid_assets(reject_cassette_seal_no)
        WHERE reject_cassette_seal_no IS NOT NULL;
    ';
  END;

  COMMIT TRANSACTION;

  SELECT 'Migration 044 segel kaset reject CPC berhasil dijalankan.' AS message;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
