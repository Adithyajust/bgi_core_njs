SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.rpl_tid_parameter_sets', N'U') IS NULL
    CREATE TABLE dbo.rpl_tid_parameter_sets (
      uker_id BIGINT NOT NULL PRIMARY KEY,
      revision INT NOT NULL DEFAULT(0) CHECK(revision >= 0),
      updated_by INT NULL REFERENCES dbo.users(id),
      updated_at DATETIME2(0) NOT NULL DEFAULT(SYSDATETIME())
    );

  IF OBJECT_ID(N'dbo.rpl_tid_parameter_master', N'U') IS NULL
    CREATE TABLE dbo.rpl_tid_parameter_master (
      uker_id BIGINT NOT NULL REFERENCES dbo.rpl_tid_parameter_sets(uker_id),
      tid VARCHAR(50) NOT NULL,
      location NVARCHAR(250) NOT NULL,
      branch NVARCHAR(150) NOT NULL,
      machine_type VARCHAR(3) NOT NULL CHECK(machine_type IN('ATM','CRM')),
      denom VARCHAR(15) NOT NULL CHECK(denom IN('50000','100000','All Denom')),
      cluster_flm NVARCHAR(100) NOT NULL DEFAULT(''),
      cluster NVARCHAR(100) NOT NULL,
      sub_cluster_rpl NVARCHAR(100) NOT NULL DEFAULT(''),
      updated_by INT NOT NULL REFERENCES dbo.users(id),
      updated_at DATETIME2(0) NOT NULL DEFAULT(SYSDATETIME()),
      CONSTRAINT PK_rpl_tid_parameter_master PRIMARY KEY(uker_id,tid)
    );

  IF COL_LENGTH('dbo.rpl_upload_batches', 'reporting_uker_id') IS NULL
    ALTER TABLE dbo.rpl_upload_batches ADD reporting_uker_id BIGINT NULL;
  IF COL_LENGTH('dbo.rpl_upload_batches', 'parameter_revision') IS NULL
    ALTER TABLE dbo.rpl_upload_batches ADD parameter_revision INT NULL;
  IF COL_LENGTH('dbo.rpl_tid_parameters', 'location') IS NULL
    ALTER TABLE dbo.rpl_tid_parameters ADD location NVARCHAR(250) NULL;
  IF COL_LENGTH('dbo.rpl_tid_parameters', 'machine_type') IS NULL
    ALTER TABLE dbo.rpl_tid_parameters ADD machine_type VARCHAR(3) NULL CHECK(machine_type IS NULL OR machine_type IN('ATM','CRM'));
  IF COL_LENGTH('dbo.rpl_tid_parameters', 'cluster') IS NULL
    ALTER TABLE dbo.rpl_tid_parameters ADD cluster NVARCHAR(100) NULL;

  -- Preserve existing snapshots. Associate old batches only with an unambiguous unit.
  EXEC sp_executesql N'
    UPDATE b SET reporting_uker_id=u.id
    FROM dbo.rpl_upload_batches b
    JOIN (SELECT nama_uker,MIN(id) AS id FROM dbo.master_uker GROUP BY nama_uker HAVING COUNT(*)=1) u
      ON u.nama_uker=b.reporting_unit
    WHERE b.reporting_uker_id IS NULL;';

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
