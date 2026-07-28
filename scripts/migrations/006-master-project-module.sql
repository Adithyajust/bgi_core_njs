SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.master_uker', N'U') IS NULL
  BEGIN
    THROW 50601, 'Tabel dbo.master_uker tidak ditemukan.', 1;
  END;

  IF OBJECT_ID(N'dbo.master_project', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.master_project (
      id BIGINT IDENTITY(1,1) NOT NULL,
      kode_project VARCHAR(30) NOT NULL,
      nama_project NVARCHAR(150) NOT NULL,
      customer NVARCHAR(150) NULL,
      lokasi NVARCHAR(255) NULL,
      uker_id BIGINT NOT NULL,
      project_manager NVARCHAR(150) NULL,
      tanggal_mulai DATE NULL,
      tanggal_selesai DATE NULL,
      nilai_project DECIMAL(18,2) NULL,
      status_project VARCHAR(20) NOT NULL
        CONSTRAINT DF_master_project_status DEFAULT ('PERENCANAAN'),
      progress TINYINT NOT NULL
        CONSTRAINT DF_master_project_progress DEFAULT (0),
      keterangan NVARCHAR(500) NULL,
      is_active BIT NOT NULL
        CONSTRAINT DF_master_project_is_active DEFAULT (1),
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_master_project_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_master_project_updated_at DEFAULT (SYSDATETIME()),
      CONSTRAINT PK_master_project PRIMARY KEY CLUSTERED (id),
      CONSTRAINT CK_master_project_status CHECK (
        status_project IN (
          'PERENCANAAN',
          'BERJALAN',
          'DITUNDA',
          'SELESAI',
          'DIBATALKAN'
        )
      ),
      CONSTRAINT CK_master_project_progress CHECK (
        progress BETWEEN 0 AND 100
      ),
      CONSTRAINT CK_master_project_nilai CHECK (
        nilai_project IS NULL OR nilai_project >= 0
      ),
      CONSTRAINT CK_master_project_tanggal CHECK (
        tanggal_mulai IS NULL
        OR tanggal_selesai IS NULL
        OR tanggal_selesai >= tanggal_mulai
      )
    );
  END;

  /*
    Penyesuaian apabila migration versi lama sudah pernah dijalankan.
    Nama project manager dipindahkan menjadi teks biasa, lalu relasi ke
    dbo.pegawai dan kolom project_manager_id dihapus.
  */
  IF COL_LENGTH(N'dbo.master_project', N'project_manager') IS NULL
  BEGIN
    ALTER TABLE dbo.master_project
      ADD project_manager NVARCHAR(150) NULL;
  END;

  IF COL_LENGTH(N'dbo.master_project', N'project_manager_id') IS NOT NULL
  BEGIN
    IF OBJECT_ID(N'dbo.pegawai', N'U') IS NOT NULL
       AND COL_LENGTH(N'dbo.pegawai', N'nama') IS NOT NULL
    BEGIN
      EXEC sys.sp_executesql N'
        UPDATE mp
        SET mp.project_manager = COALESCE(
          NULLIF(LTRIM(RTRIM(mp.project_manager)), N''''),
          NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(150), p.nama))), N'''')
        )
        FROM dbo.master_project mp
        LEFT JOIN dbo.pegawai p
          ON p.id = mp.project_manager_id
        WHERE mp.project_manager_id IS NOT NULL;
      ';
    END;

    DECLARE @constraintName SYSNAME;
    DECLARE @dropSql NVARCHAR(MAX);

    WHILE 1 = 1
    BEGIN
      SET @constraintName = NULL;

      SELECT TOP (1)
        @constraintName = fk.name
      FROM sys.foreign_keys fk
      INNER JOIN sys.foreign_key_columns fkc
        ON fkc.constraint_object_id = fk.object_id
      WHERE fk.parent_object_id = OBJECT_ID(N'dbo.master_project')
        AND fkc.parent_column_id = COLUMNPROPERTY(
          OBJECT_ID(N'dbo.master_project'),
          N'project_manager_id',
          'ColumnId'
        );

      IF @constraintName IS NULL BREAK;

      SET @dropSql = N'ALTER TABLE dbo.master_project DROP CONSTRAINT '
        + QUOTENAME(@constraintName) + N';';
      EXEC sys.sp_executesql @dropSql;
    END;

    DECLARE @indexName SYSNAME;

    WHILE 1 = 1
    BEGIN
      SET @indexName = NULL;

      SELECT TOP (1)
        @indexName = i.name
      FROM sys.indexes i
      INNER JOIN sys.index_columns ic
        ON ic.object_id = i.object_id
       AND ic.index_id = i.index_id
      WHERE i.object_id = OBJECT_ID(N'dbo.master_project')
        AND i.name IS NOT NULL
        AND i.is_primary_key = 0
        AND i.is_unique_constraint = 0
        AND ic.column_id = COLUMNPROPERTY(
          OBJECT_ID(N'dbo.master_project'),
          N'project_manager_id',
          'ColumnId'
        );

      IF @indexName IS NULL BREAK;

      SET @dropSql = N'DROP INDEX ' + QUOTENAME(@indexName)
        + N' ON dbo.master_project;';
      EXEC sys.sp_executesql @dropSql;
    END;

    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.master_project
      DROP COLUMN project_manager_id;
    ';
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_key_columns fkc
    WHERE fkc.parent_object_id = OBJECT_ID(N'dbo.master_project')
      AND fkc.parent_column_id = COLUMNPROPERTY(
        OBJECT_ID(N'dbo.master_project'),
        N'uker_id',
        'ColumnId'
      )
      AND fkc.referenced_object_id = OBJECT_ID(N'dbo.master_uker')
      AND fkc.referenced_column_id = COLUMNPROPERTY(
        OBJECT_ID(N'dbo.master_uker'),
        N'id',
        'ColumnId'
      )
  )
  BEGIN
    ALTER TABLE dbo.master_project WITH CHECK
      ADD CONSTRAINT FK_master_project_master_uker
      FOREIGN KEY (uker_id) REFERENCES dbo.master_uker(id);

    ALTER TABLE dbo.master_project
      CHECK CONSTRAINT FK_master_project_master_uker;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_project')
      AND name = N'UX_master_project_kode_project'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_master_project_kode_project
      ON dbo.master_project(kode_project);
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_project')
      AND name = N'IX_master_project_uker_id'
  )
  BEGIN
    CREATE INDEX IX_master_project_uker_id
      ON dbo.master_project(uker_id);
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.master_project')
      AND name = N'IX_master_project_status_project'
  )
  BEGIN
    CREATE INDEX IX_master_project_status_project
      ON dbo.master_project(status_project, is_active);
  END;

  COMMIT TRANSACTION;

  SELECT
    'Migration 006 master project berhasil dijalankan tanpa relasi ke pegawai.' AS message,
    OBJECT_ID(N'dbo.master_project', N'U') AS master_project_object_id;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0
  BEGIN
    ROLLBACK TRANSACTION;
  END;

  THROW;
END CATCH;
