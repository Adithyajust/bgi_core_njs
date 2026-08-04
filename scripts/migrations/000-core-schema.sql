SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.roles', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.roles (
      id INT IDENTITY(1,1) NOT NULL,
      role_code VARCHAR(50) NOT NULL,
      role_name VARCHAR(100) NOT NULL,
      description VARCHAR(255) NULL,
      is_active BIT NOT NULL CONSTRAINT DF_roles_is_active DEFAULT (1),
      created_at DATETIME2(0) NOT NULL CONSTRAINT DF_roles_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_roles_updated_at DEFAULT (SYSDATETIME()),
      CONSTRAINT PK_roles PRIMARY KEY CLUSTERED (id)
    );
  END;

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.roles') AND name = N'UX_roles_role_code')
    CREATE UNIQUE INDEX UX_roles_role_code ON dbo.roles(role_code);

  IF OBJECT_ID(N'dbo.master_uker', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.master_uker (
      id BIGINT IDENTITY(1,1) NOT NULL,
      nama_uker NVARCHAR(100) NOT NULL,
      alamat_uker NVARCHAR(255) NULL,
      kota NVARCHAR(200) NULL,
      kode_pos NVARCHAR(50) NULL,
      telp_branch NVARCHAR(255) NULL,
      gedung_branch NVARCHAR(255) NULL,
      email NVARCHAR(255) NULL,
      tanggal_ops DATE NULL,
      codeuker NVARCHAR(4) NOT NULL,
      created_at DATETIME2(0) NOT NULL CONSTRAINT DF_master_uker_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NULL,
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_master_uker PRIMARY KEY CLUSTERED (id),
      CONSTRAINT CK_master_uker_code_not_blank CHECK (LEN(LTRIM(RTRIM(codeuker))) > 0),
      CONSTRAINT CK_master_uker_name_not_blank CHECK (LEN(LTRIM(RTRIM(nama_uker))) > 0)
    );
  END;

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.master_uker') AND name = N'UX_master_uker_codeuker')
    CREATE UNIQUE INDEX UX_master_uker_codeuker ON dbo.master_uker(codeuker);

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
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_pegawai PRIMARY KEY CLUSTERED (id)
    );
  END;

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_pegawai_master_uker')
  BEGIN
    ALTER TABLE dbo.pegawai WITH CHECK ADD CONSTRAINT FK_pegawai_master_uker
      FOREIGN KEY (uker_id) REFERENCES dbo.master_uker(id);
  END;

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.pegawai') AND name = N'UX_pegawai_nip')
    CREATE UNIQUE INDEX UX_pegawai_nip ON dbo.pegawai(nip);

  IF OBJECT_ID(N'dbo.users', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.users (
      id INT IDENTITY(1,1) NOT NULL,
      username VARCHAR(50) NOT NULL,
      full_name VARCHAR(100) NOT NULL,
      email VARCHAR(150) NULL,
      password_hash VARCHAR(255) NOT NULL,
      role_id INT NOT NULL,
      pegawai_id INT NULL,
      codeuker NVARCHAR(4) NULL,
      is_active BIT NOT NULL CONSTRAINT DF_users_is_active DEFAULT (1),
      must_change_password BIT NOT NULL CONSTRAINT DF_users_must_change_password DEFAULT (1),
      failed_login_count INT NOT NULL CONSTRAINT DF_users_failed_login_count DEFAULT (0),
      locked_until DATETIME2(0) NULL,
      last_login_at DATETIME2(0) NULL,
      password_changed_at DATETIME2(0) NULL,
      created_at DATETIME2(0) NOT NULL CONSTRAINT DF_users_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_users_updated_at DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_users PRIMARY KEY CLUSTERED (id)
    );
  END;

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_users_roles')
    ALTER TABLE dbo.users WITH CHECK ADD CONSTRAINT FK_users_roles FOREIGN KEY (role_id) REFERENCES dbo.roles(id);
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_users_pegawai')
    ALTER TABLE dbo.users WITH CHECK ADD CONSTRAINT FK_users_pegawai FOREIGN KEY (pegawai_id) REFERENCES dbo.pegawai(id);
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_users_master_uker_codeuker')
    ALTER TABLE dbo.users WITH CHECK ADD CONSTRAINT FK_users_master_uker_codeuker FOREIGN KEY (codeuker) REFERENCES dbo.master_uker(codeuker);

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.users') AND name = N'UX_users_username')
    CREATE UNIQUE INDEX UX_users_username ON dbo.users(username);
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.users') AND name = N'UX_users_email')
    CREATE UNIQUE INDEX UX_users_email ON dbo.users(email) WHERE email IS NOT NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.users') AND name = N'UX_users_pegawai_id')
    CREATE UNIQUE INDEX UX_users_pegawai_id ON dbo.users(pegawai_id) WHERE pegawai_id IS NOT NULL;

  IF OBJECT_ID(N'dbo.user_sessions', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.user_sessions (
      id BIGINT IDENTITY(1,1) NOT NULL,
      user_id INT NOT NULL,
      session_token_hash CHAR(64) NOT NULL,
      ip_address VARCHAR(45) NULL,
      user_agent VARCHAR(500) NULL,
      expires_at DATETIME2(0) NOT NULL,
      revoked_at DATETIME2(0) NULL,
      created_at DATETIME2(0) NOT NULL CONSTRAINT DF_user_sessions_created_at DEFAULT (SYSDATETIME()),
      last_activity_at DATETIME2(0) NOT NULL CONSTRAINT DF_user_sessions_activity DEFAULT (SYSDATETIME()),
      CONSTRAINT PK_user_sessions PRIMARY KEY CLUSTERED (id),
      CONSTRAINT FK_user_sessions_users FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE CASCADE
    );
  END;

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.user_sessions') AND name = N'UX_user_sessions_token')
    CREATE UNIQUE INDEX UX_user_sessions_token ON dbo.user_sessions(session_token_hash);
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.user_sessions') AND name = N'IX_user_sessions_user_active')
    CREATE INDEX IX_user_sessions_user_active ON dbo.user_sessions(user_id, revoked_at, expires_at) INCLUDE (last_activity_at);

  IF OBJECT_ID(N'dbo.sidebar_routes', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.sidebar_routes (
      id INT IDENTITY(1,1) NOT NULL,
      label VARCHAR(100) NOT NULL,
      href VARCHAR(200) NOT NULL,
      icon VARCHAR(100) NOT NULL,
      badge VARCHAR(20) NULL,
      sort_order INT NOT NULL CONSTRAINT DF_sidebar_routes_sort DEFAULT (0),
      is_active BIT NOT NULL CONSTRAINT DF_sidebar_routes_active DEFAULT (1),
      created_at DATETIME2(0) NOT NULL CONSTRAINT DF_sidebar_routes_created DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_sidebar_routes_updated DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_sidebar_routes PRIMARY KEY CLUSTERED (id)
    );
  END;

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.sidebar_routes') AND name = N'UX_sidebar_routes_href')
    CREATE UNIQUE INDEX UX_sidebar_routes_href ON dbo.sidebar_routes(href);

  IF OBJECT_ID(N'dbo.navbar_routes', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.navbar_routes (
      id INT IDENTITY(1,1) NOT NULL,
      label VARCHAR(100) NOT NULL,
      href VARCHAR(200) NOT NULL,
      description VARCHAR(255) NULL,
      sort_order INT NOT NULL CONSTRAINT DF_navbar_routes_sort DEFAULT (0),
      is_active BIT NOT NULL CONSTRAINT DF_navbar_routes_active DEFAULT (1),
      created_at DATETIME2(0) NOT NULL CONSTRAINT DF_navbar_routes_created DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_navbar_routes_updated DEFAULT (SYSDATETIME()),
      CONSTRAINT PK_navbar_routes PRIMARY KEY CLUSTERED (id)
    );
  END;

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.navbar_routes') AND name = N'UX_navbar_routes_href')
    CREATE UNIQUE INDEX UX_navbar_routes_href ON dbo.navbar_routes(href);

  IF OBJECT_ID(N'dbo.role_sidebar_routes', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.role_sidebar_routes (
      role_id INT NOT NULL,
      sidebar_route_id INT NOT NULL,
      can_view BIT NOT NULL CONSTRAINT DF_rsr_view DEFAULT (0),
      can_create BIT NOT NULL CONSTRAINT DF_rsr_create DEFAULT (0),
      can_update BIT NOT NULL CONSTRAINT DF_rsr_update DEFAULT (0),
      can_delete BIT NOT NULL CONSTRAINT DF_rsr_delete DEFAULT (0),
      created_at DATETIME2(0) NOT NULL CONSTRAINT DF_rsr_created DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_rsr_updated DEFAULT (SYSDATETIME()),
      CONSTRAINT PK_role_sidebar_routes PRIMARY KEY CLUSTERED (role_id, sidebar_route_id),
      CONSTRAINT FK_rsr_roles FOREIGN KEY (role_id) REFERENCES dbo.roles(id) ON DELETE CASCADE,
      CONSTRAINT FK_rsr_sidebar FOREIGN KEY (sidebar_route_id) REFERENCES dbo.sidebar_routes(id) ON DELETE CASCADE
    );
  END;

  MERGE dbo.roles AS target
  USING (VALUES
    ('SUPER_ADMIN', 'Super Admin', 'Akses penuh seluruh modul'),
    ('MANAGER', 'Manager', 'Akses operasional dan monitoring'),
    ('OPERATOR', 'Operator', 'Akses operasional terbatas')
  ) AS source(role_code, role_name, description)
  ON target.role_code = source.role_code
  WHEN MATCHED THEN UPDATE SET role_name = source.role_name, description = source.description, is_active = 1, updated_at = SYSDATETIME()
  WHEN NOT MATCHED THEN INSERT (role_code, role_name, description, is_active) VALUES (source.role_code, source.role_name, source.description, 1);

  MERGE dbo.sidebar_routes AS target
  USING (VALUES
    ('Dashboard', '/dashboard', 'IconGrid', 'Live', 1),
    ('Master Data', '/masters', 'IconGrid', NULL, 2),
    ('Pengaturan', '/settings', 'IconCog', NULL, 3),
    ('Nasabah Corporate', '/customers', 'IconUsers', NULL, 4),
    ('Transaksi', '/transactions', 'IconTransfer', NULL, 5),
    ('Approval Center', '/approvals', 'IconShield', NULL, 6),
    ('Cabang & Area', '/branches', 'IconGrid', NULL, 7),
    ('Analytics', '/analytics', 'IconReport', NULL, 8),
    ('Risk Monitor', '/risk', 'IconShield', NULL, 9),
    ('Laporan', '/reports', 'IconReport', NULL, 10)
  ) AS source(label, href, icon, badge, sort_order)
  ON target.href = source.href
  WHEN MATCHED THEN UPDATE SET label = source.label, icon = source.icon, badge = source.badge, sort_order = source.sort_order, is_active = 1, updated_at = SYSDATETIME()
  WHEN NOT MATCHED THEN INSERT (label, href, icon, badge, sort_order, is_active) VALUES (source.label, source.href, source.icon, source.badge, source.sort_order, 1);

  MERGE dbo.navbar_routes AS target
  USING (VALUES
    ('Overview', '/dashboard', 'KPI utama', 1),
    ('Corporate', '/customers', 'Nasabah', 2),
    ('Operations', '/transactions', 'Transaksi', 3),
    ('Approvals', '/approvals', 'Persetujuan', 4),
    ('Branches', '/branches', 'Area', 5),
    ('Analytics', '/analytics', 'Insight', 6),
    ('Reports', '/reports', 'Dokumen', 7)
  ) AS source(label, href, description, sort_order)
  ON target.href = source.href
  WHEN MATCHED THEN UPDATE SET label = source.label, description = source.description, sort_order = source.sort_order, is_active = 1, updated_at = SYSDATETIME()
  WHEN NOT MATCHED THEN INSERT (label, href, description, sort_order, is_active) VALUES (source.label, source.href, source.description, source.sort_order, 1);

  INSERT INTO dbo.role_sidebar_routes
  (
    role_id, sidebar_route_id, can_view, can_create, can_update, can_delete
  )
  SELECT r.id, sr.id, 1, 1, 1, 1
  FROM dbo.roles r
  CROSS JOIN dbo.sidebar_routes sr
  WHERE r.role_code = 'SUPER_ADMIN'
    AND NOT EXISTS (
      SELECT 1 FROM dbo.role_sidebar_routes x
      WHERE x.role_id = r.id AND x.sidebar_route_id = sr.id
    );

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
