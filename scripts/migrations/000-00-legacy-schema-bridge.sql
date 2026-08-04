SET NOCOUNT ON;
SET XACT_ABORT ON;

/*
  Adapter satu kali untuk database yang pernah dibuat oleh scripts/init-db.mjs
  versi lama. Migration ini tidak membuat akun dan tidak menambahkan password.
*/
BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.roles', N'U') IS NOT NULL
  BEGIN
    IF COL_LENGTH(N'dbo.roles', N'role_code') IS NULL
      ALTER TABLE dbo.roles ADD role_code VARCHAR(50) NULL;

    IF COL_LENGTH(N'dbo.roles', N'role_name') IS NULL
      ALTER TABLE dbo.roles ADD role_name VARCHAR(100) NULL;

    IF COL_LENGTH(N'dbo.roles', N'description') IS NULL
      ALTER TABLE dbo.roles ADD description VARCHAR(255) NULL;

    IF COL_LENGTH(N'dbo.roles', N'is_active') IS NULL
      ALTER TABLE dbo.roles ADD is_active BIT NULL;

    IF COL_LENGTH(N'dbo.roles', N'created_at') IS NULL
      ALTER TABLE dbo.roles ADD created_at DATETIME2(0) NULL;

    IF COL_LENGTH(N'dbo.roles', N'updated_at') IS NULL
      ALTER TABLE dbo.roles ADD updated_at DATETIME2(0) NULL;

    IF COL_LENGTH(N'dbo.roles', N'name') IS NOT NULL
    BEGIN
      EXEC sys.sp_executesql N'
        UPDATE dbo.roles
        SET
          role_code = COALESCE(
            NULLIF(LTRIM(RTRIM(role_code)), ''''),
            CASE UPPER(LTRIM(RTRIM(COALESCE(name, ''''))))
              WHEN ''SUPER ADMIN'' THEN ''SUPER_ADMIN''
              WHEN ''SUPER_ADMIN'' THEN ''SUPER_ADMIN''
              WHEN ''MANAGER'' THEN ''MANAGER''
              WHEN ''OPERATOR'' THEN ''OPERATOR''
              ELSE CONCAT(''ROLE_'', id)
            END
          ),
          role_name = COALESCE(
            NULLIF(LTRIM(RTRIM(role_name)), ''''),
            NULLIF(LTRIM(RTRIM(COALESCE(name, ''''))), ''''),
            CONCAT(''Role '', id)
          ),
          is_active = ISNULL(is_active, 1),
          created_at = ISNULL(created_at, SYSDATETIME()),
          updated_at = ISNULL(updated_at, SYSDATETIME());
      ';
    END
    ELSE
    BEGIN
      EXEC sys.sp_executesql N'
        UPDATE dbo.roles
        SET
          role_code = COALESCE(NULLIF(LTRIM(RTRIM(role_code)), ''''), CONCAT(''ROLE_'', id)),
          role_name = COALESCE(NULLIF(LTRIM(RTRIM(role_name)), ''''), CONCAT(''Role '', id)),
          is_active = ISNULL(is_active, 1),
          created_at = ISNULL(created_at, SYSDATETIME()),
          updated_at = ISNULL(updated_at, SYSDATETIME());
      ';
    END;

    DECLARE @hasDuplicateRoleCode BIT = 0;

    EXEC sys.sp_executesql
      N'SELECT @result = CASE WHEN EXISTS (
          SELECT role_code
          FROM dbo.roles
          GROUP BY role_code
          HAVING COUNT_BIG(*) > 1
        ) THEN 1 ELSE 0 END;',
      N'@result BIT OUTPUT',
      @result = @hasDuplicateRoleCode OUTPUT;

    IF @hasDuplicateRoleCode = 1
      THROW 50020, 'Role code hasil konversi schema lama tidak unik.', 1;

    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.roles ALTER COLUMN role_code VARCHAR(50) NOT NULL;
      ALTER TABLE dbo.roles ALTER COLUMN role_name VARCHAR(100) NOT NULL;
      ALTER TABLE dbo.roles ALTER COLUMN is_active BIT NOT NULL;
      ALTER TABLE dbo.roles ALTER COLUMN created_at DATETIME2(0) NOT NULL;
      ALTER TABLE dbo.roles ALTER COLUMN updated_at DATETIME2(0) NOT NULL;
    ';


    /* Kolom name versi lama tidak lagi menjadi business key. */
    IF COL_LENGTH(N'dbo.roles', N'name') IS NOT NULL
    BEGIN
      DECLARE @dropLegacyRoleNameUnique NVARCHAR(MAX) = N'';

      SELECT @dropLegacyRoleNameUnique = @dropLegacyRoleNameUnique +
        CASE
          WHEN kc.name IS NOT NULL THEN
            N'ALTER TABLE dbo.roles DROP CONSTRAINT ' + QUOTENAME(kc.name) + N';'
          ELSE
            N'DROP INDEX ' + QUOTENAME(i.name) + N' ON dbo.roles;'
        END
      FROM sys.indexes i
      INNER JOIN sys.index_columns ic
        ON ic.object_id = i.object_id
       AND ic.index_id = i.index_id
       AND ic.key_ordinal = 1
      INNER JOIN sys.columns c
        ON c.object_id = ic.object_id
       AND c.column_id = ic.column_id
      LEFT JOIN sys.key_constraints kc
        ON kc.parent_object_id = i.object_id
       AND kc.unique_index_id = i.index_id
      WHERE i.object_id = OBJECT_ID(N'dbo.roles')
        AND i.is_unique = 1
        AND c.name = N'name'
        AND 1 = (
          SELECT COUNT(*)
          FROM sys.index_columns x
          WHERE x.object_id = i.object_id
            AND x.index_id = i.index_id
            AND x.key_ordinal > 0
        );

      IF @dropLegacyRoleNameUnique <> N''
        EXEC sys.sp_executesql @dropLegacyRoleNameUnique;

      EXEC sys.sp_executesql N'ALTER TABLE dbo.roles ALTER COLUMN name VARCHAR(50) NULL;';
    END;
  END;

  IF OBJECT_ID(N'dbo.users', N'U') IS NOT NULL
  BEGIN
    IF COL_LENGTH(N'dbo.users', N'email') IS NULL
      ALTER TABLE dbo.users ADD email VARCHAR(150) NULL;
    IF COL_LENGTH(N'dbo.users', N'pegawai_id') IS NULL
      ALTER TABLE dbo.users ADD pegawai_id INT NULL;
    IF COL_LENGTH(N'dbo.users', N'codeuker') IS NULL
      ALTER TABLE dbo.users ADD codeuker NVARCHAR(4) NULL;
    IF COL_LENGTH(N'dbo.users', N'must_change_password') IS NULL
      ALTER TABLE dbo.users ADD must_change_password BIT NULL;
    IF COL_LENGTH(N'dbo.users', N'failed_login_count') IS NULL
      ALTER TABLE dbo.users ADD failed_login_count INT NULL;
    IF COL_LENGTH(N'dbo.users', N'locked_until') IS NULL
      ALTER TABLE dbo.users ADD locked_until DATETIME2(0) NULL;
    IF COL_LENGTH(N'dbo.users', N'last_login_at') IS NULL
      ALTER TABLE dbo.users ADD last_login_at DATETIME2(0) NULL;
    IF COL_LENGTH(N'dbo.users', N'password_changed_at') IS NULL
      ALTER TABLE dbo.users ADD password_changed_at DATETIME2(0) NULL;
    IF COL_LENGTH(N'dbo.users', N'updated_at') IS NULL
      ALTER TABLE dbo.users ADD updated_at DATETIME2(0) NULL;
    IF COL_LENGTH(N'dbo.users', N'row_version') IS NULL
      ALTER TABLE dbo.users ADD row_version ROWVERSION;

    EXEC sys.sp_executesql N'
      UPDATE dbo.users
      SET
        is_active = ISNULL(is_active, 1),
        must_change_password = ISNULL(must_change_password, 1),
        failed_login_count = ISNULL(failed_login_count, 0),
        created_at = ISNULL(created_at, SYSDATETIME()),
        updated_at = ISNULL(updated_at, SYSDATETIME());

      /* Nonaktifkan hanya akun demo persis dari initializer lama. */
      UPDATE dbo.users
      SET
        is_active = 0,
        must_change_password = 1,
        updated_at = SYSDATETIME()
      WHERE
        (username = ''admin'' AND full_name = ''Admin Demo'')
        OR (username = ''manager'' AND full_name = ''Manager Corporate'')
        OR (username = ''operator'' AND full_name = ''Operator Cabang'');
    ';

    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.users ALTER COLUMN is_active BIT NOT NULL;
      ALTER TABLE dbo.users ALTER COLUMN must_change_password BIT NOT NULL;
      ALTER TABLE dbo.users ALTER COLUMN failed_login_count INT NOT NULL;
      ALTER TABLE dbo.users ALTER COLUMN created_at DATETIME2(0) NOT NULL;
      ALTER TABLE dbo.users ALTER COLUMN updated_at DATETIME2(0) NOT NULL;
    ';
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
