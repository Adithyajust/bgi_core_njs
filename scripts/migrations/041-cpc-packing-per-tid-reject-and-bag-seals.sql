SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.cpc_packing_batches', N'U') IS NULL
    THROW 54101, 'Tabel dbo.cpc_packing_batches belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.replenish_work_order_points', N'U') IS NULL
    THROW 54102, 'Tabel dbo.replenish_work_order_points belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.users', N'U') IS NULL
    THROW 54103, 'Tabel dbo.users belum tersedia.', 1;

  /*
    Extension packing CPC per TID.
    Kaset uang existing tetap disimpan pada dbo.cpc_packing_cassettes agar
    constraint denomination > 0 dan 2.000 lembar tidak berubah.

    Satu row pada tabel ini merepresentasikan perlengkapan tambahan untuk satu
    work_order_point/TID:
      - 1 kaset reject, nilai dan lembar selalu 0
      - 1 segel bag berangkat
      - 1 segel bag kembali
  */
  IF OBJECT_ID(N'dbo.cpc_packing_tid_assets', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.cpc_packing_tid_assets (
      id BIGINT IDENTITY(1,1) NOT NULL,
      batch_id BIGINT NOT NULL,
      work_order_point_id BIGINT NOT NULL,
      reject_cassette_serial VARCHAR(100) NULL,
      reject_denomination_value DECIMAL(19,2) NOT NULL
        CONSTRAINT DF_cpc_packing_tid_reject_denom DEFAULT (0),
      reject_sheets_count INT NOT NULL
        CONSTRAINT DF_cpc_packing_tid_reject_sheets DEFAULT (0),
      departure_bag_seal_no VARCHAR(100) NULL,
      return_bag_seal_no VARCHAR(100) NULL,
      prepared_by INT NULL,
      prepared_at DATETIME2(0) NULL,
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_cpc_packing_tid_assets_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_cpc_packing_tid_assets_updated_at DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_cpc_packing_tid_assets PRIMARY KEY CLUSTERED (id),
      CONSTRAINT FK_cpc_packing_tid_assets_batch
        FOREIGN KEY (batch_id) REFERENCES dbo.cpc_packing_batches(id)
        ON DELETE CASCADE,
      CONSTRAINT FK_cpc_packing_tid_assets_point
        FOREIGN KEY (work_order_point_id) REFERENCES dbo.replenish_work_order_points(id),
      CONSTRAINT FK_cpc_packing_tid_assets_prepared_by
        FOREIGN KEY (prepared_by) REFERENCES dbo.users(id),
      CONSTRAINT UX_cpc_packing_tid_assets_slot
        UNIQUE (batch_id, work_order_point_id),
      CONSTRAINT CK_cpc_packing_tid_assets_reject_denom
        CHECK (reject_denomination_value = 0),
      CONSTRAINT CK_cpc_packing_tid_assets_reject_sheets
        CHECK (reject_sheets_count = 0),
      CONSTRAINT CK_cpc_packing_tid_assets_bag_seal_pair
        CHECK (
          departure_bag_seal_no IS NULL
          OR return_bag_seal_no IS NULL
          OR departure_bag_seal_no <> return_bag_seal_no
        )
    );
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.cpc_packing_tid_assets')
      AND name = N'UX_cpc_packing_tid_assets_reject_serial_per_batch'
  )
    CREATE UNIQUE INDEX UX_cpc_packing_tid_assets_reject_serial_per_batch
      ON dbo.cpc_packing_tid_assets(batch_id, reject_cassette_serial)
      WHERE reject_cassette_serial IS NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.cpc_packing_tid_assets')
      AND name = N'UX_cpc_packing_tid_assets_departure_bag_seal'
  )
    CREATE UNIQUE INDEX UX_cpc_packing_tid_assets_departure_bag_seal
      ON dbo.cpc_packing_tid_assets(departure_bag_seal_no)
      WHERE departure_bag_seal_no IS NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.cpc_packing_tid_assets')
      AND name = N'UX_cpc_packing_tid_assets_return_bag_seal'
  )
    CREATE UNIQUE INDEX UX_cpc_packing_tid_assets_return_bag_seal
      ON dbo.cpc_packing_tid_assets(return_bag_seal_no)
      WHERE return_bag_seal_no IS NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.cpc_packing_tid_assets')
      AND name = N'IX_cpc_packing_tid_assets_point'
  )
    CREATE INDEX IX_cpc_packing_tid_assets_point
      ON dbo.cpc_packing_tid_assets(work_order_point_id, batch_id)
      INCLUDE (
        reject_cassette_serial,
        departure_bag_seal_no,
        return_bag_seal_no,
        prepared_by,
        prepared_at
      );

  COMMIT TRANSACTION;

  SELECT 'Migration 041 packing CPC per TID, kaset reject Rp0, dan segel bag berhasil dijalankan.' AS message;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
