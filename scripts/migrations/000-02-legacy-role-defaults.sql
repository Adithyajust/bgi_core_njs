SET NOCOUNT ON;
SET XACT_ABORT ON;

/*
  Compatibility bridge untuk tabel dbo.roles versi lama.

  Database lama dapat memiliki kolom is_active, created_at, dan updated_at
  sebagai NOT NULL, tetapi tanpa DEFAULT constraint. 000-core-schema.sql
  melakukan MERGE dan tidak mengirim ketiga kolom tersebut pada INSERT,
  sehingga SQL Server mencoba memasukkan NULL.

  Migration ini harus dijalankan setelah 000-00-legacy-schema-bridge.sql dan
  sebelum 000-core-schema.sql. Migration aman dijalankan pada database kosong.
*/
BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.roles', N'U') IS NOT NULL
  BEGIN
    /* Pastikan data lama tidak mengandung NULL sebelum constraint diperketat. */
    IF COL_LENGTH(N'dbo.roles', N'is_active') IS NOT NULL
      EXEC sys.sp_executesql N'
        UPDATE dbo.roles
        SET is_active = 1
        WHERE is_active IS NULL;
      ';

    IF COL_LENGTH(N'dbo.roles', N'created_at') IS NOT NULL
      EXEC sys.sp_executesql N'
        UPDATE dbo.roles
        SET created_at = SYSDATETIME()
        WHERE created_at IS NULL;
      ';

    IF COL_LENGTH(N'dbo.roles', N'updated_at') IS NOT NULL
      EXEC sys.sp_executesql N'
        UPDATE dbo.roles
        SET updated_at = SYSDATETIME()
        WHERE updated_at IS NULL;
      ';

    /* Tambahkan DEFAULT hanya jika kolom belum memilikinya. */
    IF COL_LENGTH(N'dbo.roles', N'is_active') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM sys.default_constraints dc
         INNER JOIN sys.columns c
           ON c.object_id = dc.parent_object_id
          AND c.column_id = dc.parent_column_id
         WHERE dc.parent_object_id = OBJECT_ID(N'dbo.roles')
           AND c.name = N'is_active'
       )
    BEGIN
      ALTER TABLE dbo.roles
        ADD CONSTRAINT DF_legacy_roles_is_active
        DEFAULT (1) FOR is_active;
    END;

    IF COL_LENGTH(N'dbo.roles', N'created_at') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM sys.default_constraints dc
         INNER JOIN sys.columns c
           ON c.object_id = dc.parent_object_id
          AND c.column_id = dc.parent_column_id
         WHERE dc.parent_object_id = OBJECT_ID(N'dbo.roles')
           AND c.name = N'created_at'
       )
    BEGIN
      ALTER TABLE dbo.roles
        ADD CONSTRAINT DF_legacy_roles_created_at
        DEFAULT (SYSDATETIME()) FOR created_at;
    END;

    IF COL_LENGTH(N'dbo.roles', N'updated_at') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM sys.default_constraints dc
         INNER JOIN sys.columns c
           ON c.object_id = dc.parent_object_id
          AND c.column_id = dc.parent_column_id
         WHERE dc.parent_object_id = OBJECT_ID(N'dbo.roles')
           AND c.name = N'updated_at'
       )
    BEGIN
      ALTER TABLE dbo.roles
        ADD CONSTRAINT DF_legacy_roles_updated_at
        DEFAULT (SYSDATETIME()) FOR updated_at;
    END;
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
