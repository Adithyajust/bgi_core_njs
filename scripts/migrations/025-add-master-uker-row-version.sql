SET NOCOUNT ON;
SET XACT_ABORT ON;

/*
  Menambahkan token optimistic concurrency pada tabel master_uker yang berasal
  dari skema lama. Migration bersifat idempotent dan aman dijalankan ulang.
*/
BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.master_uker', N'U') IS NULL
  BEGIN
    THROW 52501, 'Tabel dbo.master_uker tidak ditemukan.', 1;
  END;

  IF COL_LENGTH(N'dbo.master_uker', N'row_version') IS NULL
  BEGIN
    ALTER TABLE dbo.master_uker
      ADD row_version ROWVERSION;
  END;

  IF EXISTS (
    SELECT 1
    FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.master_uker')
      AND c.name = N'row_version'
      AND (c.system_type_id <> 189 OR c.max_length <> 8)
  )
  BEGIN
    THROW 52502, 'Kolom dbo.master_uker.row_version ada tetapi tipenya bukan ROWVERSION.', 1;
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
