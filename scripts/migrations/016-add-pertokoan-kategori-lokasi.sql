SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.master_mesin', N'U') IS NOT NULL
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
        AND name = N'CK_master_mesin_kategori_lokasi'
    )
    BEGIN
      ALTER TABLE dbo.master_mesin
        DROP CONSTRAINT CK_master_mesin_kategori_lokasi;
    END;

    ALTER TABLE dbo.master_mesin WITH CHECK
      ADD CONSTRAINT CK_master_mesin_kategori_lokasi
      CHECK (kategori_lokasi IN (
        N'ALFAMART', N'ALFAMIDI', N'APARTEMEN', N'BANDARA', N'HOTEL',
        N'INDOMARET', N'INSTANSI BUMN/BUMD', N'INSTANSI MILITER',
        N'INSTANSI PEMERINTAHAN', N'KC', N'KCP', N'KEPOLISIAN', N'KK',
        N'MALL', N'MINI MARKET', N'PASAR', N'PERKANTORAN', N'PERTOKOAN',
        N'PERUMAHAN', N'PLAZA', N'RUMAH SAKIT', N'SPBU', N'STASIUN',
        N'SWALAYAN', N'TEMPAT HIBURAN', N'TEMPAT OLAHRAGA',
        N'TEMPAT PENDIDIKAN', N'TEMPAT WISATA', N'UNIT BRI'
      ));

    ALTER TABLE dbo.master_mesin
      CHECK CONSTRAINT CK_master_mesin_kategori_lokasi;
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0
    ROLLBACK TRANSACTION;

  THROW;
END CATCH;
