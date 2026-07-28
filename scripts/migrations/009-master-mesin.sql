SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.master_cabang', N'U') IS NULL
    THROW 50901, 'Tabel dbo.master_cabang tidak ditemukan. Jalankan migration 007 terlebih dahulu.', 1;

  IF OBJECT_ID(N'dbo.master_project', N'U') IS NULL
    THROW 50902, 'Tabel dbo.master_project tidak ditemukan. Jalankan migration 006 terlebih dahulu.', 1;

  IF OBJECT_ID(N'dbo.master_tipe_mesin', N'U') IS NULL
    THROW 50903, 'Tabel dbo.master_tipe_mesin tidak ditemukan. Jalankan migration 008 terlebih dahulu.', 1;

  /*
    cabang_id       = cabang pengelola
    lokasi          = lokasi fisik TID, tidak mengikuti alamat cabang
    kategori_mesin  = kategori/jenis mesin dari Master Tipe Mesin
    kategori_lokasi = kategori penempatan seperti KC, MALL, SPBU, dan lainnya
  */
  IF OBJECT_ID(N'dbo.master_mesin', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.master_mesin (
      id BIGINT IDENTITY(1,1) NOT NULL,
      sn VARCHAR(100) NOT NULL,
      db NVARCHAR(100) NULL,
      cabang_id INT NOT NULL,
      project_id BIGINT NOT NULL,
      lokasi NVARCHAR(500) NOT NULL,
      site VARCHAR(10) NOT NULL,
      kategori_mesin NVARCHAR(100) NOT NULL,
      tipe_mesin_id INT NOT NULL,
      kategori_lokasi NVARCHAR(50) NOT NULL,
      garansi VARCHAR(20) NOT NULL,
      hari_ops VARCHAR(20) NOT NULL,
      jam_ops VARCHAR(20) NOT NULL,
      waktu_ops VARCHAR(20) NOT NULL,
      longitude DECIMAL(9,6) NULL,
      latitude DECIMAL(9,6) NULL,
      is_active BIT NOT NULL
        CONSTRAINT DF_master_mesin_is_active DEFAULT (1),
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_master_mesin_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_master_mesin_updated_at DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,

      CONSTRAINT PK_master_mesin PRIMARY KEY CLUSTERED (id),
      CONSTRAINT CK_master_mesin_sn_not_blank
        CHECK (LEN(LTRIM(RTRIM(sn))) > 0),
      CONSTRAINT CK_master_mesin_lokasi_not_blank
        CHECK (LEN(LTRIM(RTRIM(lokasi))) > 0),
      CONSTRAINT CK_master_mesin_kategori_mesin_not_blank
        CHECK (LEN(LTRIM(RTRIM(kategori_mesin))) > 0),
      CONSTRAINT CK_master_mesin_site
        CHECK (site IN ('ONSITE', 'OFFSITE')),
      CONSTRAINT CK_master_mesin_kategori_lokasi
        CHECK (kategori_lokasi IN (
          N'ALFAMART', N'ALFAMIDI', N'APARTEMEN', N'BANDARA', N'HOTEL',
          N'INDOMARET', N'INSTANSI BUMN/BUMD', N'INSTANSI MILITER',
          N'INSTANSI PEMERINTAHAN', N'KC', N'KCP', N'KEPOLISIAN', N'KK',
          N'MALL', N'MINI MARKET', N'PASAR', N'PERKANTORAN', N'PERUMAHAN',
          N'PLAZA', N'RUMAH SAKIT', N'SPBU', N'STASIUN', N'SWALAYAN',
          N'TEMPAT HIBURAN', N'TEMPAT OLAHRAGA', N'TEMPAT PENDIDIKAN',
          N'TEMPAT WISATA', N'UNIT BRI'
        )),
      CONSTRAINT CK_master_mesin_garansi
        CHECK (garansi IN ('IN WARRANTY', 'OUT WARRANTY')),
      CONSTRAINT CK_master_mesin_hari_ops
        CHECK (hari_ops IN ('WEEKDAYS', 'ALL DAYS')),
      CONSTRAINT CK_master_mesin_jam_ops
        CHECK (jam_ops IN ('24 JAM', 'NON 24 JAM')),
      CONSTRAINT CK_master_mesin_waktu_ops
        CHECK (waktu_ops IN (
          '00:00 - 23:59', '06:00 - 15:00', '06:00 - 18:00',
          '06:00 - 21:00', '09:00 - 18:00', '09:00 - 21:00'
        )),
      CONSTRAINT CK_master_mesin_longitude
        CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
      CONSTRAINT CK_master_mesin_latitude
        CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90)
    );
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
      AND name = N'FK_master_mesin_master_cabang'
  )
  BEGIN
    ALTER TABLE dbo.master_mesin WITH CHECK
      ADD CONSTRAINT FK_master_mesin_master_cabang
      FOREIGN KEY (cabang_id) REFERENCES dbo.master_cabang(id);
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
      AND name = N'FK_master_mesin_master_project'
  )
  BEGIN
    ALTER TABLE dbo.master_mesin WITH CHECK
      ADD CONSTRAINT FK_master_mesin_master_project
      FOREIGN KEY (project_id) REFERENCES dbo.master_project(id);
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
      AND name = N'FK_master_mesin_master_tipe_mesin'
  )
  BEGIN
    ALTER TABLE dbo.master_mesin WITH CHECK
      ADD CONSTRAINT FK_master_mesin_master_tipe_mesin
      FOREIGN KEY (tipe_mesin_id) REFERENCES dbo.master_tipe_mesin(id);
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_mesin')
      AND name = N'UX_master_mesin_sn'
  )
    CREATE UNIQUE INDEX UX_master_mesin_sn ON dbo.master_mesin(sn);

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_mesin')
      AND name = N'IX_master_mesin_cabang_active'
  )
    CREATE INDEX IX_master_mesin_cabang_active
      ON dbo.master_mesin(cabang_id, is_active, id DESC)
      INCLUDE (sn, project_id, tipe_mesin_id, kategori_mesin,
               kategori_lokasi, site, garansi, updated_at);

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_mesin')
      AND name = N'IX_master_mesin_project_active'
  )
    CREATE INDEX IX_master_mesin_project_active
      ON dbo.master_mesin(project_id, is_active, id DESC)
      INCLUDE (sn, cabang_id, tipe_mesin_id, kategori_mesin,
               kategori_lokasi, site, updated_at);

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_mesin')
      AND name = N'IX_master_mesin_tipe_active'
  )
    CREATE INDEX IX_master_mesin_tipe_active
      ON dbo.master_mesin(tipe_mesin_id, is_active, id DESC)
      INCLUDE (sn, cabang_id, project_id, kategori_mesin,
               kategori_lokasi, site, updated_at);

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_mesin')
      AND name = N'IX_master_mesin_kategori_site_active'
  )
    CREATE INDEX IX_master_mesin_kategori_site_active
      ON dbo.master_mesin(kategori_mesin, kategori_lokasi, site, is_active, id DESC)
      INCLUDE (sn, cabang_id, project_id, tipe_mesin_id, garansi, updated_at);

  COMMIT TRANSACTION;

  SELECT
    'Migration 009 master mesin berhasil dijalankan dengan kategori_mesin, kategori_lokasi, dan is_active.' AS message,
    OBJECT_ID(N'dbo.master_mesin', N'U') AS master_mesin_object_id;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
