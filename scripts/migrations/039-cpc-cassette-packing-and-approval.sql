SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.replenish_work_orders', N'U') IS NULL
    THROW 53901, 'Tabel dbo.replenish_work_orders belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.replenish_work_order_points', N'U') IS NULL
    THROW 53902, 'Tabel dbo.replenish_work_order_points belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.users', N'U') IS NULL
    THROW 53903, 'Tabel dbo.users belum tersedia.', 1;

  IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.replenish_work_orders')
      AND name = N'CK_replenish_wo_status'
  )
    ALTER TABLE dbo.replenish_work_orders DROP CONSTRAINT CK_replenish_wo_status;

  ALTER TABLE dbo.replenish_work_orders WITH CHECK
    ADD CONSTRAINT CK_replenish_wo_status CHECK (status IN (
      'DRAFT', 'MENUNGGU_PERSETUJUAN_TIM', 'DITOLAK', 'DISETUJUI',
      'MENUNGGU_VALIDASI_KASET', 'KASET_DALAM_PERSIAPAN', 'MENUNGGU_APPROVAL_CPC', 'KASET_SIAP',
      'MENUNGGU_PENYERAHAN_KUNCI', 'SIAP_BERANGKAT', 'BERANGKAT',
      'DALAM_PERJALANAN', 'TIBA_DI_LOKASI', 'MENUNGGU_KODE_KOMBINASI',
      'DALAM_PROSES_REPLENISH', 'SELESAI_DI_LOKASI', 'BERHASIL_SEBAGIAN',
      'GAGAL', 'DALAM_PERJALANAN_KEMBALI', 'TIBA_DI_KANTOR',
      'MENUNGGU_PENGEMBALIAN_KUNCI', 'MENUNGGU_PENERIMAAN_KASET',
      'DALAM_PENGHITUNGAN_CPC', 'DALAM_REKONSILIASI', 'TERDAPAT_SELISIH',
      'DALAM_INVESTIGASI', 'SELESAI', 'DITUTUP', 'DIBATALKAN'
    ));

  IF OBJECT_ID(N'dbo.cpc_packing_batches', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.cpc_packing_batches (
      id BIGINT IDENTITY(1,1) NOT NULL,
      work_order_id BIGINT NOT NULL,
      status VARCHAR(30) NOT NULL
        CONSTRAINT DF_cpc_packing_batch_status DEFAULT ('PACKING'),
      packing_notes NVARCHAR(1000) NULL,
      created_by INT NOT NULL,
      submitted_by INT NULL,
      submitted_at DATETIME2(0) NULL,
      approved_by INT NULL,
      approved_at DATETIME2(0) NULL,
      rejected_by INT NULL,
      rejected_at DATETIME2(0) NULL,
      approval_notes NVARCHAR(1000) NULL,
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_cpc_packing_batch_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_cpc_packing_batch_updated_at DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_cpc_packing_batches PRIMARY KEY CLUSTERED (id),
      CONSTRAINT UX_cpc_packing_batches_work_order UNIQUE (work_order_id),
      CONSTRAINT FK_cpc_packing_batch_work_order
        FOREIGN KEY (work_order_id) REFERENCES dbo.replenish_work_orders(id)
        ON DELETE CASCADE,
      CONSTRAINT FK_cpc_packing_batch_created_by
        FOREIGN KEY (created_by) REFERENCES dbo.users(id),
      CONSTRAINT FK_cpc_packing_batch_submitted_by
        FOREIGN KEY (submitted_by) REFERENCES dbo.users(id),
      CONSTRAINT FK_cpc_packing_batch_approved_by
        FOREIGN KEY (approved_by) REFERENCES dbo.users(id),
      CONSTRAINT FK_cpc_packing_batch_rejected_by
        FOREIGN KEY (rejected_by) REFERENCES dbo.users(id),
      CONSTRAINT CK_cpc_packing_batch_status
        CHECK (status IN ('PACKING', 'MENUNGGU_APPROVAL', 'DISETUJUI', 'DITOLAK'))
    );
  END;

  IF OBJECT_ID(N'dbo.cpc_packing_cassettes', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.cpc_packing_cassettes (
      id BIGINT IDENTITY(1,1) NOT NULL,
      batch_id BIGINT NOT NULL,
      work_order_point_id BIGINT NOT NULL,
      cassette_no SMALLINT NOT NULL,
      cassette_serial VARCHAR(100) NULL,
      denomination_value DECIMAL(19,2) NOT NULL,
      sheets_count INT NOT NULL
        CONSTRAINT DF_cpc_packing_cassette_sheets DEFAULT (2000),
      seal_no VARCHAR(100) NULL,
      packed_by INT NULL,
      packed_at DATETIME2(0) NULL,
      sealed_by INT NULL,
      sealed_at DATETIME2(0) NULL,
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_cpc_packing_cassette_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_cpc_packing_cassette_updated_at DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_cpc_packing_cassettes PRIMARY KEY CLUSTERED (id),
      CONSTRAINT FK_cpc_packing_cassette_batch
        FOREIGN KEY (batch_id) REFERENCES dbo.cpc_packing_batches(id)
        ON DELETE CASCADE,
      CONSTRAINT FK_cpc_packing_cassette_point
        FOREIGN KEY (work_order_point_id) REFERENCES dbo.replenish_work_order_points(id),
      CONSTRAINT FK_cpc_packing_cassette_packed_by
        FOREIGN KEY (packed_by) REFERENCES dbo.users(id),
      CONSTRAINT FK_cpc_packing_cassette_sealed_by
        FOREIGN KEY (sealed_by) REFERENCES dbo.users(id),
      CONSTRAINT UX_cpc_packing_cassette_slot
        UNIQUE (batch_id, work_order_point_id, cassette_no),
      CONSTRAINT CK_cpc_packing_cassette_no
        CHECK (cassette_no BETWEEN 1 AND 20),
      CONSTRAINT CK_cpc_packing_cassette_sheets
        CHECK (sheets_count = 2000),
      CONSTRAINT CK_cpc_packing_cassette_denom
        CHECK (denomination_value > 0)
    );
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.cpc_packing_cassettes')
      AND name = N'UX_cpc_packing_cassettes_seal_no'
  )
    CREATE UNIQUE INDEX UX_cpc_packing_cassettes_seal_no
      ON dbo.cpc_packing_cassettes(seal_no)
      WHERE seal_no IS NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.cpc_packing_cassettes')
      AND name = N'UX_cpc_packing_cassettes_serial_per_batch'
  )
    CREATE UNIQUE INDEX UX_cpc_packing_cassettes_serial_per_batch
      ON dbo.cpc_packing_cassettes(batch_id, cassette_serial)
      WHERE cassette_serial IS NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.cpc_packing_cassettes')
      AND name = N'IX_cpc_packing_cassettes_point'
  )
    CREATE INDEX IX_cpc_packing_cassettes_point
      ON dbo.cpc_packing_cassettes(work_order_point_id, batch_id)
      INCLUDE (cassette_no, cassette_serial, seal_no, denomination_value, sheets_count, packed_at, sealed_at);

  COMMIT TRANSACTION;

  SELECT 'Migration 039 packing kaset, scan segel, approval CPC, dan blotter berhasil dijalankan.' AS message;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
