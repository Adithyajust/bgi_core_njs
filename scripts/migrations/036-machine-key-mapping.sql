SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.master_mesin', N'U') IS NULL
    THROW 53601, 'Tabel dbo.master_mesin belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.users', N'U') IS NULL
    THROW 53602, 'Tabel dbo.users belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.master_uker', N'U') IS NULL
    THROW 53603, 'Tabel dbo.master_uker belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.machine_key_mappings', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.machine_key_mappings (
      id BIGINT IDENTITY(1,1) NOT NULL,
      machine_id BIGINT NOT NULL,
      uker_id BIGINT NOT NULL,
      key_type VARCHAR(20) NOT NULL,
      function_code CHAR(1) NOT NULL,
      matrix_wall VARCHAR(2) NOT NULL,
      matrix_column CHAR(1) NOT NULL,
      matrix_row CHAR(2) NOT NULL,
      random_segment VARCHAR(4) NOT NULL,
      barcode AS (
        matrix_wall + matrix_column + random_segment + function_code + matrix_row
      ) PERSISTED,
      has_tombak BIT NOT NULL
        CONSTRAINT DF_machine_key_has_tombak DEFAULT (1),
      has_fascia BIT NOT NULL
        CONSTRAINT DF_machine_key_has_fascia DEFAULT (1),
      status VARCHAR(10) NOT NULL
        CONSTRAINT DF_machine_key_status DEFAULT ('IN'),
      current_work_order_id BIGINT NULL,
      checked_out_at DATETIME2(0) NULL,
      checked_in_at DATETIME2(0) NULL,
      notes NVARCHAR(500) NULL,
      created_by INT NOT NULL,
      updated_by INT NOT NULL,
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_machine_key_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_machine_key_updated_at DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,

      CONSTRAINT PK_machine_key_mappings PRIMARY KEY CLUSTERED (id),
      CONSTRAINT FK_machine_key_machine
        FOREIGN KEY (machine_id) REFERENCES dbo.master_mesin(id),
      CONSTRAINT FK_machine_key_uker
        FOREIGN KEY (uker_id) REFERENCES dbo.master_uker(id),
      CONSTRAINT FK_machine_key_created_by
        FOREIGN KEY (created_by) REFERENCES dbo.users(id),
      CONSTRAINT FK_machine_key_updated_by
        FOREIGN KEY (updated_by) REFERENCES dbo.users(id),
      CONSTRAINT CK_machine_key_type
        CHECK (key_type IN ('REPLENISH', 'FLM', 'BACKUP')),
      CONSTRAINT CK_machine_key_function_code
        CHECK (
          function_code NOT LIKE '%[^A-Z0-9]%'
          AND (
            (key_type = 'REPLENISH' AND function_code = 'R')
            OR (key_type = 'FLM' AND function_code = 'F')
            OR key_type = 'BACKUP'
          )
        ),
      CONSTRAINT CK_machine_key_wall
        CHECK (matrix_wall IN ('A1', 'A2', 'A3')),
      CONSTRAINT CK_machine_key_column
        CHECK (matrix_column IN ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H')),
      CONSTRAINT CK_machine_key_row
        CHECK (matrix_row IN ('01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11')),
      CONSTRAINT CK_machine_key_random_segment
        CHECK (
          LEN(random_segment) = 4
          AND random_segment NOT LIKE '%[^A-Za-z0-9]%'
        ),
      CONSTRAINT CK_machine_key_composition
        CHECK (has_tombak = 1 AND has_fascia = 1),
      CONSTRAINT CK_machine_key_status
        CHECK (status IN ('IN', 'OUT')),
      CONSTRAINT CK_machine_key_work_order_status
        CHECK (
          (status = 'IN' AND current_work_order_id IS NULL)
          OR (status = 'OUT' AND current_work_order_id IS NOT NULL)
        )
    );
  END;

  IF OBJECT_ID(N'dbo.replenish_work_orders', N'U') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM sys.foreign_keys
       WHERE parent_object_id = OBJECT_ID(N'dbo.machine_key_mappings')
         AND name = N'FK_machine_key_current_work_order'
     )
  BEGIN
    ALTER TABLE dbo.machine_key_mappings WITH CHECK
      ADD CONSTRAINT FK_machine_key_current_work_order
      FOREIGN KEY (current_work_order_id)
      REFERENCES dbo.replenish_work_orders(id);
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.machine_key_mappings')
      AND name = N'UX_machine_key_machine_type'
  )
    CREATE UNIQUE INDEX UX_machine_key_machine_type
      ON dbo.machine_key_mappings(machine_id, key_type);

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.machine_key_mappings')
      AND name = N'UX_machine_key_matrix_slot'
  )
    CREATE UNIQUE INDEX UX_machine_key_matrix_slot
      ON dbo.machine_key_mappings(uker_id, matrix_wall, matrix_column, matrix_row);

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.machine_key_mappings')
      AND name = N'UX_machine_key_barcode'
  )
    CREATE UNIQUE INDEX UX_machine_key_barcode
      ON dbo.machine_key_mappings(barcode);

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.machine_key_mappings')
      AND name = N'IX_machine_key_status_wall'
  )
    CREATE INDEX IX_machine_key_status_wall
      ON dbo.machine_key_mappings(uker_id, status, matrix_wall, matrix_column, matrix_row)
      INCLUDE (machine_id, key_type, function_code, barcode, updated_at);

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.machine_key_mappings')
      AND name = N'IX_machine_key_work_order'
  )
    CREATE INDEX IX_machine_key_work_order
      ON dbo.machine_key_mappings(current_work_order_id)
      WHERE current_work_order_id IS NOT NULL;

  COMMIT TRANSACTION;

  SELECT 'Migration 036 machine key mapping berhasil dijalankan.' AS message;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
