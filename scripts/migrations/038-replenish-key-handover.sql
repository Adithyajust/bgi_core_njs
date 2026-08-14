SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.replenish_work_orders', N'U') IS NULL
    THROW 53801, 'Tabel dbo.replenish_work_orders belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.replenish_work_order_points', N'U') IS NULL
    THROW 53802, 'Tabel dbo.replenish_work_order_points belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.machine_key_mappings', N'U') IS NULL
    THROW 53803, 'Tabel dbo.machine_key_mappings belum tersedia. Jalankan migration 036 dan 037 terlebih dahulu.', 1;

  IF OBJECT_ID(N'dbo.users', N'U') IS NULL
    THROW 53804, 'Tabel dbo.users belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.replenish_key_handovers', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.replenish_key_handovers (
      id BIGINT IDENTITY(1,1) NOT NULL,
      work_order_id BIGINT NOT NULL,
      receipt_no VARCHAR(50) NULL,
      verified_at DATETIME2(0) NULL,
      verified_by INT NULL,
      printed_at DATETIME2(0) NULL,
      printed_by INT NULL,
      created_by INT NOT NULL,
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_replenish_key_handover_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_replenish_key_handover_updated_at DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_replenish_key_handovers PRIMARY KEY CLUSTERED (id),
      CONSTRAINT UX_replenish_key_handover_work_order UNIQUE (work_order_id),
      CONSTRAINT UX_replenish_key_handover_receipt UNIQUE (receipt_no),
      CONSTRAINT FK_replenish_key_handover_work_order
        FOREIGN KEY (work_order_id) REFERENCES dbo.replenish_work_orders(id)
        ON DELETE CASCADE,
      CONSTRAINT FK_replenish_key_handover_verified_by
        FOREIGN KEY (verified_by) REFERENCES dbo.users(id),
      CONSTRAINT FK_replenish_key_handover_printed_by
        FOREIGN KEY (printed_by) REFERENCES dbo.users(id),
      CONSTRAINT FK_replenish_key_handover_created_by
        FOREIGN KEY (created_by) REFERENCES dbo.users(id),
      CONSTRAINT CK_replenish_key_handover_print_requires_verify
        CHECK (printed_at IS NULL OR verified_at IS NOT NULL)
    );
  END;

  IF OBJECT_ID(N'dbo.replenish_key_handover_items', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.replenish_key_handover_items (
      id BIGINT IDENTITY(1,1) NOT NULL,
      handover_id BIGINT NOT NULL,
      work_order_point_id BIGINT NOT NULL,
      machine_id BIGINT NOT NULL,
      machine_key_mapping_id BIGINT NOT NULL,
      barcode_snapshot VARCHAR(64) NOT NULL,
      scanned_by INT NOT NULL,
      scanned_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_replenish_key_handover_item_scanned_at DEFAULT (SYSDATETIME()),
      CONSTRAINT PK_replenish_key_handover_items PRIMARY KEY CLUSTERED (id),
      CONSTRAINT FK_replenish_key_handover_item_handover
        FOREIGN KEY (handover_id) REFERENCES dbo.replenish_key_handovers(id)
        ON DELETE CASCADE,
      CONSTRAINT FK_replenish_key_handover_item_point
        FOREIGN KEY (work_order_point_id) REFERENCES dbo.replenish_work_order_points(id),
      CONSTRAINT FK_replenish_key_handover_item_machine
        FOREIGN KEY (machine_id) REFERENCES dbo.master_mesin(id),
      CONSTRAINT FK_replenish_key_handover_item_mapping
        FOREIGN KEY (machine_key_mapping_id) REFERENCES dbo.machine_key_mappings(id),
      CONSTRAINT FK_replenish_key_handover_item_scanned_by
        FOREIGN KEY (scanned_by) REFERENCES dbo.users(id),
      CONSTRAINT UX_replenish_key_handover_item_point UNIQUE (handover_id, work_order_point_id),
      CONSTRAINT UX_replenish_key_handover_item_mapping UNIQUE (handover_id, machine_key_mapping_id)
    );
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.replenish_key_handover_items')
      AND name = N'IX_replenish_key_handover_items_machine'
  )
    CREATE INDEX IX_replenish_key_handover_items_machine
      ON dbo.replenish_key_handover_items(machine_id, handover_id)
      INCLUDE (work_order_point_id, machine_key_mapping_id, scanned_at);

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.replenish_key_handovers')
      AND name = N'IX_replenish_key_handovers_printed'
  )
    CREATE INDEX IX_replenish_key_handovers_printed
      ON dbo.replenish_key_handovers(work_order_id, printed_at)
      INCLUDE (verified_at, receipt_no, printed_by, updated_at);

  COMMIT TRANSACTION;

  SELECT 'Migration 038 serah terima dan verifikasi kunci Replenish berhasil dijalankan.' AS message;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
