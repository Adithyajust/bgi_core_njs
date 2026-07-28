SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.master_uker', N'U') IS NULL
  BEGIN
    THROW 50001, 'Tabel dbo.master_uker tidak ditemukan.', 1;
  END;

  IF OBJECT_ID(N'dbo.users', N'U') IS NULL
  BEGIN
    THROW 50002, 'Tabel dbo.users tidak ditemukan.', 1;
  END;

  /*
    Seluruh referensi ke kolom yang mungkin baru dibuat dijalankan melalui
    dynamic SQL. Ini mencegah error "Invalid column name 'codeuker'" karena
    SQL Server mengompilasi satu batch sebelum ALTER TABLE dieksekusi.
  */

  IF COL_LENGTH(N'dbo.master_uker', N'codeuker') IS NULL
  BEGIN
    THROW 50003, 'Kolom dbo.master_uker.codeuker tidak ditemukan.', 1;
  END;

  DECLARE
    @masterDataType SYSNAME,
    @masterMaxLength SMALLINT,
    @masterCollation SYSNAME,
    @columnDefinition NVARCHAR(500),
    @sql NVARCHAR(MAX),
    @hasInvalidData BIT = 0,
    @hasDuplicateData BIT = 0;

  SELECT
    @masterDataType = TYPE_NAME(c.system_type_id),
    @masterMaxLength = c.max_length,
    @masterCollation = c.collation_name
  FROM sys.columns c
  WHERE c.object_id = OBJECT_ID(N'dbo.master_uker')
    AND c.name = N'codeuker';

  IF @masterDataType NOT IN (N'varchar', N'nvarchar', N'char', N'nchar')
  BEGIN
    THROW 50004, 'Tipe data master_uker.codeuker harus varchar, nvarchar, char, atau nchar.', 1;
  END;

  SET @columnDefinition =
    UPPER(@masterDataType) + N'(' +
    CASE
      WHEN @masterMaxLength = -1 THEN N'MAX'
      WHEN @masterDataType IN (N'nvarchar', N'nchar')
        THEN CONVERT(NVARCHAR(10), @masterMaxLength / 2)
      ELSE CONVERT(NVARCHAR(10), @masterMaxLength)
    END + N')';

  IF @masterCollation IS NOT NULL
  BEGIN
    SET @columnDefinition = @columnDefinition + N' COLLATE ' + @masterCollation;
  END;

  IF COL_LENGTH(N'dbo.users', N'codeuker') IS NULL
  BEGIN
    SET @sql = N'ALTER TABLE dbo.users ADD codeuker '
      + @columnDefinition + N' NULL;';

    EXEC sys.sp_executesql @sql;
  END
  ELSE
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM sys.columns uc
      WHERE uc.object_id = OBJECT_ID(N'dbo.users')
        AND uc.name = N'codeuker'
        AND (
          TYPE_NAME(uc.system_type_id) <> @masterDataType
          OR uc.max_length <> @masterMaxLength
          OR ISNULL(uc.collation_name, N'') <> ISNULL(@masterCollation, N'')
        )
    )
    BEGIN
      THROW 50005, 'Tipe atau panjang users.codeuker tidak sama dengan master_uker.codeuker.', 1;
    END;
  END;

  SET @sql = N'
    SELECT @result = CASE WHEN EXISTS (
      SELECT 1
      FROM dbo.master_uker
      WHERE codeuker IS NULL
         OR LTRIM(RTRIM(codeuker)) = N''''
    ) THEN 1 ELSE 0 END;';

  EXEC sys.sp_executesql
    @sql,
    N'@result BIT OUTPUT',
    @result = @hasInvalidData OUTPUT;

  IF @hasInvalidData = 1
  BEGIN
    THROW 50006, 'Terdapat codeuker kosong atau NULL pada dbo.master_uker. Lengkapi data terlebih dahulu.', 1;
  END;

  SET @sql = N'
    SELECT @result = CASE WHEN EXISTS (
      SELECT codeuker
      FROM dbo.master_uker
      GROUP BY codeuker
      HAVING COUNT_BIG(*) > 1
    ) THEN 1 ELSE 0 END;';

  EXEC sys.sp_executesql
    @sql,
    N'@result BIT OUTPUT',
    @result = @hasDuplicateData OUTPUT;

  IF @hasDuplicateData = 1
  BEGIN
    THROW 50007, 'Terdapat codeuker duplikat pada dbo.master_uker. Rapikan data sebelum membuat relasi.', 1;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes i
    WHERE i.object_id = OBJECT_ID(N'dbo.master_uker')
      AND i.is_unique = 1
      AND i.has_filter = 0
      AND EXISTS (
        SELECT 1
        FROM sys.index_columns ic
        INNER JOIN sys.columns c
          ON c.object_id = ic.object_id
         AND c.column_id = ic.column_id
        WHERE ic.object_id = i.object_id
          AND ic.index_id = i.index_id
          AND ic.key_ordinal = 1
          AND c.name = N'codeuker'
      )
      AND 1 = (
        SELECT COUNT(*)
        FROM sys.index_columns ic2
        WHERE ic2.object_id = i.object_id
          AND ic2.index_id = i.index_id
          AND ic2.key_ordinal > 0
      )
  )
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM sys.indexes
      WHERE object_id = OBJECT_ID(N'dbo.master_uker')
        AND name = N'UX_master_uker_codeuker'
    )
    BEGIN
      THROW 50008, 'Index UX_master_uker_codeuker sudah ada tetapi strukturnya tidak sesuai.', 1;
    END;

    EXEC sys.sp_executesql
      N'CREATE UNIQUE INDEX UX_master_uker_codeuker
        ON dbo.master_uker(codeuker);';
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID(N'dbo.users')
      AND name = N'FK_users_master_uker_codeuker'
  )
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.users WITH CHECK
      ADD CONSTRAINT FK_users_master_uker_codeuker
        FOREIGN KEY (codeuker)
        REFERENCES dbo.master_uker(codeuker)
        ON UPDATE CASCADE;

      ALTER TABLE dbo.users
      CHECK CONSTRAINT FK_users_master_uker_codeuker;';
  END;

  COMMIT TRANSACTION;

  EXEC sys.sp_executesql N'
    SELECT
      u.id,
      u.username,
      u.role_id,
      u.codeuker
    FROM dbo.users u
    ORDER BY u.id;';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0
  BEGIN
    ROLLBACK TRANSACTION;
  END;

  THROW;
END CATCH;
