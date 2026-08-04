SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.master_mesin', N'U') IS NULL
  THROW 51090, 'Tabel dbo.master_mesin belum tersedia.', 1;

IF COL_LENGTH(N'dbo.master_mesin', N'kategori_lokasi') IS NULL
  THROW 51091, 'Kolom dbo.master_mesin.kategori_lokasi belum tersedia.', 1;

IF COL_LENGTH(N'dbo.master_mesin', N'waktu_ops') IS NULL
  THROW 51092, 'Kolom dbo.master_mesin.waktu_ops belum tersedia.', 1;

/*
 * Tambahkan pilihan form/upload:
 * - Kategori Lokasi: APOTEK, TERAS BRI, KANTOR PUSAT
 * - Waktu Operasional: 09:00 - 15:00
 *
 * Versi migration baru diperlukan karena migration lama yang sudah tercatat
 * tidak boleh diubah untuk memperbaiki database yang telah berjalan.
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

IF EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
    AND name = N'CK_master_mesin_waktu_ops'
)
BEGIN
  ALTER TABLE dbo.master_mesin
    DROP CONSTRAINT CK_master_mesin_waktu_ops;
END;

/* Normalisasi variasi kategori yang umum dari data Excel lama. */
UPDATE dbo.master_mesin
SET kategori_lokasi = CASE
  WHEN kategori_lokasi IS NULL THEN NULL
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'APOTIK' THEN N'APOTEK'
  WHEN REPLACE(UPPER(LTRIM(RTRIM(kategori_lokasi))), N' ', N'') = N'TERASBRI'
    THEN N'TERAS BRI'
  WHEN REPLACE(UPPER(LTRIM(RTRIM(kategori_lokasi))), N' ', N'') = N'KANTORPUSAT'
    THEN N'KANTOR PUSAT'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) IN (N'TOKO', N'AREA TOKO', N'AREA PERTOKOAN')
    THEN N'PERTOKOAN'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'ALFA MART' THEN N'ALFAMART'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'ALFA MIDI' THEN N'ALFAMIDI'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'INDO MARET' THEN N'INDOMARET'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) IN (N'MINIMARKET', N'MINI-MARKET')
    THEN N'MINI MARKET'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) IN (N'RUMAHSAKIT', N'RS')
    THEN N'RUMAH SAKIT'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) IN (N'INSTANSI PEMERINTAH', N'PEMERINTAHAN')
    THEN N'INSTANSI PEMERINTAHAN'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) IN (N'BUMN/BUMD', N'INSTANSI BUMN BUMD')
    THEN N'INSTANSI BUMN/BUMD'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'MILITER' THEN N'INSTANSI MILITER'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'TEMPAT OLAH RAGA'
    THEN N'TEMPAT OLAHRAGA'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'PENDIDIKAN'
    THEN N'TEMPAT PENDIDIKAN'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'WISATA' THEN N'TEMPAT WISATA'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'HIBURAN' THEN N'TEMPAT HIBURAN'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'BRI UNIT' THEN N'UNIT BRI'
  ELSE UPPER(LTRIM(RTRIM(kategori_lokasi)))
END;

/* Normalisasi variasi penulisan rentang jam yang umum dari Excel. */
UPDATE dbo.master_mesin
SET waktu_ops = CASE
  WHEN waktu_ops IS NULL THEN NULL
  WHEN REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(waktu_ops)), '.', ':'), N'–', '-'), N'—', '-')
       IN ('09:00-15:00', '09:00 -15:00', '09:00- 15:00', '09:00 - 15:00')
    THEN '09:00 - 15:00'
  ELSE LTRIM(RTRIM(waktu_ops))
END;

DECLARE @invalidCategories NVARCHAR(1800);

SELECT @invalidCategories = STRING_AGG(CONVERT(NVARCHAR(MAX), kategori_lokasi), N', ')
FROM (
  SELECT DISTINCT kategori_lokasi
  FROM dbo.master_mesin
  WHERE kategori_lokasi IS NULL
     OR kategori_lokasi NOT IN (
        N'ALFAMART', N'ALFAMIDI', N'APARTEMEN', N'APOTEK', N'BANDARA', N'HOTEL',
        N'INDOMARET', N'INSTANSI BUMN/BUMD', N'INSTANSI MILITER',
        N'INSTANSI PEMERINTAHAN', N'KANTOR PUSAT', N'KC', N'KCP', N'KEPOLISIAN', N'KK',
        N'MALL', N'MINI MARKET', N'PASAR', N'PERKANTORAN', N'PERTOKOAN',
        N'PERUMAHAN', N'PLAZA', N'RUMAH SAKIT', N'SPBU', N'STASIUN',
        N'SWALAYAN', N'TERAS BRI', N'TEMPAT HIBURAN', N'TEMPAT OLAHRAGA',
        N'TEMPAT PENDIDIKAN', N'TEMPAT WISATA', N'UNIT BRI'
     )
) invalid;

IF @invalidCategories IS NOT NULL
BEGIN
  DECLARE @categoryMessage NVARCHAR(2048) =
    N'Migration 019 dihentikan. Kategori lama yang belum dikenali: ' +
    LEFT(@invalidCategories, 1700) +
    N'. Perbaiki nilai tersebut pada dbo.master_mesin, lalu jalankan migration kembali.';

  THROW 51093, @categoryMessage, 1;
END;

DECLARE @invalidTimes NVARCHAR(1800);

SELECT @invalidTimes = STRING_AGG(CONVERT(NVARCHAR(MAX), waktu_ops), N', ')
FROM (
  SELECT DISTINCT waktu_ops
  FROM dbo.master_mesin
  WHERE waktu_ops IS NULL
     OR waktu_ops NOT IN (
        '00:00 - 23:59', '06:00 - 15:00', '06:00 - 18:00',
        '06:00 - 21:00', '09:00 - 15:00', '09:00 - 18:00', '09:00 - 21:00'
     )
) invalid;

IF @invalidTimes IS NOT NULL
BEGIN
  DECLARE @timeMessage NVARCHAR(2048) =
    N'Migration 019 dihentikan. Waktu operasional lama yang belum dikenali: ' +
    LEFT(@invalidTimes, 1700) +
    N'. Perbaiki nilai tersebut pada dbo.master_mesin, lalu jalankan migration kembali.';

  THROW 51094, @timeMessage, 1;
END;

ALTER TABLE dbo.master_mesin WITH CHECK
  ADD CONSTRAINT CK_master_mesin_kategori_lokasi
  CHECK (kategori_lokasi IN (
    N'ALFAMART', N'ALFAMIDI', N'APARTEMEN', N'APOTEK', N'BANDARA', N'HOTEL',
    N'INDOMARET', N'INSTANSI BUMN/BUMD', N'INSTANSI MILITER',
    N'INSTANSI PEMERINTAHAN', N'KANTOR PUSAT', N'KC', N'KCP', N'KEPOLISIAN', N'KK',
    N'MALL', N'MINI MARKET', N'PASAR', N'PERKANTORAN', N'PERTOKOAN',
    N'PERUMAHAN', N'PLAZA', N'RUMAH SAKIT', N'SPBU', N'STASIUN',
    N'SWALAYAN', N'TERAS BRI', N'TEMPAT HIBURAN', N'TEMPAT OLAHRAGA',
    N'TEMPAT PENDIDIKAN', N'TEMPAT WISATA', N'UNIT BRI'
  ));

ALTER TABLE dbo.master_mesin WITH CHECK
  ADD CONSTRAINT CK_master_mesin_waktu_ops
  CHECK (waktu_ops IN (
    '00:00 - 23:59', '06:00 - 15:00', '06:00 - 18:00',
    '06:00 - 21:00', '09:00 - 15:00', '09:00 - 18:00', '09:00 - 21:00'
  ));

ALTER TABLE dbo.master_mesin CHECK CONSTRAINT CK_master_mesin_kategori_lokasi;
ALTER TABLE dbo.master_mesin CHECK CONSTRAINT CK_master_mesin_waktu_ops;

IF NOT EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
    AND name = N'CK_master_mesin_kategori_lokasi'
    AND is_disabled = 0
    AND is_not_trusted = 0
    AND UPPER(definition) LIKE N'%APOTEK%'
    AND UPPER(definition) LIKE N'%TERAS BRI%'
    AND UPPER(definition) LIKE N'%KANTOR PUSAT%'
)
  THROW 51095, 'Constraint Kategori Lokasi belum berhasil diperbarui.', 1;

IF NOT EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
    AND name = N'CK_master_mesin_waktu_ops'
    AND is_disabled = 0
    AND is_not_trusted = 0
    AND definition LIKE N'%09:00 - 15:00%'
)
  THROW 51096, 'Constraint Waktu Operasional belum mengizinkan 09:00 - 15:00.', 1;
