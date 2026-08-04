SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF COL_LENGTH(N'dbo.role_sidebar_routes', N'can_create') IS NULL
    ALTER TABLE dbo.role_sidebar_routes ADD can_create BIT NOT NULL CONSTRAINT DF_rsr_can_create DEFAULT (0) WITH VALUES;
  IF COL_LENGTH(N'dbo.role_sidebar_routes', N'can_update') IS NULL
    ALTER TABLE dbo.role_sidebar_routes ADD can_update BIT NOT NULL CONSTRAINT DF_rsr_can_update DEFAULT (0) WITH VALUES;
  IF COL_LENGTH(N'dbo.role_sidebar_routes', N'can_delete') IS NULL
    ALTER TABLE dbo.role_sidebar_routes ADD can_delete BIT NOT NULL CONSTRAINT DF_rsr_can_delete DEFAULT (0) WITH VALUES;

  UPDATE rsr
  SET can_view = 1, can_create = 1, can_update = 1, can_delete = 1, updated_at = SYSDATETIME()
  FROM dbo.role_sidebar_routes rsr
  INNER JOIN dbo.roles r ON r.id = rsr.role_id
  WHERE r.role_code = 'SUPER_ADMIN';

  IF OBJECT_ID(N'dbo.security_rate_limits', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.security_rate_limits (
      key_hash CHAR(64) NOT NULL,
      namespace VARCHAR(80) NOT NULL,
      window_started_at DATETIME2(0) NOT NULL,
      request_count INT NOT NULL,
      updated_at DATETIME2(0) NOT NULL,
      CONSTRAINT PK_security_rate_limits PRIMARY KEY CLUSTERED (key_hash),
      CONSTRAINT CK_security_rate_limits_count CHECK (request_count >= 0)
    );
  END;

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.security_rate_limits') AND name = N'IX_security_rate_limits_cleanup')
    CREATE INDEX IX_security_rate_limits_cleanup ON dbo.security_rate_limits(updated_at);

  IF OBJECT_ID(N'dbo.audit_logs', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.audit_logs (
      id BIGINT IDENTITY(1,1) NOT NULL,
      user_id INT NULL,
      action VARCHAR(30) NOT NULL,
      module VARCHAR(100) NOT NULL,
      entity_type VARCHAR(100) NULL,
      entity_id VARCHAR(100) NULL,
      ip_address VARCHAR(45) NULL,
      request_id VARCHAR(64) NULL,
      metadata_json NVARCHAR(MAX) NULL,
      created_at DATETIME2(0) NOT NULL CONSTRAINT DF_audit_logs_created DEFAULT (SYSDATETIME()),
      CONSTRAINT PK_audit_logs PRIMARY KEY CLUSTERED (id),
      CONSTRAINT FK_audit_logs_users FOREIGN KEY (user_id) REFERENCES dbo.users(id),
      CONSTRAINT CK_audit_logs_json CHECK (metadata_json IS NULL OR ISJSON(metadata_json) = 1)
    );
  END;

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.audit_logs') AND name = N'IX_audit_logs_user_created')
    CREATE INDEX IX_audit_logs_user_created ON dbo.audit_logs(user_id, created_at DESC) INCLUDE (action, module, entity_type, entity_id);
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.audit_logs') AND name = N'IX_audit_logs_module_created')
    CREATE INDEX IX_audit_logs_module_created ON dbo.audit_logs(module, created_at DESC) INCLUDE (action, entity_type, entity_id);

  IF OBJECT_ID(N'dbo.master_mesin', N'U') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.master_mesin') AND name = N'IX_master_mesin_active_id')
    CREATE INDEX IX_master_mesin_active_id ON dbo.master_mesin(is_active, id DESC)
      INCLUDE (tid, sn, cabang_id, project_id, tipe_mesin_id, site, garansi, updated_at);

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
