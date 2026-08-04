SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.master_mesin', N'U') IS NULL
  THROW 51100, 'Tabel dbo.master_mesin belum tersedia.', 1;

IF COL_LENGTH(N'dbo.master_mesin', N'kategori_lokasi') IS NULL
  THROW 51101, 'Kolom dbo.master_mesin.kategori_lokasi belum tersedia.', 1;

/*
 * Menyamakan kategori lokasi Master Mesin dengan daftar resmi terbaru.
 * Migration lama tidak diubah agar checksum database yang sudah berjalan tetap aman.
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

/* Bersihkan spasi/kapitalisasi dan normalisasi variasi umum sebelum constraint dibuat ulang. */
UPDATE dbo.master_mesin
SET kategori_lokasi = CASE
  WHEN kategori_lokasi IS NULL THEN NULL
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'APOTIK' THEN N'APOTEK'
  WHEN REPLACE(UPPER(LTRIM(RTRIM(kategori_lokasi))), N' ', N'') = N'BIKETHRU' THEN N'BIKE THRU'
  WHEN REPLACE(UPPER(LTRIM(RTRIM(kategori_lokasi))), N' ', N'') = N'BRIAGRO' THEN N'BRI AGRO'
  WHEN REPLACE(UPPER(LTRIM(RTRIM(kategori_lokasi))), N' ', N'') = N'DRIVETHRU' THEN N'DRIVE THRU'
  WHEN REPLACE(UPPER(LTRIM(RTRIM(kategori_lokasi))), N' ', N'') = N'KANTORPUSAT' THEN N'KANTOR PUSAT'
  WHEN REPLACE(UPPER(LTRIM(RTRIM(kategori_lokasi))), N' ', N'') = N'PANGKALANMILITER' THEN N'PANGKALAN MILITER'
  WHEN REPLACE(UPPER(LTRIM(RTRIM(kategori_lokasi))), N' ', N'') = N'RUMAHMAKAN' THEN N'RUMAH MAKAN'
  WHEN REPLACE(UPPER(LTRIM(RTRIM(kategori_lokasi))), N' ', N'') = N'TEMPATIBADAH' THEN N'TEMPAT IBADAH'
  WHEN REPLACE(UPPER(LTRIM(RTRIM(kategori_lokasi))), N' ', N'') = N'TERASBRI' THEN N'TERAS BRI'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) IN (N'TOKO', N'AREA TOKO', N'AREA PERTOKOAN') THEN N'PERTOKOAN'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'ALFA MART' THEN N'ALFAMART'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'ALFA MIDI' THEN N'ALFAMIDI'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'INDO MARET' THEN N'INDOMARET'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) IN (N'MINIMARKET', N'MINI-MARKET') THEN N'MINI MARKET'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) IN (N'RUMAHSAKIT', N'RS') THEN N'RUMAH SAKIT'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) IN (N'INSTANSI PEMERINTAH', N'PEMERINTAHAN') THEN N'INSTANSI PEMERINTAHAN'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) IN (N'BUMN/BUMD', N'INSTANSI BUMN BUMD') THEN N'INSTANSI BUMN/BUMD'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'MILITER' THEN N'INSTANSI MILITER'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'TEMPAT OLAH RAGA' THEN N'TEMPAT OLAHRAGA'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'PENDIDIKAN' THEN N'TEMPAT PENDIDIKAN'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'WISATA' THEN N'TEMPAT WISATA'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'HIBURAN' THEN N'TEMPAT HIBURAN'
  WHEN UPPER(LTRIM(RTRIM(kategori_lokasi))) = N'BRI UNIT' THEN N'UNIT BRI'
  ELSE UPPER(LTRIM(RTRIM(kategori_lokasi)))
END;

DECLARE @invalidCategories NVARCHAR(1800);

SELECT @invalidCategories = STRING_AGG(CONVERT(NVARCHAR(MAX), kategori_lokasi), N', ')
FROM (
  SELECT DISTINCT kategori_lokasi
  FROM dbo.master_mesin
  WHERE kategori_lokasi IS NULL
     OR kategori_lokasi NOT IN (
    N'ALFAMART',
    N'ALFAMIDI',
    N'APARTEMEN',
    N'APOTEK',
    N'BANDARA',
    N'BIKE THRU',
    N'BRI AGRO',
    N'DRIVE THRU',
    N'GTI',
    N'HOTEL',
    N'INDOMARET',
    N'INSTANSI BUMN/BUMD',
    N'INSTANSI MILITER',
    N'INSTANSI PEMERINTAHAN',
    N'KANINS',
    N'KANTOR PUSAT',
    N'KANWIL',
    N'KC',
    N'KCP',
    N'KEPOLISIAN',
    N'KK',
    N'KLINIK',
    N'MALL',
    N'MINI MARKET',
    N'PABRIK',
    N'PANGKALAN MILITER',
    N'PASAR',
    N'PELABUHAN',
    N'PERKANTORAN',
    N'PERKEBUNAN',
    N'PERTAMBANGAN',
    N'PERTOKOAN',
    N'PERUMAHAN',
    N'PLAZA',
    N'RUMAH MAKAN',
    N'RUMAH SAKIT',
    N'SPBU',
    N'STASIUN',
    N'SWALAYAN',
    N'TEMPAT HIBURAN',
    N'TEMPAT IBADAH',
    N'TEMPAT OLAHRAGA',
    N'TEMPAT PENDIDIKAN',
    N'TEMPAT WISATA',
    N'TERAS BRI',
    N'TERMINAL',
    N'UNIT BRI'
     )
) invalid;

IF @invalidCategories IS NOT NULL
BEGIN
  DECLARE @message NVARCHAR(2048) =
    N'Migration 020 dihentikan. Kategori lama yang belum terdapat dalam daftar resmi: ' +
    LEFT(@invalidCategories, 1700) +
    N'. Perbaiki nilai tersebut pada dbo.master_mesin, lalu jalankan migration kembali.';

  THROW 51102, @message, 1;
END;

ALTER TABLE dbo.master_mesin WITH CHECK
  ADD CONSTRAINT CK_master_mesin_kategori_lokasi
  CHECK (kategori_lokasi IN (
    N'ALFAMART',
    N'ALFAMIDI',
    N'APARTEMEN',
    N'APOTEK',
    N'BANDARA',
    N'BIKE THRU',
    N'BRI AGRO',
    N'DRIVE THRU',
    N'GTI',
    N'HOTEL',
    N'INDOMARET',
    N'INSTANSI BUMN/BUMD',
    N'INSTANSI MILITER',
    N'INSTANSI PEMERINTAHAN',
    N'KANINS',
    N'KANTOR PUSAT',
    N'KANWIL',
    N'KC',
    N'KCP',
    N'KEPOLISIAN',
    N'KK',
    N'KLINIK',
    N'MALL',
    N'MINI MARKET',
    N'PABRIK',
    N'PANGKALAN MILITER',
    N'PASAR',
    N'PELABUHAN',
    N'PERKANTORAN',
    N'PERKEBUNAN',
    N'PERTAMBANGAN',
    N'PERTOKOAN',
    N'PERUMAHAN',
    N'PLAZA',
    N'RUMAH MAKAN',
    N'RUMAH SAKIT',
    N'SPBU',
    N'STASIUN',
    N'SWALAYAN',
    N'TEMPAT HIBURAN',
    N'TEMPAT IBADAH',
    N'TEMPAT OLAHRAGA',
    N'TEMPAT PENDIDIKAN',
    N'TEMPAT WISATA',
    N'TERAS BRI',
    N'TERMINAL',
    N'UNIT BRI'
  ));

ALTER TABLE dbo.master_mesin CHECK CONSTRAINT CK_master_mesin_kategori_lokasi;

IF NOT EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
    AND name = N'CK_master_mesin_kategori_lokasi'
    AND is_disabled = 0
    AND is_not_trusted = 0
    AND UPPER(definition) LIKE N'%BIKE THRU%'
    AND UPPER(definition) LIKE N'%BRI AGRO%'
    AND UPPER(definition) LIKE N'%DRIVE THRU%'
    AND UPPER(definition) LIKE N'%KANINS%'
    AND UPPER(definition) LIKE N'%KANWIL%'
    AND UPPER(definition) LIKE N'%KLINIK%'
    AND UPPER(definition) LIKE N'%PABRIK%'
    AND UPPER(definition) LIKE N'%PELABUHAN%'
    AND UPPER(definition) LIKE N'%PERTAMBANGAN%'
    AND UPPER(definition) LIKE N'%TEMPAT IBADAH%'
    AND UPPER(definition) LIKE N'%TERMINAL%'
)
  THROW 51103, 'Constraint Kategori Lokasi belum berhasil disesuaikan dengan daftar resmi terbaru.', 1;
