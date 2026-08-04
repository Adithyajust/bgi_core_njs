SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.master_mesin', N'U') IS NULL
    THROW 51070, 'Tabel dbo.master_mesin belum tersedia.', 1;

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

  /*
   * Normalisasi nilai lama setelah constraint versi lama dilepas.
   * Alias yang pernah dipakai pada file operasional diarahkan ke nilai baku.
   */
  UPDATE dbo.master_mesin
  SET kategori_lokasi = CASE
    WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) IN (
      N'TOKO', N'AREA TOKO', N'AREA PERTOKOAN'
    ) THEN N'PERTOKOAN'
    ELSE UPPER(LTRIM(RTRIM(kategori_lokasi)))
  END
  WHERE kategori_lokasi IS NOT NULL;

  IF EXISTS (
    SELECT 1
    FROM dbo.master_mesin
    WHERE kategori_lokasi IS NULL
       OR kategori_lokasi NOT IN (
          N'ALFAMART', N'ALFAMIDI', N'APARTEMEN', N'BANDARA', N'HOTEL',
          N'INDOMARET', N'INSTANSI BUMN/BUMD', N'INSTANSI MILITER',
          N'INSTANSI PEMERINTAHAN', N'KC', N'KCP', N'KEPOLISIAN', N'KK',
          N'MALL', N'MINI MARKET', N'PASAR', N'PERKANTORAN', N'PERTOKOAN',
          N'PERUMAHAN', N'PLAZA', N'RUMAH SAKIT', N'SPBU', N'STASIUN',
          N'SWALAYAN', N'TEMPAT HIBURAN', N'TEMPAT OLAHRAGA',
          N'TEMPAT PENDIDIKAN', N'TEMPAT WISATA', N'UNIT BRI'
       )
  )
    THROW 51071, 'Masih terdapat kategori_lokasi lama yang tidak dikenal. Periksa data dbo.master_mesin sebelum melanjutkan migration.', 1;

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

  IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
      AND name = N'CK_master_mesin_kategori_lokasi'
      AND is_disabled = 0
      AND is_not_trusted = 0
      AND UPPER(definition) LIKE N'%PERTOKOAN%'
  )
    THROW 51072, 'Constraint kategori_lokasi gagal diperbarui untuk mengizinkan PERTOKOAN.', 1;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0
    ROLLBACK TRANSACTION;

  THROW;
END CATCH;
