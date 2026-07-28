SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.master_uker', N'U') IS NULL
  BEGIN
    THROW 50301, 'Tabel dbo.master_uker tidak ditemukan.', 1;
  END;

  IF OBJECT_ID(N'dbo.users', N'U') IS NULL
  BEGIN
    THROW 50302, 'Tabel dbo.users tidak ditemukan.', 1;
  END;

  IF OBJECT_ID(N'dbo.pegawai', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.pegawai (
      id INT IDENTITY(1,1) NOT NULL,
      nip VARCHAR(50) NOT NULL,
      nama VARCHAR(100) NOT NULL,
      jabatan VARCHAR(100) NULL,
      handphone VARCHAR(30) NULL,
      email VARCHAR(150) NULL,
      status BIT NOT NULL CONSTRAINT DF_pegawai_status DEFAULT (1),
      status_peg VARCHAR(50) NULL,
      tgl_lahir DATE NULL,
      tgl_job DATE NULL,
      foto VARCHAR(255) NULL,
      uker_id BIGINT NOT NULL,
      created_at DATETIME2(0) NOT NULL CONSTRAINT DF_pegawai_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_pegawai_updated_at DEFAULT (SYSDATETIME()),
      CONSTRAINT PK_pegawai PRIMARY KEY CLUSTERED (id)
    );
  END;

  DECLARE @requiredColumns TABLE (column_name SYSNAME);
  INSERT INTO @requiredColumns (column_name)
  VALUES
    (N'id'), (N'nip'), (N'nama'), (N'jabatan'), (N'handphone'),
    (N'email'), (N'status'), (N'status_peg'), (N'tgl_lahir'),
    (N'tgl_job'), (N'foto'), (N'uker_id');

  IF EXISTS (
    SELECT 1
    FROM @requiredColumns rc
    WHERE COL_LENGTH(N'dbo.pegawai', rc.column_name) IS NULL
  )
  BEGIN
    DECLARE @missingColumn SYSNAME;
    SELECT TOP 1 @missingColumn = rc.column_name
    FROM @requiredColumns rc
    WHERE COL_LENGTH(N'dbo.pegawai', rc.column_name) IS NULL;

    DECLARE @missingMessage NVARCHAR(2048) =
      N'Kolom wajib dbo.pegawai.' + @missingColumn + N' tidak ditemukan.';
    THROW 50303, @missingMessage, 1;
  END;

  IF COL_LENGTH(N'dbo.pegawai', N'created_at') IS NULL
  BEGIN
    ALTER TABLE dbo.pegawai
      ADD created_at DATETIME2(0) NOT NULL
      CONSTRAINT DF_pegawai_created_at_migration DEFAULT (SYSDATETIME());
  END;

  IF COL_LENGTH(N'dbo.pegawai', N'updated_at') IS NULL
  BEGIN
    ALTER TABLE dbo.pegawai
      ADD updated_at DATETIME2(0) NOT NULL
      CONSTRAINT DF_pegawai_updated_at_migration DEFAULT (SYSDATETIME());
  END;

  IF COL_LENGTH(N'dbo.users', N'pegawai_id') IS NULL
  BEGIN
    ALTER TABLE dbo.users ADD pegawai_id INT NULL;
  END;

  IF EXISTS (
    SELECT 1
    FROM dbo.pegawai p
    LEFT JOIN dbo.master_uker mu ON mu.id = p.uker_id
    WHERE p.uker_id IS NOT NULL
      AND mu.id IS NULL
  )
  BEGIN
    THROW 50304, 'Terdapat pegawai.uker_id yang tidak memiliki pasangan pada dbo.master_uker.', 1;
  END;

  IF EXISTS (
    SELECT LTRIM(RTRIM(nip))
    FROM dbo.pegawai
    WHERE nip IS NOT NULL
    GROUP BY LTRIM(RTRIM(nip))
    HAVING COUNT_BIG(*) > 1
  )
  BEGIN
    THROW 50305, 'Terdapat NIP pegawai yang duplikat. Rapikan data sebelum membuat index unik.', 1;
  END;

  IF EXISTS (
    SELECT pegawai_id
    FROM dbo.users
    WHERE pegawai_id IS NOT NULL
    GROUP BY pegawai_id
    HAVING COUNT_BIG(*) > 1
  )
  BEGIN
    THROW 50306, 'Satu pegawai masih digunakan oleh lebih dari satu user.', 1;
  END;

  IF EXISTS (
    SELECT 1
    FROM dbo.users u
    LEFT JOIN dbo.pegawai p ON p.id = u.pegawai_id
    WHERE u.pegawai_id IS NOT NULL
      AND p.id IS NULL
  )
  BEGIN
    THROW 50307, 'Terdapat users.pegawai_id yang tidak memiliki pasangan pada dbo.pegawai.', 1;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_key_columns fkc
    WHERE fkc.parent_object_id = OBJECT_ID(N'dbo.pegawai')
      AND fkc.parent_column_id = COLUMNPROPERTY(OBJECT_ID(N'dbo.pegawai'), N'uker_id', 'ColumnId')
      AND fkc.referenced_object_id = OBJECT_ID(N'dbo.master_uker')
      AND fkc.referenced_column_id = COLUMNPROPERTY(OBJECT_ID(N'dbo.master_uker'), N'id', 'ColumnId')
  )
  BEGIN
    ALTER TABLE dbo.pegawai WITH CHECK
      ADD CONSTRAINT FK_pegawai_master_uker
      FOREIGN KEY (uker_id) REFERENCES dbo.master_uker(id);

    ALTER TABLE dbo.pegawai CHECK CONSTRAINT FK_pegawai_master_uker;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_key_columns fkc
    WHERE fkc.parent_object_id = OBJECT_ID(N'dbo.users')
      AND fkc.parent_column_id = COLUMNPROPERTY(OBJECT_ID(N'dbo.users'), N'pegawai_id', 'ColumnId')
      AND fkc.referenced_object_id = OBJECT_ID(N'dbo.pegawai')
      AND fkc.referenced_column_id = COLUMNPROPERTY(OBJECT_ID(N'dbo.pegawai'), N'id', 'ColumnId')
  )
  BEGIN
    ALTER TABLE dbo.users WITH CHECK
      ADD CONSTRAINT FK_users_pegawai
      FOREIGN KEY (pegawai_id) REFERENCES dbo.pegawai(id);

    ALTER TABLE dbo.users CHECK CONSTRAINT FK_users_pegawai;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.pegawai')
      AND name = N'UX_pegawai_nip'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_pegawai_nip
      ON dbo.pegawai(nip)
      WHERE nip IS NOT NULL;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.pegawai')
      AND name = N'IX_pegawai_uker_id'
  )
  BEGIN
    CREATE INDEX IX_pegawai_uker_id
      ON dbo.pegawai(uker_id)
      INCLUDE (nip, nama, status);
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.users')
      AND name = N'UX_users_pegawai_id'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_users_pegawai_id
      ON dbo.users(pegawai_id)
      WHERE pegawai_id IS NOT NULL;
  END;

  UPDATE u
  SET
    u.full_name = COALESCE(NULLIF(LTRIM(RTRIM(p.nama)), N''), u.full_name),
    u.email = COALESCE(NULLIF(LTRIM(RTRIM(p.email)), N''), u.email),
    u.codeuker = CASE
      WHEN r.role_code = N'SUPER_ADMIN' THEN NULL
      ELSE mu.codeuker
    END,
    u.updated_at = SYSDATETIME()
  FROM dbo.users u
  INNER JOIN dbo.roles r ON r.id = u.role_id
  INNER JOIN dbo.pegawai p ON p.id = u.pegawai_id
  INNER JOIN dbo.master_uker mu ON mu.id = p.uker_id;

  COMMIT TRANSACTION;

  SELECT
    p.id,
    p.nip,
    p.nama,
    p.uker_id,
    mu.codeuker,
    mu.nama_uker
  FROM dbo.pegawai p
  LEFT JOIN dbo.master_uker mu ON mu.id = p.uker_id
  ORDER BY p.nama, p.id;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
