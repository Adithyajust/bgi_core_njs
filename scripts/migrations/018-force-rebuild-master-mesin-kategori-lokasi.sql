SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.master_mesin', N'U') IS NULL
  THROW 51080, 'Tabel dbo.master_mesin belum tersedia.', 1;

/*
 * Migration 018 sengaja dibuat dengan versi baru agar tetap dijalankan
 * apabila migration 016/017 pernah tercatat, tetapi constraint pada
 * database aktif belum benar-benar berubah.
 */

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

/* Normalisasi nilai lama yang umum ditemukan pada data operasional. */
UPDATE dbo.master_mesin
SET kategori_lokasi = CASE
  WHEN kategori_lokasi IS NULL THEN NULL
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) IN (N'TOKO', N'AREA TOKO', N'AREA PERTOKOAN')
    THEN N'PERTOKOAN'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'ALFA MART'
    THEN N'ALFAMART'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'ALFA MIDI'
    THEN N'ALFAMIDI'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'INDO MARET'
    THEN N'INDOMARET'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) IN (N'MINIMARKET', N'MINI-MARKET')
    THEN N'MINI MARKET'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) IN (N'RUMAHSAKIT', N'RS')
    THEN N'RUMAH SAKIT'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) IN (N'INSTANSI PEMERINTAH', N'PEMERINTAHAN')
    THEN N'INSTANSI PEMERINTAHAN'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) IN (N'BUMN/BUMD', N'INSTANSI BUMN BUMD')
    THEN N'INSTANSI BUMN/BUMD'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'MILITER'
    THEN N'INSTANSI MILITER'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'TEMPAT OLAH RAGA'
    THEN N'TEMPAT OLAHRAGA'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'PENDIDIKAN'
    THEN N'TEMPAT PENDIDIKAN'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'WISATA'
    THEN N'TEMPAT WISATA'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'HIBURAN'
    THEN N'TEMPAT HIBURAN'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'BRI UNIT'
    THEN N'UNIT BRI'
  ELSE UPPER(LTRIM(RTRIM(kategori_lokasi)))
END;

DECLARE @invalidCategories NVARCHAR(1800);

SELECT @invalidCategories = STRING_AGG(CONVERT(NVARCHAR(MAX), kategori_lokasi), N', ')
FROM (
  SELECT DISTINCT kategori_lokasi
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
) invalid;

IF @invalidCategories IS NOT NULL
BEGIN
  DECLARE @message NVARCHAR(2048) =
    N'Migration 018 dihentikan. Kategori lama yang belum dikenali: ' +
    LEFT(@invalidCategories, 1700) +
    N'. Perbaiki nilai tersebut pada dbo.master_mesin, lalu jalankan migration kembali.';

  THROW 51081, @message, 1;
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

IF NOT EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
    AND name = N'CK_master_mesin_kategori_lokasi'
    AND is_disabled = 0
    AND is_not_trusted = 0
    AND UPPER(definition) LIKE N'%PERTOKOAN%'
)
  THROW 51082, 'Constraint kategori_lokasi belum berhasil diperbarui untuk mengizinkan PERTOKOAN.', 1;
