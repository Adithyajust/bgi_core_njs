SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.master_mesin', N'U') IS NULL
    THROW 51101, 'Tabel dbo.master_mesin tidak ditemukan. Jalankan migration 009 terlebih dahulu.', 1;

  /*
    TID adalah kode terminal berbentuk teks dan harus unik untuk setiap mesin.
    Aturan akhir:
      - VARCHAR(50)
      - wajib diisi
      - tidak boleh kosong
      - unik untuk setiap mesin

    Dynamic SQL digunakan agar SQL Server tidak mengompilasi referensi kolom
    tid sebelum perintah ADD COLUMN selesai dijalankan.
  */
  IF COL_LENGTH(N'dbo.master_mesin', N'tid') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.master_mesin
      ADD tid VARCHAR(50) NULL;
    ';
  END;

  /* Rapikan nilai yang sudah ada agar konsisten dengan form aplikasi. */
  EXEC sys.sp_executesql N'
    UPDATE dbo.master_mesin
    SET tid = UPPER(LTRIM(RTRIM(tid)))
    WHERE tid IS NOT NULL;
  ';

  /* TID wajib tersedia sebelum kolom diubah menjadi NOT NULL. */
  EXEC sys.sp_executesql N'
    IF EXISTS (
      SELECT 1
      FROM dbo.master_mesin
      WHERE tid IS NULL
         OR LTRIM(RTRIM(tid)) = ''''
    )
      THROW 51102, ''Masih ada data Mesin dengan TID NULL atau kosong. Lengkapi TID terlebih dahulu.'', 1;
  ';

  /* Pengecekan duplikat mengikuti normalisasi form: trim dan huruf kapital. */
  EXEC sys.sp_executesql N'
    IF EXISTS (
      SELECT UPPER(LTRIM(RTRIM(tid)))
      FROM dbo.master_mesin
      GROUP BY UPPER(LTRIM(RTRIM(tid)))
      HAVING COUNT_BIG(1) > 1
    )
      THROW 51103, ''Terdapat TID duplikat. Setiap mesin harus memiliki TID yang unik.'', 1;
  ';

  /* Hapus definisi versi lama jika migration pernah dijalankan sebelumnya. */
  IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_mesin')
      AND name = N'UX_master_mesin_tid'
  )
    DROP INDEX UX_master_mesin_tid ON dbo.master_mesin;

  IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
      AND name = N'CK_master_mesin_tid_not_blank'
  )
    ALTER TABLE dbo.master_mesin
      DROP CONSTRAINT CK_master_mesin_tid_not_blank;

  EXEC sys.sp_executesql N'
    ALTER TABLE dbo.master_mesin
    ALTER COLUMN tid VARCHAR(50) NOT NULL;
  ';

  EXEC sys.sp_executesql N'
    ALTER TABLE dbo.master_mesin WITH CHECK
    ADD CONSTRAINT CK_master_mesin_tid_not_blank
    CHECK (LEN(LTRIM(RTRIM(tid))) > 0);
  ';

  EXEC sys.sp_executesql N'
    CREATE UNIQUE INDEX UX_master_mesin_tid
    ON dbo.master_mesin(tid);
  ';

  COMMIT TRANSACTION;

  SELECT
    N'Migration 011 berhasil. TID sekarang wajib dan unik.' AS message,
    COL_LENGTH(N'dbo.master_mesin', N'tid') AS tid_column_length;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0
    ROLLBACK TRANSACTION;

  THROW;
END CATCH;

/* Verifikasi hasil akhir. */
SELECT
  c.name AS column_name,
  TYPE_NAME(c.user_type_id) AS data_type,
  c.max_length,
  c.is_nullable
FROM sys.columns c
WHERE c.object_id = OBJECT_ID(N'dbo.master_mesin')
  AND c.name = N'tid';

SELECT
  i.name AS index_name,
  i.is_unique,
  i.filter_definition
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID(N'dbo.master_mesin')
  AND i.name = N'UX_master_mesin_tid';
