SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.replenish_work_orders', N'U') IS NULL
    THROW 53091, 'Tabel dbo.replenish_work_orders belum tersedia. Jalankan migration 026 terlebih dahulu.', 1;

  /*
    Migration prasyarat untuk 031.

    SQL Server mengompilasi seluruh batch sebelum menjalankan ALTER TABLE.
    Karena migration 031 membuat indeks yang mereferensikan client_request_id,
    kolom harus sudah tersedia sebelum batch 031 mulai dikompilasi.
  */
  IF COL_LENGTH(N'dbo.replenish_work_orders', N'client_request_id') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.replenish_work_orders
        ADD client_request_id UNIQUEIDENTIFIER NULL;
    ';
  END;

  IF COL_LENGTH(N'dbo.replenish_work_orders', N'client_request_id') IS NULL
    THROW 53092, 'Kolom client_request_id gagal dibuat.', 1;

  COMMIT TRANSACTION;

  SELECT
    N'Migration prasyarat client_request_id berhasil diterapkan.' AS message,
    COL_LENGTH(N'dbo.replenish_work_orders', N'client_request_id') AS client_request_id_length;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
