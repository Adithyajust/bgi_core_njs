SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.cpc_spare_cassettes', N'U') IS NULL
    THROW 55201, 'Tabel dbo.cpc_spare_cassettes belum tersedia. Jalankan migration 049 terlebih dahulu.', 1;

  /*
    Label adalah identitas fisik kaset, bukan pengunci denominasi permanen.
    Petugas CPC memilih denominasi setiap kali kaset disortir ulang.
  */
  IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.cpc_spare_cassettes')
      AND name = N'CK_cpc_spare_cassettes_serial_denom'
  )
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_spare_cassettes
        DROP CONSTRAINT CK_cpc_spare_cassettes_serial_denom;
    ';
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.cpc_spare_cassettes')
      AND name = N'CK_cpc_spare_cassettes_denomination'
  )
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_spare_cassettes WITH CHECK
        ADD CONSTRAINT CK_cpc_spare_cassettes_denomination
        CHECK (denomination_value IN (50000, 100000));
    ';
  END;

  COMMIT TRANSACTION;

  SELECT 'Migration 052 pilihan denom spare kaset berhasil dijalankan.' AS message;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
