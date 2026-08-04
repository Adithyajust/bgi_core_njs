SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.master_mesin', N'U') IS NULL
    THROW 51501, 'Tabel dbo.master_mesin tidak ditemukan. Jalankan migration 009 terlebih dahulu.', 1;

  IF COL_LENGTH(N'dbo.master_mesin', N'tid') IS NULL
    THROW 51502, 'Kolom TID tidak ditemukan. Jalankan migration 011 terlebih dahulu.', 1;

  /*
    Periksa integritas sebelum UPDATE. Urutan ini mencegah UPDATE gagal lebih
    dahulu pada unique index lama ketika database memakai collation sensitif
    huruf besar/kecil dan memiliki nilai seperti tid-001 serta TID-001.
  */
  IF EXISTS (
    SELECT 1
    FROM dbo.master_mesin
    WHERE NULLIF(LTRIM(RTRIM(tid)), '') IS NULL
       OR NULLIF(LTRIM(RTRIM(sn)), '') IS NULL
  )
    THROW 51503, 'Masih terdapat TID atau SN kosong. Lengkapi data sebelum menjalankan migration.', 1;

  IF EXISTS (
    SELECT UPPER(LTRIM(RTRIM(tid)))
    FROM dbo.master_mesin
    GROUP BY UPPER(LTRIM(RTRIM(tid)))
    HAVING COUNT_BIG(1) > 1
  )
    THROW 51504, 'Terdapat TID duplikat setelah normalisasi.', 1;

  IF EXISTS (
    SELECT UPPER(LTRIM(RTRIM(sn)))
    FROM dbo.master_mesin
    GROUP BY UPPER(LTRIM(RTRIM(sn)))
    HAVING COUNT_BIG(1) > 1
  )
    THROW 51505, 'Terdapat SN duplikat setelah normalisasi.', 1;

  IF EXISTS (
    SELECT 1
    FROM dbo.master_mesin
    WHERE UPPER(LTRIM(RTRIM(tid))) = UPPER(LTRIM(RTRIM(sn)))
  )
    THROW 51506, 'Terdapat mesin dengan nilai TID dan SN yang sama.', 1;

  /* Samakan normalisasi aplikasi: trim dan huruf kapital. */
  UPDATE dbo.master_mesin
  SET
    tid = UPPER(LTRIM(RTRIM(tid))),
    sn = UPPER(LTRIM(RTRIM(sn)))
  WHERE tid <> UPPER(LTRIM(RTRIM(tid)))
     OR sn <> UPPER(LTRIM(RTRIM(sn)));

  IF COL_LENGTH(N'dbo.master_mesin', N'tid_normalized') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.master_mesin
      ADD tid_normalized AS UPPER(LTRIM(RTRIM(tid))) PERSISTED;
    ';
  END;

  IF COL_LENGTH(N'dbo.master_mesin', N'sn_normalized') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.master_mesin
      ADD sn_normalized AS UPPER(LTRIM(RTRIM(sn))) PERSISTED;
    ';
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_mesin')
      AND name = N'UX_master_mesin_tid_normalized'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_master_mesin_tid_normalized
      ON dbo.master_mesin(tid_normalized);
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_mesin')
      AND name = N'UX_master_mesin_sn_normalized'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_master_mesin_sn_normalized
      ON dbo.master_mesin(sn_normalized);
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
      AND name = N'CK_master_mesin_tid_sn_different'
  )
  BEGIN
    ALTER TABLE dbo.master_mesin WITH CHECK
      ADD CONSTRAINT CK_master_mesin_tid_sn_different
      CHECK (UPPER(LTRIM(RTRIM(tid))) <> UPPER(LTRIM(RTRIM(sn))));
  END;

  COMMIT TRANSACTION;

  SELECT N'Migration 015 berhasil. TID dan SN kini dinormalisasi, unik, dan tidak boleh sama.' AS message;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0
    ROLLBACK TRANSACTION;

  THROW;
END CATCH;
