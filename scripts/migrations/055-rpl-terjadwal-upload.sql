SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.rpl_upload_batches', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.rpl_upload_batches (
      id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      period CHAR(7) NOT NULL,
      reporting_unit NVARCHAR(150) NOT NULL,
      file_name NVARCHAR(255) NOT NULL,
      file_hash CHAR(64) NOT NULL,
      period_label NVARCHAR(250) NULL,
      summary_json NVARCHAR(MAX) NOT NULL,
      warnings_json NVARCHAR(MAX) NOT NULL,
      uploaded_by INT NOT NULL REFERENCES dbo.users(id),
      uploaded_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME(),
      CONSTRAINT CK_rpl_upload_summary CHECK (ISJSON(summary_json) = 1),
      CONSTRAINT CK_rpl_upload_warnings CHECK (ISJSON(warnings_json) = 1),
      CONSTRAINT UQ_rpl_upload_file UNIQUE (period, reporting_unit, file_hash)
    );
    CREATE INDEX IX_rpl_upload_history ON dbo.rpl_upload_batches(id DESC);
  END;
  IF OBJECT_ID(N'dbo.rpl_planning_uploads', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.rpl_planning_uploads (
      id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      batch_id INT NOT NULL REFERENCES dbo.rpl_upload_batches(id),
      source_row INT NOT NULL,
      event_date DATE NOT NULL,
      tid VARCHAR(50) NOT NULL,
      location NVARCHAR(250) NOT NULL,
      machine_type VARCHAR(3) NOT NULL CHECK (machine_type IN ('ATM', 'CRM')),
      cluster NVARCHAR(100) NOT NULL,
      sheets INT NOT NULL CHECK (sheets BETWEEN 0 AND 10000000),
      forecast BIT NOT NULL,
      realized BIT NOT NULL,
      status VARCHAR(30) NOT NULL CHECK (status IN ('Sesuai','False Positive','False Negative','Tidak Ada RPL')),
      cause NVARCHAR(4000) NULL,
      obstacle NVARCHAR(4000) NULL,
      note NVARCHAR(4000) NULL,
      CONSTRAINT UQ_rpl_planning_row UNIQUE(batch_id, source_row)
    );
    CREATE INDEX IX_rpl_planning_match ON dbo.rpl_planning_uploads(batch_id, event_date, tid) INCLUDE(status);
  END;
  IF OBJECT_ID(N'dbo.rpl_dsr_uploads', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.rpl_dsr_uploads (
      id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      batch_id INT NOT NULL REFERENCES dbo.rpl_upload_batches(id),
      source_row INT NOT NULL,
      event_date DATE NOT NULL,
      tid VARCHAR(50) NOT NULL,
      location NVARCHAR(250) NOT NULL,
      machine_type VARCHAR(3) NOT NULL CHECK (machine_type IN ('ATM', 'CRM')),
      cluster NVARCHAR(100) NOT NULL,
      sheets INT NOT NULL CHECK (sheets BETWEEN 0 AND 10000000),
      forecast BIT NOT NULL,
      realized BIT NOT NULL,
      status VARCHAR(30) NOT NULL CHECK (status IN ('Sesuai','False Positive','False Negative','Tidak Ada RPL')),
      cause NVARCHAR(4000) NULL,
      obstacle NVARCHAR(4000) NULL,
      note NVARCHAR(4000) NULL,
      CONSTRAINT UQ_rpl_dsr_row UNIQUE(batch_id, source_row)
    );
    CREATE INDEX IX_rpl_dsr_match ON dbo.rpl_dsr_uploads(batch_id, event_date, tid) INCLUDE(status);
  END;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
