SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.users', N'U') IS NULL
    THROW 54901, 'Tabel dbo.users belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.cpc_packing_cassettes', N'U') IS NULL
    THROW 54902, 'Tabel dbo.cpc_packing_cassettes belum tersedia. Jalankan migration 039 terlebih dahulu.', 1;

  IF OBJECT_ID(N'dbo.cpc_spare_cassettes', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.cpc_spare_cassettes (
      id BIGINT IDENTITY(1,1) NOT NULL,
      cassette_serial VARCHAR(20) NOT NULL,
      denomination_value DECIMAL(19,2) NOT NULL,
      sheets_count INT NOT NULL
        CONSTRAINT DF_cpc_spare_cassette_sheets DEFAULT (2000),
      rubber_seal_no VARCHAR(100) NULL,
      status VARCHAR(20) NOT NULL
        CONSTRAINT DF_cpc_spare_cassette_status DEFAULT ('KOSONG'),
      prepared_by INT NULL,
      prepared_at DATETIME2(0) NULL,
      allocated_packing_cassette_id BIGINT NULL,
      allocated_by INT NULL,
      allocated_at DATETIME2(0) NULL,
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_cpc_spare_cassette_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_cpc_spare_cassette_updated_at DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_cpc_spare_cassettes PRIMARY KEY CLUSTERED (id),
      CONSTRAINT UX_cpc_spare_cassettes_serial UNIQUE (cassette_serial),
      CONSTRAINT FK_cpc_spare_cassettes_prepared_by
        FOREIGN KEY (prepared_by) REFERENCES dbo.users(id),
      CONSTRAINT FK_cpc_spare_cassettes_allocated_by
        FOREIGN KEY (allocated_by) REFERENCES dbo.users(id),
      CONSTRAINT CK_cpc_spare_cassettes_sheets CHECK (sheets_count = 2000),
      CONSTRAINT CK_cpc_spare_cassettes_status CHECK (status IN ('KOSONG', 'READY', 'ALLOCATED')),
      CONSTRAINT CK_cpc_spare_cassettes_serial_denom CHECK (
        (cassette_serial IN ('CST0000011', 'CST0000012', 'CST0000013', 'CST0000014') AND denomination_value = 50000)
        OR
        (cassette_serial IN ('CST0000015', 'CST0000016', 'CST0000017', 'CST0000018') AND denomination_value = 100000)
      ),
      CONSTRAINT CK_cpc_spare_cassettes_state CHECK (
        (
          status = 'KOSONG'
          AND rubber_seal_no IS NULL
          AND prepared_by IS NULL
          AND prepared_at IS NULL
          AND allocated_packing_cassette_id IS NULL
          AND allocated_by IS NULL
          AND allocated_at IS NULL
        )
        OR
        (
          status = 'READY'
          AND rubber_seal_no IS NOT NULL
          AND prepared_by IS NOT NULL
          AND prepared_at IS NOT NULL
          AND allocated_packing_cassette_id IS NULL
          AND allocated_by IS NULL
          AND allocated_at IS NULL
        )
        OR
        (
          status = 'ALLOCATED'
          AND rubber_seal_no IS NOT NULL
          AND prepared_by IS NOT NULL
          AND prepared_at IS NOT NULL
          AND allocated_packing_cassette_id IS NOT NULL
          AND allocated_by IS NOT NULL
          AND allocated_at IS NOT NULL
        )
      )
    );
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.cpc_spare_cassettes')
      AND name = N'UX_cpc_spare_cassettes_rubber_seal'
  )
    CREATE UNIQUE INDEX UX_cpc_spare_cassettes_rubber_seal
      ON dbo.cpc_spare_cassettes(rubber_seal_no)
      WHERE rubber_seal_no IS NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.cpc_spare_cassettes')
      AND name = N'UX_cpc_spare_cassettes_allocation'
  )
    CREATE UNIQUE INDEX UX_cpc_spare_cassettes_allocation
      ON dbo.cpc_spare_cassettes(allocated_packing_cassette_id)
      WHERE allocated_packing_cassette_id IS NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.cpc_spare_cassettes')
      AND name = N'IX_cpc_spare_cassettes_ready_denom'
  )
    CREATE INDEX IX_cpc_spare_cassettes_ready_denom
      ON dbo.cpc_spare_cassettes(status, denomination_value, cassette_serial)
      INCLUDE (rubber_seal_no, sheets_count, prepared_by, prepared_at, allocated_packing_cassette_id);

  /*
    SQL Server mengompilasi satu file migration sebagai satu batch. Kolom baru
    pada cpc_packing_cassettes wajib ditambah dan direferensikan melalui
    sys.sp_executesql agar name resolution dilakukan setelah ALTER TABLE selesai.
  */
  IF COL_LENGTH(N'dbo.cpc_packing_cassettes', N'spare_cassette_id') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_cassettes ADD spare_cassette_id BIGINT NULL;
    ';
  END;

  IF COL_LENGTH(N'dbo.cpc_packing_cassettes', N'spare_assigned_by') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_cassettes ADD spare_assigned_by INT NULL;
    ';
  END;

  IF COL_LENGTH(N'dbo.cpc_packing_cassettes', N'spare_assigned_at') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_cassettes ADD spare_assigned_at DATETIME2(0) NULL;
    ';
  END;

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_cpc_packing_cassettes_spare')
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_cassettes WITH CHECK
        ADD CONSTRAINT FK_cpc_packing_cassettes_spare
        FOREIGN KEY (spare_cassette_id) REFERENCES dbo.cpc_spare_cassettes(id);
    ';
  END;

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_cpc_packing_cassettes_spare_assigned_by')
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.cpc_packing_cassettes WITH CHECK
        ADD CONSTRAINT FK_cpc_packing_cassettes_spare_assigned_by
        FOREIGN KEY (spare_assigned_by) REFERENCES dbo.users(id);
    ';
  END;

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_cpc_spare_cassettes_allocation')
    ALTER TABLE dbo.cpc_spare_cassettes WITH CHECK
      ADD CONSTRAINT FK_cpc_spare_cassettes_allocation
      FOREIGN KEY (allocated_packing_cassette_id) REFERENCES dbo.cpc_packing_cassettes(id);

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.cpc_packing_cassettes')
      AND name = N'UX_cpc_packing_cassettes_spare'
  )
  BEGIN
    EXEC sys.sp_executesql N'
      CREATE UNIQUE INDEX UX_cpc_packing_cassettes_spare
        ON dbo.cpc_packing_cassettes(spare_cassette_id)
        WHERE spare_cassette_id IS NOT NULL;
    ';
  END;

  IF OBJECT_ID(N'dbo.cpc_spare_cassette_history', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.cpc_spare_cassette_history (
      id BIGINT IDENTITY(1,1) NOT NULL,
      spare_cassette_id BIGINT NOT NULL,
      action VARCHAR(30) NOT NULL,
      denomination_value DECIMAL(19,2) NOT NULL,
      sheets_count INT NOT NULL,
      rubber_seal_no VARCHAR(100) NULL,
      packing_cassette_id BIGINT NULL,
      actor_user_id INT NOT NULL,
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_cpc_spare_history_created_at DEFAULT (SYSDATETIME()),
      CONSTRAINT PK_cpc_spare_cassette_history PRIMARY KEY CLUSTERED (id),
      CONSTRAINT FK_cpc_spare_history_spare
        FOREIGN KEY (spare_cassette_id) REFERENCES dbo.cpc_spare_cassettes(id),
      CONSTRAINT FK_cpc_spare_history_actor
        FOREIGN KEY (actor_user_id) REFERENCES dbo.users(id),
      CONSTRAINT CK_cpc_spare_history_action CHECK (action IN ('PREPARED', 'REPREPARED', 'ALLOCATED', 'RELEASED')),
      CONSTRAINT CK_cpc_spare_history_sheets CHECK (sheets_count = 2000)
    );
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.cpc_spare_cassette_history')
      AND name = N'IX_cpc_spare_history_cassette'
  )
    CREATE INDEX IX_cpc_spare_history_cassette
      ON dbo.cpc_spare_cassette_history(spare_cassette_id, id DESC)
      INCLUDE (action, rubber_seal_no, packing_cassette_id, actor_user_id, created_at);

  INSERT INTO dbo.cpc_spare_cassettes (cassette_serial, denomination_value, sheets_count)
  SELECT seed.cassette_serial, seed.denomination_value, 2000
  FROM (VALUES
    ('CST0000011', CONVERT(DECIMAL(19,2), 50000)),
    ('CST0000012', CONVERT(DECIMAL(19,2), 50000)),
    ('CST0000013', CONVERT(DECIMAL(19,2), 50000)),
    ('CST0000014', CONVERT(DECIMAL(19,2), 50000)),
    ('CST0000015', CONVERT(DECIMAL(19,2), 100000)),
    ('CST0000016', CONVERT(DECIMAL(19,2), 100000)),
    ('CST0000017', CONVERT(DECIMAL(19,2), 100000)),
    ('CST0000018', CONVERT(DECIMAL(19,2), 100000))
  ) seed(cassette_serial, denomination_value)
  WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.cpc_spare_cassettes existing
    WHERE existing.cassette_serial = seed.cassette_serial
  );

  COMMIT TRANSACTION;

  SELECT 'Migration 049 persediaan spare kaset CPC berhasil dijalankan.' AS message;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
