SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.master_mesin', N'U') IS NULL
    THROW 51001, 'Tabel dbo.master_mesin tidak ditemukan. Jalankan migration 009 terlebih dahulu.', 1;

  IF OBJECT_ID(N'dbo.master_tipe_mesin', N'U') IS NULL
    THROW 51002, 'Tabel dbo.master_tipe_mesin tidak ditemukan. Jalankan migration 008 terlebih dahulu.', 1;

  /* Hapus indeks lama sebelum rename atau penambahan kolom. */
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.master_mesin') AND name = N'IX_master_mesin_cabang_active')
    DROP INDEX IX_master_mesin_cabang_active ON dbo.master_mesin;
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.master_mesin') AND name = N'IX_master_mesin_project_active')
    DROP INDEX IX_master_mesin_project_active ON dbo.master_mesin;
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.master_mesin') AND name = N'IX_master_mesin_tipe_active')
    DROP INDEX IX_master_mesin_tipe_active ON dbo.master_mesin;
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.master_mesin') AND name = N'IX_master_mesin_kategori_site_active')
    DROP INDEX IX_master_mesin_kategori_site_active ON dbo.master_mesin;

  IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
      AND name = N'CK_master_mesin_kategori'
  )
    ALTER TABLE dbo.master_mesin DROP CONSTRAINT CK_master_mesin_kategori;

  /* Kolom kategori lama berisi kategori lokasi. */
  IF COL_LENGTH(N'dbo.master_mesin', N'kategori_lokasi') IS NULL
     AND COL_LENGTH(N'dbo.master_mesin', N'kategori') IS NOT NULL
    EXEC sp_rename N'dbo.master_mesin.kategori', N'kategori_lokasi', N'COLUMN';

  IF COL_LENGTH(N'dbo.master_mesin', N'kategori_lokasi') IS NULL
    ALTER TABLE dbo.master_mesin ADD kategori_lokasi NVARCHAR(50) NULL;

  IF COL_LENGTH(N'dbo.master_mesin', N'kategori_mesin') IS NULL
    ALTER TABLE dbo.master_mesin ADD kategori_mesin NVARCHAR(100) NULL;

  /* Penambahan is_active untuk struktur lama yang belum memilikinya. */
  IF COL_LENGTH(N'dbo.master_mesin', N'is_active') IS NULL
    ALTER TABLE dbo.master_mesin
      ADD is_active BIT NOT NULL
        CONSTRAINT DF_master_mesin_is_active DEFAULT (1) WITH VALUES;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.default_constraints dc
    INNER JOIN sys.columns c
      ON c.object_id = dc.parent_object_id
     AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID(N'dbo.master_mesin')
      AND c.name = N'is_active'
  )
    ALTER TABLE dbo.master_mesin
      ADD CONSTRAINT DF_master_mesin_is_active DEFAULT (1) FOR is_active;

  /* Kategori mesin selalu mengikuti jenis_mesin dari tipe yang dipilih. */
  UPDATE ms
  SET kategori_mesin = UPPER(LTRIM(RTRIM(tm.jenis_mesin)))
  FROM dbo.master_mesin ms
  INNER JOIN dbo.master_tipe_mesin tm ON tm.id = ms.tipe_mesin_id
  WHERE ms.kategori_mesin IS NULL
     OR LTRIM(RTRIM(ms.kategori_mesin)) = N'';

  IF EXISTS (
    SELECT 1 FROM dbo.master_mesin
    WHERE kategori_mesin IS NULL OR LTRIM(RTRIM(kategori_mesin)) = N''
  )
    THROW 51003, 'Kategori Mesin gagal diisi. Periksa relasi tipe_mesin_id.', 1;

  IF EXISTS (
    SELECT 1 FROM dbo.master_mesin
    WHERE kategori_lokasi IS NULL OR LTRIM(RTRIM(kategori_lokasi)) = N''
  )
    THROW 51004, 'Kategori Lokasi masih kosong. Lengkapi data lama terlebih dahulu.', 1;

  ALTER TABLE dbo.master_mesin ALTER COLUMN kategori_mesin NVARCHAR(100) NOT NULL;
  ALTER TABLE dbo.master_mesin ALTER COLUMN kategori_lokasi NVARCHAR(50) NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
      AND name = N'CK_master_mesin_kategori_mesin_not_blank'
  )
    ALTER TABLE dbo.master_mesin WITH CHECK
      ADD CONSTRAINT CK_master_mesin_kategori_mesin_not_blank
      CHECK (LEN(LTRIM(RTRIM(kategori_mesin))) > 0);

  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
      AND name = N'CK_master_mesin_kategori_lokasi'
  )
    ALTER TABLE dbo.master_mesin WITH CHECK
      ADD CONSTRAINT CK_master_mesin_kategori_lokasi
      CHECK (kategori_lokasi IN (
        N'ALFAMART', N'ALFAMIDI', N'APARTEMEN', N'BANDARA', N'HOTEL',
        N'INDOMARET', N'INSTANSI BUMN/BUMD', N'INSTANSI MILITER',
        N'INSTANSI PEMERINTAHAN', N'KC', N'KCP', N'KEPOLISIAN', N'KK',
        N'MALL', N'MINI MARKET', N'PASAR', N'PERKANTORAN', N'PERUMAHAN',
        N'PLAZA', N'RUMAH SAKIT', N'SPBU', N'STASIUN', N'SWALAYAN',
        N'TEMPAT HIBURAN', N'TEMPAT OLAHRAGA', N'TEMPAT PENDIDIKAN',
        N'TEMPAT WISATA', N'UNIT BRI'
      ));

  CREATE INDEX IX_master_mesin_cabang_active
    ON dbo.master_mesin(cabang_id, is_active, id DESC)
    INCLUDE (sn, project_id, tipe_mesin_id, kategori_mesin,
             kategori_lokasi, site, garansi, updated_at);

  CREATE INDEX IX_master_mesin_project_active
    ON dbo.master_mesin(project_id, is_active, id DESC)
    INCLUDE (sn, cabang_id, tipe_mesin_id, kategori_mesin,
             kategori_lokasi, site, updated_at);

  CREATE INDEX IX_master_mesin_tipe_active
    ON dbo.master_mesin(tipe_mesin_id, is_active, id DESC)
    INCLUDE (sn, cabang_id, project_id, kategori_mesin,
             kategori_lokasi, site, updated_at);

  CREATE INDEX IX_master_mesin_kategori_site_active
    ON dbo.master_mesin(kategori_mesin, kategori_lokasi, site, is_active, id DESC)
    INCLUDE (sn, cabang_id, project_id, tipe_mesin_id, garansi, updated_at);

  COMMIT TRANSACTION;

  SELECT 'Migration 010 kategori ganda dan is_active berhasil dijalankan.' AS message;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
