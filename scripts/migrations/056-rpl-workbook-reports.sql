SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF COL_LENGTH('dbo.rpl_upload_batches', 'report_settings_json') IS NULL
    ALTER TABLE dbo.rpl_upload_batches ADD report_settings_json NVARCHAR(MAX) NULL;
  IF COL_LENGTH('dbo.rpl_upload_batches', 'reference_fc_json') IS NULL
    ALTER TABLE dbo.rpl_upload_batches ADD reference_fc_json NVARCHAR(MAX) NULL;
  IF COL_LENGTH('dbo.rpl_upload_batches', 'report_revision') IS NULL
    ALTER TABLE dbo.rpl_upload_batches ADD report_revision INT NOT NULL CONSTRAINT DF_rpl_report_revision DEFAULT(0);
  IF OBJECT_ID(N'dbo.rpl_tid_parameters', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.rpl_tid_parameters (
      batch_id INT NOT NULL REFERENCES dbo.rpl_upload_batches(id),
      tid VARCHAR(50) NOT NULL,
      denom VARCHAR(15) NULL CHECK(denom IS NULL OR denom IN('50000','100000','All Denom')),
      branch NVARCHAR(150) NOT NULL DEFAULT(''),
      cluster_flm NVARCHAR(100) NOT NULL DEFAULT(''),
      sub_cluster_rpl NVARCHAR(100) NOT NULL DEFAULT(''),
      avg_daily_transaction DECIMAL(18,2) NULL CHECK(avg_daily_transaction IS NULL OR avg_daily_transaction BETWEEN 0 AND 1000000000000),
      metadata_source NVARCHAR(50) NOT NULL DEFAULT('Input aplikasi'),
      CONSTRAINT PK_rpl_tid_parameters PRIMARY KEY(batch_id,tid)
    );
  END;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
