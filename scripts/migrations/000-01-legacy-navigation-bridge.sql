SET NOCOUNT ON;
SET XACT_ABORT ON;

/*
  Menyamakan tabel navigasi dari instalasi lama sebelum baseline schema dijalankan.

  File ini sengaja ditempatkan setelah 000-00-legacy-schema-bridge.sql dan sebelum
  000-core-schema.sql. Jangan menggabungkannya ke migration lama yang mungkin sudah
  tercatat di dbo.schema_migrations.
*/
BEGIN TRY
  BEGIN TRANSACTION;

  /* ------------------------------------------------------------------------ */
  /* sidebar_routes                                                           */
  /* ------------------------------------------------------------------------ */
  IF OBJECT_ID(N'dbo.sidebar_routes', N'U') IS NOT NULL
  BEGIN
    IF COL_LENGTH(N'dbo.sidebar_routes', N'id') IS NULL
      THROW 51001, 'Tabel dbo.sidebar_routes tidak memiliki kolom id. Perbaiki schema lama sebelum melanjutkan migration.', 1;

    IF COL_LENGTH(N'dbo.sidebar_routes', N'label') IS NULL
      ALTER TABLE dbo.sidebar_routes ADD label VARCHAR(100) NULL;

    IF COL_LENGTH(N'dbo.sidebar_routes', N'href') IS NULL
      ALTER TABLE dbo.sidebar_routes ADD href VARCHAR(200) NULL;

    IF COL_LENGTH(N'dbo.sidebar_routes', N'icon') IS NULL
      ALTER TABLE dbo.sidebar_routes ADD icon VARCHAR(100) NULL;

    IF COL_LENGTH(N'dbo.sidebar_routes', N'badge') IS NULL
      ALTER TABLE dbo.sidebar_routes ADD badge VARCHAR(20) NULL;

    IF COL_LENGTH(N'dbo.sidebar_routes', N'sort_order') IS NULL
      ALTER TABLE dbo.sidebar_routes ADD sort_order INT NULL;

    IF COL_LENGTH(N'dbo.sidebar_routes', N'is_active') IS NULL
      ALTER TABLE dbo.sidebar_routes ADD is_active BIT NULL;

    IF COL_LENGTH(N'dbo.sidebar_routes', N'created_at') IS NULL
      ALTER TABLE dbo.sidebar_routes ADD created_at DATETIME2(0) NULL;

    IF COL_LENGTH(N'dbo.sidebar_routes', N'updated_at') IS NULL
      ALTER TABLE dbo.sidebar_routes ADD updated_at DATETIME2(0) NULL;

    IF COL_LENGTH(N'dbo.sidebar_routes', N'row_version') IS NULL
       AND NOT EXISTS (
         SELECT 1
         FROM sys.columns
         WHERE object_id = OBJECT_ID(N'dbo.sidebar_routes')
           AND system_type_id = 189
       )
      ALTER TABLE dbo.sidebar_routes ADD row_version ROWVERSION;

    /* Gunakan dynamic SQL agar kolom yang baru ditambahkan dikenali compiler. */
    IF COL_LENGTH(N'dbo.sidebar_routes', N'name') IS NOT NULL
      EXEC sys.sp_executesql N'
        UPDATE dbo.sidebar_routes
        SET label = COALESCE(NULLIF(LTRIM(RTRIM(label)), ''''), NULLIF(LTRIM(RTRIM(name)), ''''), CONCAT(''Menu '', id));
      ';
    ELSE
      EXEC sys.sp_executesql N'
        UPDATE dbo.sidebar_routes
        SET label = COALESCE(NULLIF(LTRIM(RTRIM(label)), ''''), CONCAT(''Menu '', id));
      ';

    IF COL_LENGTH(N'dbo.sidebar_routes', N'url') IS NOT NULL
      EXEC sys.sp_executesql N'
        UPDATE dbo.sidebar_routes
        SET href = COALESCE(NULLIF(LTRIM(RTRIM(href)), ''''), NULLIF(LTRIM(RTRIM(url)), ''''), CONCAT(''/legacy-menu/'', id));
      ';
    ELSE
      EXEC sys.sp_executesql N'
        UPDATE dbo.sidebar_routes
        SET href = COALESCE(NULLIF(LTRIM(RTRIM(href)), ''''), CONCAT(''/legacy-menu/'', id));
      ';

    EXEC sys.sp_executesql N'
      UPDATE dbo.sidebar_routes
      SET
        icon = COALESCE(NULLIF(LTRIM(RTRIM(icon)), ''''), ''IconGrid''),
        sort_order = ISNULL(sort_order, id),
        is_active = ISNULL(is_active, 1),
        created_at = ISNULL(created_at, SYSDATETIME()),
        updated_at = ISNULL(updated_at, SYSDATETIME());
    ';

    IF EXISTS (
      SELECT href
      FROM dbo.sidebar_routes
      GROUP BY href
      HAVING COUNT(*) > 1
    )
      THROW 51002, 'Terdapat href duplikat pada dbo.sidebar_routes. Hapus atau ubah duplikat sebelum menjalankan migration.', 1;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.default_constraints dc
      INNER JOIN sys.columns c
        ON c.object_id = dc.parent_object_id
       AND c.column_id = dc.parent_column_id
      WHERE dc.parent_object_id = OBJECT_ID(N'dbo.sidebar_routes')
        AND c.name = N'sort_order'
    )
      ALTER TABLE dbo.sidebar_routes ADD CONSTRAINT DF_legacy_sidebar_routes_sort_order DEFAULT (0) FOR sort_order;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.default_constraints dc
      INNER JOIN sys.columns c
        ON c.object_id = dc.parent_object_id
       AND c.column_id = dc.parent_column_id
      WHERE dc.parent_object_id = OBJECT_ID(N'dbo.sidebar_routes')
        AND c.name = N'is_active'
    )
      ALTER TABLE dbo.sidebar_routes ADD CONSTRAINT DF_legacy_sidebar_routes_is_active DEFAULT (1) FOR is_active;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.default_constraints dc
      INNER JOIN sys.columns c
        ON c.object_id = dc.parent_object_id
       AND c.column_id = dc.parent_column_id
      WHERE dc.parent_object_id = OBJECT_ID(N'dbo.sidebar_routes')
        AND c.name = N'created_at'
    )
      ALTER TABLE dbo.sidebar_routes ADD CONSTRAINT DF_legacy_sidebar_routes_created_at DEFAULT (SYSDATETIME()) FOR created_at;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.default_constraints dc
      INNER JOIN sys.columns c
        ON c.object_id = dc.parent_object_id
       AND c.column_id = dc.parent_column_id
      WHERE dc.parent_object_id = OBJECT_ID(N'dbo.sidebar_routes')
        AND c.name = N'updated_at'
    )
      ALTER TABLE dbo.sidebar_routes ADD CONSTRAINT DF_legacy_sidebar_routes_updated_at DEFAULT (SYSDATETIME()) FOR updated_at;
  END;

  /* ------------------------------------------------------------------------ */
  /* navbar_routes                                                            */
  /* ------------------------------------------------------------------------ */
  IF OBJECT_ID(N'dbo.navbar_routes', N'U') IS NOT NULL
  BEGIN
    IF COL_LENGTH(N'dbo.navbar_routes', N'id') IS NULL
      THROW 51003, 'Tabel dbo.navbar_routes tidak memiliki kolom id. Perbaiki schema lama sebelum melanjutkan migration.', 1;

    IF COL_LENGTH(N'dbo.navbar_routes', N'label') IS NULL
      ALTER TABLE dbo.navbar_routes ADD label VARCHAR(100) NULL;

    IF COL_LENGTH(N'dbo.navbar_routes', N'href') IS NULL
      ALTER TABLE dbo.navbar_routes ADD href VARCHAR(200) NULL;

    IF COL_LENGTH(N'dbo.navbar_routes', N'description') IS NULL
      ALTER TABLE dbo.navbar_routes ADD description VARCHAR(255) NULL;

    IF COL_LENGTH(N'dbo.navbar_routes', N'sort_order') IS NULL
      ALTER TABLE dbo.navbar_routes ADD sort_order INT NULL;

    IF COL_LENGTH(N'dbo.navbar_routes', N'is_active') IS NULL
      ALTER TABLE dbo.navbar_routes ADD is_active BIT NULL;

    IF COL_LENGTH(N'dbo.navbar_routes', N'created_at') IS NULL
      ALTER TABLE dbo.navbar_routes ADD created_at DATETIME2(0) NULL;

    IF COL_LENGTH(N'dbo.navbar_routes', N'updated_at') IS NULL
      ALTER TABLE dbo.navbar_routes ADD updated_at DATETIME2(0) NULL;

    IF COL_LENGTH(N'dbo.navbar_routes', N'name') IS NOT NULL
      EXEC sys.sp_executesql N'
        UPDATE dbo.navbar_routes
        SET label = COALESCE(NULLIF(LTRIM(RTRIM(label)), ''''), NULLIF(LTRIM(RTRIM(name)), ''''), CONCAT(''Navbar '', id));
      ';
    ELSE
      EXEC sys.sp_executesql N'
        UPDATE dbo.navbar_routes
        SET label = COALESCE(NULLIF(LTRIM(RTRIM(label)), ''''), CONCAT(''Navbar '', id));
      ';

    IF COL_LENGTH(N'dbo.navbar_routes', N'url') IS NOT NULL
      EXEC sys.sp_executesql N'
        UPDATE dbo.navbar_routes
        SET href = COALESCE(NULLIF(LTRIM(RTRIM(href)), ''''), NULLIF(LTRIM(RTRIM(url)), ''''), CONCAT(''/legacy-navbar/'', id));
      ';
    ELSE
      EXEC sys.sp_executesql N'
        UPDATE dbo.navbar_routes
        SET href = COALESCE(NULLIF(LTRIM(RTRIM(href)), ''''), CONCAT(''/legacy-navbar/'', id));
      ';

    EXEC sys.sp_executesql N'
      UPDATE dbo.navbar_routes
      SET
        sort_order = ISNULL(sort_order, id),
        is_active = ISNULL(is_active, 1),
        created_at = ISNULL(created_at, SYSDATETIME()),
        updated_at = ISNULL(updated_at, SYSDATETIME());
    ';

    IF EXISTS (
      SELECT href
      FROM dbo.navbar_routes
      GROUP BY href
      HAVING COUNT(*) > 1
    )
      THROW 51004, 'Terdapat href duplikat pada dbo.navbar_routes. Hapus atau ubah duplikat sebelum menjalankan migration.', 1;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.default_constraints dc
      INNER JOIN sys.columns c
        ON c.object_id = dc.parent_object_id
       AND c.column_id = dc.parent_column_id
      WHERE dc.parent_object_id = OBJECT_ID(N'dbo.navbar_routes')
        AND c.name = N'sort_order'
    )
      ALTER TABLE dbo.navbar_routes ADD CONSTRAINT DF_legacy_navbar_routes_sort_order DEFAULT (0) FOR sort_order;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.default_constraints dc
      INNER JOIN sys.columns c
        ON c.object_id = dc.parent_object_id
       AND c.column_id = dc.parent_column_id
      WHERE dc.parent_object_id = OBJECT_ID(N'dbo.navbar_routes')
        AND c.name = N'is_active'
    )
      ALTER TABLE dbo.navbar_routes ADD CONSTRAINT DF_legacy_navbar_routes_is_active DEFAULT (1) FOR is_active;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.default_constraints dc
      INNER JOIN sys.columns c
        ON c.object_id = dc.parent_object_id
       AND c.column_id = dc.parent_column_id
      WHERE dc.parent_object_id = OBJECT_ID(N'dbo.navbar_routes')
        AND c.name = N'created_at'
    )
      ALTER TABLE dbo.navbar_routes ADD CONSTRAINT DF_legacy_navbar_routes_created_at DEFAULT (SYSDATETIME()) FOR created_at;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.default_constraints dc
      INNER JOIN sys.columns c
        ON c.object_id = dc.parent_object_id
       AND c.column_id = dc.parent_column_id
      WHERE dc.parent_object_id = OBJECT_ID(N'dbo.navbar_routes')
        AND c.name = N'updated_at'
    )
      ALTER TABLE dbo.navbar_routes ADD CONSTRAINT DF_legacy_navbar_routes_updated_at DEFAULT (SYSDATETIME()) FOR updated_at;
  END;

  /* ------------------------------------------------------------------------ */
  /* role_sidebar_routes                                                      */
  /* ------------------------------------------------------------------------ */
  IF OBJECT_ID(N'dbo.role_sidebar_routes', N'U') IS NOT NULL
  BEGIN
    IF COL_LENGTH(N'dbo.role_sidebar_routes', N'role_id') IS NULL
       OR COL_LENGTH(N'dbo.role_sidebar_routes', N'sidebar_route_id') IS NULL
      THROW 51005, 'Tabel dbo.role_sidebar_routes tidak memiliki role_id atau sidebar_route_id.', 1;

    /* Relasi lama berarti role sudah memiliki akses lihat. */
    IF COL_LENGTH(N'dbo.role_sidebar_routes', N'can_view') IS NULL
      ALTER TABLE dbo.role_sidebar_routes ADD can_view BIT NOT NULL CONSTRAINT DF_legacy_rsr_can_view DEFAULT (1) WITH VALUES;

    IF COL_LENGTH(N'dbo.role_sidebar_routes', N'can_create') IS NULL
      ALTER TABLE dbo.role_sidebar_routes ADD can_create BIT NOT NULL CONSTRAINT DF_legacy_rsr_can_create DEFAULT (0) WITH VALUES;

    IF COL_LENGTH(N'dbo.role_sidebar_routes', N'can_update') IS NULL
      ALTER TABLE dbo.role_sidebar_routes ADD can_update BIT NOT NULL CONSTRAINT DF_legacy_rsr_can_update DEFAULT (0) WITH VALUES;

    IF COL_LENGTH(N'dbo.role_sidebar_routes', N'can_delete') IS NULL
      ALTER TABLE dbo.role_sidebar_routes ADD can_delete BIT NOT NULL CONSTRAINT DF_legacy_rsr_can_delete DEFAULT (0) WITH VALUES;

    IF COL_LENGTH(N'dbo.role_sidebar_routes', N'created_at') IS NULL
      ALTER TABLE dbo.role_sidebar_routes ADD created_at DATETIME2(0) NOT NULL CONSTRAINT DF_legacy_rsr_created_at DEFAULT (SYSDATETIME()) WITH VALUES;

    IF COL_LENGTH(N'dbo.role_sidebar_routes', N'updated_at') IS NULL
      ALTER TABLE dbo.role_sidebar_routes ADD updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_legacy_rsr_updated_at DEFAULT (SYSDATETIME()) WITH VALUES;

    EXEC sys.sp_executesql N'
      UPDATE dbo.role_sidebar_routes
      SET
        can_view = ISNULL(can_view, 1),
        can_create = ISNULL(can_create, 0),
        can_update = ISNULL(can_update, 0),
        can_delete = ISNULL(can_delete, 0),
        created_at = ISNULL(created_at, SYSDATETIME()),
        updated_at = ISNULL(updated_at, SYSDATETIME());
    ';
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
