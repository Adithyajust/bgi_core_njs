SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.cpc_packing_batches', N'U') IS NULL
    THROW 54001, 'Tabel dbo.cpc_packing_batches belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.cpc_packing_cassettes', N'U') IS NULL
    THROW 54002, 'Tabel dbo.cpc_packing_cassettes belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.replenish_work_orders', N'U') IS NULL
    THROW 54003, 'Tabel dbo.replenish_work_orders belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.replenish_team_members', N'U') IS NULL
    THROW 54004, 'Tabel dbo.replenish_team_members belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.pegawai', N'U') IS NULL
    THROW 54005, 'Tabel dbo.pegawai belum tersedia.', 1;

  /*
    Legacy database dapat memakai BIGINT/NUMERIC untuk dbo.pegawai.id.
    custody_employee_id wajib mengikuti tipe fisik dbo.pegawai.id agar FK
    dapat dibuat tanpa mengubah master pegawai existing.
  */
  DECLARE @pegawaiIdType NVARCHAR(128);
  DECLARE @pegawaiSystemTypeId INT;
  DECLARE @pegawaiMaxLength SMALLINT;
  DECLARE @pegawaiPrecision TINYINT;
  DECLARE @pegawaiScale TINYINT;

  SELECT
    @pegawaiSystemTypeId = c.system_type_id,
    @pegawaiMaxLength = c.max_length,
    @pegawaiPrecision = c.precision,
    @pegawaiScale = c.scale,
    @pegawaiIdType = CASE TYPE_NAME(c.system_type_id)
      WHEN N'tinyint' THEN N'TINYINT'
      WHEN N'smallint' THEN N'SMALLINT'
      WHEN N'int' THEN N'INT'
      WHEN N'bigint' THEN N'BIGINT'
      WHEN N'decimal' THEN N'DECIMAL(' + CONVERT(NVARCHAR(10), c.precision) + N',' + CONVERT(NVARCHAR(10), c.scale) + N')'
      WHEN N'numeric' THEN N'NUMERIC(' + CONVERT(NVARCHAR(10), c.precision) + N',' + CONVERT(NVARCHAR(10), c.scale) + N')'
      ELSE NULL
    END
  FROM sys.columns c
  WHERE c.object_id = OBJECT_ID(N'dbo.pegawai')
    AND c.name = N'id';

  IF @pegawaiIdType IS NULL
    THROW 54006, 'Tipe dbo.pegawai.id tidak didukung untuk serah terima CPC. Gunakan tipe integer atau numeric tanpa pecahan.', 1;

  IF @pegawaiScale <> 0
    THROW 54007, 'dbo.pegawai.id harus berupa angka bulat agar dapat digunakan sebagai foreign key serah terima CPC.', 1;

  IF OBJECT_ID(N'dbo.cpc_cassette_handovers', N'U') IS NULL
  BEGIN
    /*
      Tabel dibuat tanpa custody_employee_id terlebih dahulu karena tipe kolom
      tersebut harus dibentuk secara dinamis mengikuti dbo.pegawai.id.
    */
    CREATE TABLE dbo.cpc_cassette_handovers (
      id BIGINT IDENTITY(1,1) NOT NULL,
      work_order_id BIGINT NOT NULL,
      packing_batch_id BIGINT NOT NULL,
      status VARCHAR(20) NOT NULL
        CONSTRAINT DF_cpc_cassette_handover_status DEFAULT ('VERIFIKASI'),
      handover_notes NVARCHAR(1000) NULL,
      created_by INT NOT NULL,
      completed_by INT NULL,
      completed_at DATETIME2(0) NULL,
      recipient_nip_snapshot VARCHAR(50) NULL,
      recipient_name_snapshot NVARCHAR(200) NULL,
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_cpc_cassette_handover_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_cpc_cassette_handover_updated_at DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_cpc_cassette_handovers PRIMARY KEY CLUSTERED (id),
      CONSTRAINT UX_cpc_cassette_handovers_work_order UNIQUE (work_order_id),
      CONSTRAINT UX_cpc_cassette_handovers_packing_batch UNIQUE (packing_batch_id),
      CONSTRAINT FK_cpc_cassette_handover_work_order
        FOREIGN KEY (work_order_id) REFERENCES dbo.replenish_work_orders(id)
        ON DELETE CASCADE,
      CONSTRAINT FK_cpc_cassette_handover_packing_batch
        FOREIGN KEY (packing_batch_id) REFERENCES dbo.cpc_packing_batches(id),
      CONSTRAINT FK_cpc_cassette_handover_created_by
        FOREIGN KEY (created_by) REFERENCES dbo.users(id),
      CONSTRAINT FK_cpc_cassette_handover_completed_by
        FOREIGN KEY (completed_by) REFERENCES dbo.users(id),
      CONSTRAINT CK_cpc_cassette_handover_status
        CHECK (status IN ('VERIFIKASI', 'SELESAI'))
    );

    DECLARE @addCustodyColumnSql NVARCHAR(MAX) =
      N'ALTER TABLE dbo.cpc_cassette_handovers ADD custody_employee_id '
      + @pegawaiIdType + N' NOT NULL;';
    EXEC sys.sp_executesql @addCustodyColumnSql;
  END;
  ELSE
  BEGIN
    IF COL_LENGTH(N'dbo.cpc_cassette_handovers', N'custody_employee_id') IS NULL
    BEGIN
      IF EXISTS (SELECT 1 FROM dbo.cpc_cassette_handovers)
        THROW 54008, 'Kolom custody_employee_id tidak tersedia pada tabel serah terima yang sudah berisi data.', 1;

      DECLARE @addExistingCustodyColumnSql NVARCHAR(MAX) =
        N'ALTER TABLE dbo.cpc_cassette_handovers ADD custody_employee_id '
        + @pegawaiIdType + N' NOT NULL;';
      EXEC sys.sp_executesql @addExistingCustodyColumnSql;
    END;

    DECLARE @custodySystemTypeId INT;
    DECLARE @custodyMaxLength SMALLINT;
    DECLARE @custodyPrecision TINYINT;
    DECLARE @custodyScale TINYINT;

    SELECT
      @custodySystemTypeId = c.system_type_id,
      @custodyMaxLength = c.max_length,
      @custodyPrecision = c.precision,
      @custodyScale = c.scale
    FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.cpc_cassette_handovers')
      AND c.name = N'custody_employee_id';

    IF @custodySystemTypeId <> @pegawaiSystemTypeId
      OR @custodyMaxLength <> @pegawaiMaxLength
      OR @custodyPrecision <> @pegawaiPrecision
      OR @custodyScale <> @pegawaiScale
    BEGIN
      IF EXISTS (
        SELECT 1 FROM sys.foreign_keys
        WHERE parent_object_id = OBJECT_ID(N'dbo.cpc_cassette_handovers')
          AND name = N'FK_cpc_cassette_handover_custody'
      )
        ALTER TABLE dbo.cpc_cassette_handovers
          DROP CONSTRAINT FK_cpc_cassette_handover_custody;

      IF EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.cpc_cassette_handovers')
          AND name = N'IX_cpc_cassette_handovers_status'
      )
        DROP INDEX IX_cpc_cassette_handovers_status
          ON dbo.cpc_cassette_handovers;

      DECLARE @alterCustodyColumnSql NVARCHAR(MAX) =
        N'ALTER TABLE dbo.cpc_cassette_handovers ALTER COLUMN custody_employee_id '
        + @pegawaiIdType + N' NOT NULL;';
      EXEC sys.sp_executesql @alterCustodyColumnSql;
    END;
  END;

  IF EXISTS (
    SELECT 1
    FROM dbo.cpc_cassette_handovers handover
    LEFT JOIN dbo.pegawai custody ON custody.id = handover.custody_employee_id
    WHERE custody.id IS NULL
  )
    THROW 54009, 'Terdapat custody_employee_id pada serah terima CPC yang tidak memiliki pasangan pada dbo.pegawai.', 1;

  IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID(N'dbo.cpc_cassette_handovers')
      AND name = N'FK_cpc_cassette_handover_custody'
  )
    ALTER TABLE dbo.cpc_cassette_handovers WITH CHECK
      ADD CONSTRAINT FK_cpc_cassette_handover_custody
      FOREIGN KEY (custody_employee_id) REFERENCES dbo.pegawai(id);

  IF OBJECT_ID(N'dbo.cpc_cassette_handover_items', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.cpc_cassette_handover_items (
      id BIGINT IDENTITY(1,1) NOT NULL,
      handover_id BIGINT NOT NULL,
      packing_cassette_id BIGINT NOT NULL,
      expected_seal_no VARCHAR(100) NOT NULL,
      scanned_seal_no VARCHAR(100) NULL,
      verified_by INT NULL,
      verified_at DATETIME2(0) NULL,
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_cpc_cassette_handover_item_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_cpc_cassette_handover_item_updated_at DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_cpc_cassette_handover_items PRIMARY KEY CLUSTERED (id),
      CONSTRAINT FK_cpc_cassette_handover_item_handover
        FOREIGN KEY (handover_id) REFERENCES dbo.cpc_cassette_handovers(id)
        ON DELETE CASCADE,
      CONSTRAINT FK_cpc_cassette_handover_item_packing
        FOREIGN KEY (packing_cassette_id) REFERENCES dbo.cpc_packing_cassettes(id),
      CONSTRAINT FK_cpc_cassette_handover_item_verified_by
        FOREIGN KEY (verified_by) REFERENCES dbo.users(id),
      CONSTRAINT UX_cpc_cassette_handover_item_slot
        UNIQUE (handover_id, packing_cassette_id)
    );
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.cpc_cassette_handover_items')
      AND name = N'UX_cpc_cassette_handover_scanned_seal'
  )
    CREATE UNIQUE INDEX UX_cpc_cassette_handover_scanned_seal
      ON dbo.cpc_cassette_handover_items(handover_id, scanned_seal_no)
      WHERE scanned_seal_no IS NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.cpc_cassette_handovers')
      AND name = N'IX_cpc_cassette_handovers_status'
  )
    CREATE INDEX IX_cpc_cassette_handovers_status
      ON dbo.cpc_cassette_handovers(status, work_order_id)
      INCLUDE (custody_employee_id, completed_at, completed_by);

  COMMIT TRANSACTION;

  SELECT 'Migration 040 serah terima kaset CPC ke Custody berhasil dijalankan.' AS message;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
