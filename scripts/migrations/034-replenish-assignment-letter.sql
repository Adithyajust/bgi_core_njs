SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.replenish_work_orders', N'U') IS NULL
    THROW 53401, 'Tabel dbo.replenish_work_orders belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.users', N'U') IS NULL
    THROW 53402, 'Tabel dbo.users belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.replenish_assignment_letters', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.replenish_assignment_letters (
      id BIGINT IDENTITY(1,1) NOT NULL,
      work_order_id BIGINT NOT NULL,
      letter_no VARCHAR(50) NOT NULL,
      status VARCHAR(30) NOT NULL
        CONSTRAINT DF_replenish_assignment_letter_status
        DEFAULT ('MENUNGGU_PERSETUJUAN'),
      payload_json NVARCHAR(MAX) NOT NULL,
      document_hash CHAR(64) NOT NULL,
      verification_token UNIQUEIDENTIFIER NOT NULL
        CONSTRAINT DF_replenish_assignment_letter_token DEFAULT (NEWID()),
      created_by INT NOT NULL,
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_replenish_assignment_letter_created_at DEFAULT (SYSDATETIME()),
      approved_by INT NULL,
      approved_at DATETIME2(0) NULL,
      approval_hash CHAR(64) NULL,
      rejected_by INT NULL,
      rejected_at DATETIME2(0) NULL,
      rejection_reason NVARCHAR(1000) NULL,
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_replenish_assignment_letter_updated_at DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_replenish_assignment_letters PRIMARY KEY CLUSTERED (id),
      CONSTRAINT UX_replenish_assignment_letters_work_order UNIQUE (work_order_id),
      CONSTRAINT UX_replenish_assignment_letters_number UNIQUE (letter_no),
      CONSTRAINT UX_replenish_assignment_letters_token UNIQUE (verification_token),
      CONSTRAINT FK_replenish_assignment_letters_work_order
        FOREIGN KEY (work_order_id) REFERENCES dbo.replenish_work_orders(id),
      CONSTRAINT FK_replenish_assignment_letters_created_by
        FOREIGN KEY (created_by) REFERENCES dbo.users(id),
      CONSTRAINT FK_replenish_assignment_letters_approved_by
        FOREIGN KEY (approved_by) REFERENCES dbo.users(id),
      CONSTRAINT FK_replenish_assignment_letters_rejected_by
        FOREIGN KEY (rejected_by) REFERENCES dbo.users(id),
      CONSTRAINT CK_replenish_assignment_letters_status
        CHECK (status IN ('MENUNGGU_PERSETUJUAN', 'DISETUJUI', 'DITOLAK')),
      CONSTRAINT CK_replenish_assignment_letters_document_hash
        CHECK (document_hash NOT LIKE '%[^0-9a-f]%' AND LEN(document_hash) = 64),
      CONSTRAINT CK_replenish_assignment_letters_approval_hash
        CHECK (
          approval_hash IS NULL OR
          (approval_hash NOT LIKE '%[^0-9a-f]%' AND LEN(approval_hash) = 64)
        ),
      CONSTRAINT CK_replenish_assignment_letters_approval_state
        CHECK (
          (status = 'DISETUJUI' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND approval_hash IS NOT NULL)
          OR
          (status <> 'DISETUJUI' AND approved_by IS NULL AND approved_at IS NULL AND approval_hash IS NULL)
        ),
      CONSTRAINT CK_replenish_assignment_letters_rejection_state
        CHECK (
          (status = 'DITOLAK' AND rejected_by IS NOT NULL AND rejected_at IS NOT NULL AND rejection_reason IS NOT NULL)
          OR
          (status <> 'DITOLAK' AND rejected_by IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL)
        )
    );
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.replenish_assignment_letters')
      AND name = N'IX_replenish_assignment_letters_status'
  )
    CREATE INDEX IX_replenish_assignment_letters_status
      ON dbo.replenish_assignment_letters(status, updated_at DESC, id DESC)
      INCLUDE (work_order_id, letter_no, document_hash, created_by, approved_by, approved_at);

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
