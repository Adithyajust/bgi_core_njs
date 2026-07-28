SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  /*
    Master Merk
    Menyimpan identitas produsen atau merek mesin.
    Kolom status dan audit mengikuti pola tabel master yang sudah digunakan.
  */
  IF OBJECT_ID(N'dbo.master_merk', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.master_merk (
      id INT IDENTITY(1,1) NOT NULL,
      kode_merk VARCHAR(30) NOT NULL,
      nama_merk NVARCHAR(150) NOT NULL,
      is_active BIT NOT NULL
        CONSTRAINT DF_master_merk_is_active DEFAULT (1),
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_master_merk_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_master_merk_updated_at DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_master_merk PRIMARY KEY CLUSTERED (id),
      CONSTRAINT CK_master_merk_kode_not_blank
        CHECK (LEN(LTRIM(RTRIM(kode_merk))) > 0),
      CONSTRAINT CK_master_merk_nama_not_blank
        CHECK (LEN(LTRIM(RTRIM(nama_merk))) > 0)
    );
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_merk')
      AND name = N'UX_master_merk_kode'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_master_merk_kode
      ON dbo.master_merk(kode_merk);
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_merk')
      AND name = N'UX_master_merk_nama'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_master_merk_nama
      ON dbo.master_merk(nama_merk);
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_merk')
      AND name = N'IX_master_merk_active_nama'
  )
  BEGIN
    CREATE INDEX IX_master_merk_active_nama
      ON dbo.master_merk(is_active, nama_merk)
      INCLUDE (kode_merk, updated_at);
  END;

  /*
    Master Tipe Mesin
    Satu Merk dapat memiliki banyak kombinasi jenis mesin dan nama model.
    Tidak memakai ON DELETE CASCADE agar Merk yang masih digunakan tidak
    dapat terhapus tanpa sengaja.
  */
  IF OBJECT_ID(N'dbo.master_tipe_mesin', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.master_tipe_mesin (
      id INT IDENTITY(1,1) NOT NULL,
      merk_id INT NOT NULL,
      jenis_mesin NVARCHAR(100) NOT NULL,
      nama_model NVARCHAR(150) NOT NULL,
      is_active BIT NOT NULL
        CONSTRAINT DF_master_tipe_mesin_is_active DEFAULT (1),
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_master_tipe_mesin_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_master_tipe_mesin_updated_at DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_master_tipe_mesin PRIMARY KEY CLUSTERED (id),
      CONSTRAINT CK_master_tipe_mesin_jenis_not_blank
        CHECK (LEN(LTRIM(RTRIM(jenis_mesin))) > 0),
      CONSTRAINT CK_master_tipe_mesin_model_not_blank
        CHECK (LEN(LTRIM(RTRIM(nama_model))) > 0)
    );
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID(N'dbo.master_tipe_mesin')
      AND name = N'FK_master_tipe_mesin_master_merk'
  )
  BEGIN
    ALTER TABLE dbo.master_tipe_mesin WITH CHECK
      ADD CONSTRAINT FK_master_tipe_mesin_master_merk
      FOREIGN KEY (merk_id)
      REFERENCES dbo.master_merk(id);

    ALTER TABLE dbo.master_tipe_mesin
      CHECK CONSTRAINT FK_master_tipe_mesin_master_merk;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_tipe_mesin')
      AND name = N'UX_master_tipe_mesin_merk_jenis_model'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_master_tipe_mesin_merk_jenis_model
      ON dbo.master_tipe_mesin(merk_id, jenis_mesin, nama_model);
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_tipe_mesin')
      AND name = N'IX_master_tipe_mesin_merk_active'
  )
  BEGIN
    CREATE INDEX IX_master_tipe_mesin_merk_active
      ON dbo.master_tipe_mesin(merk_id, is_active, jenis_mesin, nama_model)
      INCLUDE (updated_at);
  END;

  COMMIT TRANSACTION;

  SELECT
    'Migration 008 master merk dan tipe mesin berhasil dijalankan.' AS message,
    OBJECT_ID(N'dbo.master_merk', N'U') AS master_merk_object_id,
    OBJECT_ID(N'dbo.master_tipe_mesin', N'U') AS master_tipe_mesin_object_id;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0
  BEGIN
    ROLLBACK TRANSACTION;
  END;

  THROW;
END CATCH;
