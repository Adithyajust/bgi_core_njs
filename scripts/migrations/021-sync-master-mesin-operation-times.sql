SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.master_mesin', N'U') IS NULL
  THROW 51110, 'Tabel dbo.master_mesin belum tersedia.', 1;

IF COL_LENGTH(N'dbo.master_mesin', N'waktu_ops') IS NULL
  THROW 51111, 'Kolom dbo.master_mesin.waktu_ops belum tersedia.', 1;

/*
 * Menyamakan Waktu Operasional Master Mesin dengan tujuh nilai resmi:
 * 00:00 - 23:59
 * 06:00 - 15:00
 * 06:00 - 18:00
 * 06:00 - 21:00
 * 09:00 - 15:00
 * 09:00 - 18:00
 * 09:00 - 21:00
 *
 * Migration baru dibuat agar checksum migration lama tetap aman.
 */

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

/*
 * Normalisasi variasi yang umum ditemukan pada Excel:
 * titik sebagai pemisah jam, en dash/em dash/minus Unicode, dan spasi yang tidak konsisten.
 */
UPDATE dbo.master_mesin
SET waktu_ops = CASE
  WHEN waktu_ops IS NULL THEN NULL
  WHEN REPLACE(
         REPLACE(
           REPLACE(
             REPLACE(
               REPLACE(LTRIM(RTRIM(waktu_ops)), '.', ':'),
               N'–', '-'
             ),
             N'—', '-'
           ),
           N'−', '-'
         ),
         ' ', ''
       ) = '00:00-23:59' THEN '00:00 - 23:59'
  WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(waktu_ops)), '.', ':'), N'–', '-'), N'—', '-'), N'−', '-'), ' ', '') = '06:00-15:00' THEN '06:00 - 15:00'
  WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(waktu_ops)), '.', ':'), N'–', '-'), N'—', '-'), N'−', '-'), ' ', '') = '06:00-18:00' THEN '06:00 - 18:00'
  WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(waktu_ops)), '.', ':'), N'–', '-'), N'—', '-'), N'−', '-'), ' ', '') = '06:00-21:00' THEN '06:00 - 21:00'
  WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(waktu_ops)), '.', ':'), N'–', '-'), N'—', '-'), N'−', '-'), ' ', '') = '09:00-15:00' THEN '09:00 - 15:00'
  WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(waktu_ops)), '.', ':'), N'–', '-'), N'—', '-'), N'−', '-'), ' ', '') = '09:00-18:00' THEN '09:00 - 18:00'
  WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(waktu_ops)), '.', ':'), N'–', '-'), N'—', '-'), N'−', '-'), ' ', '') = '09:00-21:00' THEN '09:00 - 21:00'
  ELSE LTRIM(RTRIM(waktu_ops))
END;

DECLARE @invalidTimes NVARCHAR(1800);

SELECT @invalidTimes = STRING_AGG(CONVERT(NVARCHAR(MAX), waktu_ops), N', ')
FROM (
  SELECT DISTINCT waktu_ops
  FROM dbo.master_mesin
  WHERE waktu_ops IS NULL
     OR waktu_ops NOT IN (
       '00:00 - 23:59',
       '06:00 - 15:00',
       '06:00 - 18:00',
       '06:00 - 21:00',
       '09:00 - 15:00',
       '09:00 - 18:00',
       '09:00 - 21:00'
     )
) invalid;

IF @invalidTimes IS NOT NULL
BEGIN
  DECLARE @message NVARCHAR(2048) =
    N'Migration 021 dihentikan. Waktu Operasional yang belum terdapat dalam daftar resmi: ' +
    LEFT(@invalidTimes, 1700) +
    N'. Perbaiki nilai tersebut pada dbo.master_mesin, lalu jalankan migration kembali.';

  THROW 51112, @message, 1;
END;

ALTER TABLE dbo.master_mesin WITH CHECK
  ADD CONSTRAINT CK_master_mesin_waktu_ops
  CHECK (waktu_ops IN (
    '00:00 - 23:59',
    '06:00 - 15:00',
    '06:00 - 18:00',
    '06:00 - 21:00',
    '09:00 - 15:00',
    '09:00 - 18:00',
    '09:00 - 21:00'
  ));

ALTER TABLE dbo.master_mesin
  CHECK CONSTRAINT CK_master_mesin_waktu_ops;

IF NOT EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
    AND name = N'CK_master_mesin_waktu_ops'
    AND is_disabled = 0
    AND is_not_trusted = 0
    AND definition LIKE N'%00:00 - 23:59%'
    AND definition LIKE N'%06:00 - 15:00%'
    AND definition LIKE N'%06:00 - 18:00%'
    AND definition LIKE N'%06:00 - 21:00%'
    AND definition LIKE N'%09:00 - 15:00%'
    AND definition LIKE N'%09:00 - 18:00%'
    AND definition LIKE N'%09:00 - 21:00%'
)
  THROW 51113, 'Constraint Waktu Operasional belum berhasil disesuaikan dengan tujuh nilai resmi.', 1;
