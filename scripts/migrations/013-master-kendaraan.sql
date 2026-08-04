SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.master_uker', N'U') IS NULL
    THROW 51001, 'Tabel dbo.master_uker tidak ditemukan.', 1;

  IF OBJECT_ID(N'dbo.master_kendaraan', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.master_kendaraan (
      id BIGINT IDENTITY(1,1) NOT NULL,
      uker_id BIGINT NOT NULL,
      jenis_kendaraan VARCHAR(10) NOT NULL,
      merk_kendaraan NVARCHAR(100) NOT NULL,
      nomor_kendaraan VARCHAR(20) NOT NULL,
      status VARCHAR(10) NOT NULL
        CONSTRAINT DF_master_kendaraan_status DEFAULT ('AKTIF'),
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_master_kendaraan_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_master_kendaraan_updated_at DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_master_kendaraan PRIMARY KEY CLUSTERED (id),
      CONSTRAINT FK_master_kendaraan_master_uker
        FOREIGN KEY (uker_id) REFERENCES dbo.master_uker(id),
      CONSTRAINT CK_master_kendaraan_jenis
        CHECK (jenis_kendaraan IN ('MOBIL', 'MOTOR')),
      CONSTRAINT CK_master_kendaraan_merk_not_blank
        CHECK (LEN(LTRIM(RTRIM(merk_kendaraan))) > 0),
      CONSTRAINT CK_master_kendaraan_nomor_not_blank
        CHECK (LEN(LTRIM(RTRIM(nomor_kendaraan))) > 0),
      CONSTRAINT CK_master_kendaraan_status
        CHECK (status IN ('AKTIF', 'NONAKTIF'))
    );
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_kendaraan')
      AND name = N'UX_master_kendaraan_nomor'
  )
    CREATE UNIQUE INDEX UX_master_kendaraan_nomor
      ON dbo.master_kendaraan(nomor_kendaraan);

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_kendaraan')
      AND name = N'IX_master_kendaraan_uker_status'
  )
    CREATE INDEX IX_master_kendaraan_uker_status
      ON dbo.master_kendaraan(uker_id, status, id DESC)
      INCLUDE (jenis_kendaraan, merk_kendaraan, nomor_kendaraan, updated_at);

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_kendaraan')
      AND name = N'IX_master_kendaraan_jenis_status'
  )
    CREATE INDEX IX_master_kendaraan_jenis_status
      ON dbo.master_kendaraan(jenis_kendaraan, status, id DESC)
      INCLUDE (uker_id, merk_kendaraan, nomor_kendaraan, updated_at);

  COMMIT TRANSACTION;

  SELECT 'Migration 013 master kendaraan berhasil dijalankan.' AS message;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
