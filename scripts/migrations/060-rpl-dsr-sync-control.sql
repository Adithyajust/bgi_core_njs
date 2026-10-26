IF NOT EXISTS (
 SELECT 1 FROM sys.tables WHERE name='rpl_dsr_sync_control'
)
BEGIN
CREATE TABLE dbo.rpl_dsr_sync_control
(
 id INT IDENTITY(1,1) PRIMARY KEY,
 reporting_uker_id BIGINT NOT NULL,
 period CHAR(7) NOT NULL,
 branch NVARCHAR(150) NOT NULL,
 last_sync_date DATE NOT NULL,
 last_batch_id INT NULL,
 created_at DATETIME2 DEFAULT GETDATE(),
 updated_at DATETIME2 DEFAULT GETDATE()
);

CREATE INDEX UX_rpl_dsr_sync_control
ON dbo.rpl_dsr_sync_control
(
 reporting_uker_id,
 period,
 branch
);
END;
