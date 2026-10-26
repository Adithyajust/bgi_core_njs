-- RPL Incremental DSR Sync
-- Add last_dsr_sync_date

IF NOT EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE name = N'last_dsr_sync_date'
      AND object_id = OBJECT_ID(N'dbo.rpl_upload_batches')
)
BEGIN
    ALTER TABLE dbo.rpl_upload_batches
    ADD last_dsr_sync_date DATE NULL;
END;


-- Create unique index DSR business key

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'UX_rpl_dsr_business_key'
      AND object_id = OBJECT_ID(N'dbo.rpl_dsr_uploads')
)
BEGIN

    CREATE INDEX UX_rpl_dsr_business_key
    ON dbo.rpl_dsr_uploads
    (
        batch_id,
        event_date,
        tid
    );

END;