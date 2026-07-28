SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  /*
    Master Kanwil
    INT dipakai karena tabel master tidak membutuhkan kapasitas BIGINT.
    Audit timestamp dan ROWVERSION membantu pelacakan serta kontrol update.
  */
  IF OBJECT_ID(N'dbo.master_kanwil', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.master_kanwil (
      id INT IDENTITY(1,1) NOT NULL,
      kode_kanwil VARCHAR(20) NOT NULL,
      nama_kanwil NVARCHAR(150) NOT NULL,
      is_active BIT NOT NULL
        CONSTRAINT DF_master_kanwil_is_active DEFAULT (1),
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_master_kanwil_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_master_kanwil_updated_at DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_master_kanwil PRIMARY KEY CLUSTERED (id),
      CONSTRAINT CK_master_kanwil_kode_not_blank
        CHECK (LEN(LTRIM(RTRIM(kode_kanwil))) > 0),
      CONSTRAINT CK_master_kanwil_nama_not_blank
        CHECK (LEN(LTRIM(RTRIM(nama_kanwil))) > 0)
    );
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_kanwil')
      AND name = N'UX_master_kanwil_kode'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_master_kanwil_kode
      ON dbo.master_kanwil(kode_kanwil);
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_kanwil')
      AND name = N'IX_master_kanwil_active_nama'
  )
  BEGIN
    CREATE INDEX IX_master_kanwil_active_nama
      ON dbo.master_kanwil(is_active, nama_kanwil)
      INCLUDE (kode_kanwil, updated_at);
  END;

  /*
    Master Cabang
    Setiap cabang wajib terhubung ke satu Kanwil.
    Tidak memakai ON DELETE CASCADE agar penghapusan Kanwil yang masih
    memiliki Cabang selalu ditolak oleh database.
  */
  IF OBJECT_ID(N'dbo.master_cabang', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.master_cabang (
      id INT IDENTITY(1,1) NOT NULL,
      kanwil_id INT NOT NULL,
      kode_cabang VARCHAR(30) NOT NULL,
      nama_cabang NVARCHAR(150) NOT NULL,
      is_active BIT NOT NULL
        CONSTRAINT DF_master_cabang_is_active DEFAULT (1),
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_master_cabang_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_master_cabang_updated_at DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_master_cabang PRIMARY KEY CLUSTERED (id),
      CONSTRAINT CK_master_cabang_kode_not_blank
        CHECK (LEN(LTRIM(RTRIM(kode_cabang))) > 0),
      CONSTRAINT CK_master_cabang_nama_not_blank
        CHECK (LEN(LTRIM(RTRIM(nama_cabang))) > 0)
    );
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID(N'dbo.master_cabang')
      AND name = N'FK_master_cabang_master_kanwil'
  )
  BEGIN
    ALTER TABLE dbo.master_cabang WITH CHECK
      ADD CONSTRAINT FK_master_cabang_master_kanwil
      FOREIGN KEY (kanwil_id)
      REFERENCES dbo.master_kanwil(id);

    ALTER TABLE dbo.master_cabang
      CHECK CONSTRAINT FK_master_cabang_master_kanwil;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_cabang')
      AND name = N'UX_master_cabang_kode'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_master_cabang_kode
      ON dbo.master_cabang(kode_cabang);
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_cabang')
      AND name = N'UX_master_cabang_kanwil_nama'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_master_cabang_kanwil_nama
      ON dbo.master_cabang(kanwil_id, nama_cabang);
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_cabang')
      AND name = N'IX_master_cabang_kanwil_active'
  )
  BEGIN
    CREATE INDEX IX_master_cabang_kanwil_active
      ON dbo.master_cabang(kanwil_id, is_active, nama_cabang)
      INCLUDE (kode_cabang, updated_at);
  END;

  COMMIT TRANSACTION;

  SELECT
    'Migration 007 master kanwil dan cabang berhasil dijalankan.' AS message,
    OBJECT_ID(N'dbo.master_kanwil', N'U') AS master_kanwil_object_id,
    OBJECT_ID(N'dbo.master_cabang', N'U') AS master_cabang_object_id;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0
  BEGIN
    ROLLBACK TRANSACTION;
  END;

  THROW;
END CATCH;
