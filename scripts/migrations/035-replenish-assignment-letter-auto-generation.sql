SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.replenish_assignment_letters', N'U') IS NULL
    THROW 53501, 'Tabel dbo.replenish_assignment_letters belum tersedia.', 1;

  DECLARE @defaultConstraint SYSNAME;
  DECLARE @dropDefaultConstraintSql NVARCHAR(MAX);

  SELECT @defaultConstraint = dc.name
  FROM sys.default_constraints dc
  INNER JOIN sys.columns c
    ON c.object_id = dc.parent_object_id
   AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID(N'dbo.replenish_assignment_letters')
    AND c.name = N'status';

  IF @defaultConstraint IS NOT NULL
  BEGIN
    SET @dropDefaultConstraintSql =
      N'ALTER TABLE dbo.replenish_assignment_letters DROP CONSTRAINT '
      + QUOTENAME(@defaultConstraint)
      + N';';

    EXEC sys.sp_executesql @dropDefaultConstraintSql;
  END;

  ALTER TABLE dbo.replenish_assignment_letters
    ADD CONSTRAINT DF_replenish_assignment_letter_status_auto
    DEFAULT ('DISETUJUI') FOR status;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
