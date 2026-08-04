SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.audit_logs', N'U') IS NULL
    THROW 51000, 'Tabel dbo.audit_logs belum tersedia. Jalankan migration 012-production-hardening.sql terlebih dahulu.', 1;

  DECLARE @auditUserForeignKey SYSNAME;

  SELECT TOP (1)
    @auditUserForeignKey = fk.name
  FROM sys.foreign_keys fk
  INNER JOIN sys.foreign_key_columns fkc
    ON fkc.constraint_object_id = fk.object_id
  INNER JOIN sys.columns parentColumn
    ON parentColumn.object_id = fkc.parent_object_id
   AND parentColumn.column_id = fkc.parent_column_id
  WHERE fk.parent_object_id = OBJECT_ID(N'dbo.audit_logs')
    AND fk.referenced_object_id = OBJECT_ID(N'dbo.users')
    AND parentColumn.name = N'user_id';

  IF @auditUserForeignKey IS NOT NULL
  BEGIN
    DECLARE @dropAuditForeignKeySql NVARCHAR(MAX);

    SET @dropAuditForeignKeySql =
      N'ALTER TABLE dbo.audit_logs DROP CONSTRAINT ' +
      QUOTENAME(@auditUserForeignKey) + N';';

    EXEC sys.sp_executesql @dropAuditForeignKeySql;
  END;

  UPDATE audit
  SET user_id = NULL
  FROM dbo.audit_logs audit
  WHERE audit.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM dbo.users users
      WHERE users.id = audit.user_id
    );

  ALTER TABLE dbo.audit_logs WITH CHECK
    ADD CONSTRAINT FK_audit_logs_users
    FOREIGN KEY (user_id)
    REFERENCES dbo.users(id)
    ON DELETE SET NULL;

  ALTER TABLE dbo.audit_logs
    CHECK CONSTRAINT FK_audit_logs_users;

  IF OBJECT_ID(N'dbo.audit_log') IS NULL
     AND NOT EXISTS (
       SELECT 1
       FROM sys.synonyms
       WHERE schema_id = SCHEMA_ID(N'dbo')
         AND name = N'audit_log'
     )
  BEGIN
    EXEC(N'
      CREATE VIEW dbo.audit_log
      AS
      SELECT
        id,
        user_id,
        action,
        module,
        entity_type,
        entity_id,
        ip_address,
        request_id,
        metadata_json,
        created_at
      FROM dbo.audit_logs;
    ');
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
