SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.master_project', N'U') IS NULL
  BEGIN
    THROW 52201, 'Tabel dbo.master_project tidak ditemukan. Jalankan migration 006 terlebih dahulu.', 1;
  END;

  IF COL_LENGTH(N'dbo.master_project', N'row_version') IS NULL
  BEGIN
    ALTER TABLE dbo.master_project
      ADD row_version ROWVERSION;
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0
    ROLLBACK TRANSACTION;

  THROW;
END CATCH;
