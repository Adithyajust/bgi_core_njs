SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.replenish_work_orders', N'U') IS NULL
    THROW 54701, 'Tabel dbo.replenish_work_orders belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.replenish_work_order_points', N'U') IS NULL
    THROW 54702, 'Tabel dbo.replenish_work_order_points belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.users', N'U') IS NULL
    THROW 54703, 'Tabel dbo.users belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.replenish_field_events', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.replenish_field_events (
      id BIGINT IDENTITY(1,1) NOT NULL,
      client_event_id UNIQUEIDENTIFIER NOT NULL,
      work_order_id BIGINT NOT NULL,
      work_order_point_id BIGINT NULL,
      action VARCHAR(40) NOT NULL,
      actor_user_id INT NOT NULL,
      device_recorded_at DATETIME2(0) NOT NULL,
      server_recorded_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_replenish_field_event_server_at DEFAULT (SYSDATETIME()),
      latitude DECIMAL(9,6) NULL,
      longitude DECIMAL(9,6) NULL,
      accuracy_m DECIMAL(9,2) NULL,
      offline_created BIT NOT NULL
        CONSTRAINT DF_replenish_field_event_offline DEFAULT (0),
      payload_hash CHAR(64) NOT NULL,
      payload_json NVARCHAR(MAX) NULL,
      response_json NVARCHAR(MAX) NULL,
      CONSTRAINT PK_replenish_field_events PRIMARY KEY CLUSTERED (id),
      CONSTRAINT UX_replenish_field_events_client UNIQUE (client_event_id),
      CONSTRAINT FK_replenish_field_event_work_order
        FOREIGN KEY (work_order_id) REFERENCES dbo.replenish_work_orders(id)
        ON DELETE CASCADE,
      CONSTRAINT FK_replenish_field_event_point
        FOREIGN KEY (work_order_point_id) REFERENCES dbo.replenish_work_order_points(id),
      CONSTRAINT FK_replenish_field_event_actor
        FOREIGN KEY (actor_user_id) REFERENCES dbo.users(id),
      CONSTRAINT CK_replenish_field_event_latitude
        CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
      CONSTRAINT CK_replenish_field_event_longitude
        CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
      CONSTRAINT CK_replenish_field_event_accuracy
        CHECK (accuracy_m IS NULL OR accuracy_m BETWEEN 0 AND 100000),
      CONSTRAINT CK_replenish_field_event_payload_json
        CHECK (payload_json IS NULL OR ISJSON(payload_json) = 1),
      CONSTRAINT CK_replenish_field_event_response_json
        CHECK (response_json IS NULL OR ISJSON(response_json) = 1)
    );
  END;

  IF OBJECT_ID(N'dbo.replenish_field_point_checks', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.replenish_field_point_checks (
      id BIGINT IDENTITY(1,1) NOT NULL,
      work_order_id BIGINT NOT NULL,
      work_order_point_id BIGINT NOT NULL,
      departure_bag_seal_no VARCHAR(100) NULL,
      reject_cassette_serial VARCHAR(100) NULL,
      reject_cassette_seal_no VARCHAR(100) NULL,
      return_bag_seal_no VARCHAR(100) NULL,
      scan_status VARCHAR(30) NOT NULL
        CONSTRAINT DF_replenish_field_check_status DEFAULT ('DRAFT'),
      completed_by INT NULL,
      completed_at DATETIME2(0) NULL,
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_replenish_field_check_created DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_replenish_field_check_updated DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_replenish_field_point_checks PRIMARY KEY CLUSTERED (id),
      CONSTRAINT UX_replenish_field_point_checks_point UNIQUE (work_order_point_id),
      CONSTRAINT FK_replenish_field_check_work_order
        FOREIGN KEY (work_order_id) REFERENCES dbo.replenish_work_orders(id)
        ON DELETE CASCADE,
      CONSTRAINT FK_replenish_field_check_point
        FOREIGN KEY (work_order_point_id) REFERENCES dbo.replenish_work_order_points(id),
      CONSTRAINT FK_replenish_field_check_completed_by
        FOREIGN KEY (completed_by) REFERENCES dbo.users(id),
      CONSTRAINT CK_replenish_field_check_status
        CHECK (scan_status IN ('DRAFT', 'COMPLETE', 'EXCEPTION_PENDING', 'COMPLETE_WITH_EXCEPTION'))
    );
  END;

  IF OBJECT_ID(N'dbo.replenish_field_cassette_exchanges', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.replenish_field_cassette_exchanges (
      id BIGINT IDENTITY(1,1) NOT NULL,
      work_order_id BIGINT NOT NULL,
      work_order_point_id BIGINT NOT NULL,
      cassette_no SMALLINT NOT NULL,
      old_cassette_serial VARCHAR(100) NULL,
      old_seal_no VARCHAR(100) NULL,
      new_cassette_serial VARCHAR(100) NULL,
      new_seal_no VARCHAR(100) NULL,
      scanned_by INT NULL,
      scanned_at DATETIME2(0) NULL,
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_replenish_field_exchange_created DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_replenish_field_exchange_updated DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_replenish_field_cassette_exchanges PRIMARY KEY CLUSTERED (id),
      CONSTRAINT UX_replenish_field_exchange_slot UNIQUE (work_order_point_id, cassette_no),
      CONSTRAINT FK_replenish_field_exchange_work_order
        FOREIGN KEY (work_order_id) REFERENCES dbo.replenish_work_orders(id)
        ON DELETE CASCADE,
      CONSTRAINT FK_replenish_field_exchange_point
        FOREIGN KEY (work_order_point_id) REFERENCES dbo.replenish_work_order_points(id),
      CONSTRAINT FK_replenish_field_exchange_scanned_by
        FOREIGN KEY (scanned_by) REFERENCES dbo.users(id),
      CONSTRAINT CK_replenish_field_exchange_slot
        CHECK (cassette_no BETWEEN 1 AND 20)
    );
  END;

  IF OBJECT_ID(N'dbo.replenish_field_exceptions', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.replenish_field_exceptions (
      id BIGINT IDENTITY(1,1) NOT NULL,
      work_order_id BIGINT NOT NULL,
      work_order_point_id BIGINT NOT NULL,
      source_event_id BIGINT NOT NULL,
      exception_type VARCHAR(40) NOT NULL,
      reason NVARCHAR(1000) NOT NULL,
      mismatch_json NVARCHAR(MAX) NULL,
      status VARCHAR(30) NOT NULL
        CONSTRAINT DF_replenish_field_exception_status DEFAULT ('MENUNGGU_REVIEW'),
      reported_by INT NOT NULL,
      reported_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_replenish_field_exception_reported DEFAULT (SYSDATETIME()),
      reviewed_by INT NULL,
      reviewed_at DATETIME2(0) NULL,
      review_notes NVARCHAR(1000) NULL,
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_replenish_field_exceptions PRIMARY KEY CLUSTERED (id),
      CONSTRAINT FK_replenish_field_exception_work_order
        FOREIGN KEY (work_order_id) REFERENCES dbo.replenish_work_orders(id)
        ON DELETE CASCADE,
      CONSTRAINT FK_replenish_field_exception_point
        FOREIGN KEY (work_order_point_id) REFERENCES dbo.replenish_work_order_points(id),
      CONSTRAINT FK_replenish_field_exception_source_event
        FOREIGN KEY (source_event_id) REFERENCES dbo.replenish_field_events(id),
      CONSTRAINT FK_replenish_field_exception_reporter
        FOREIGN KEY (reported_by) REFERENCES dbo.users(id),
      CONSTRAINT FK_replenish_field_exception_reviewer
        FOREIGN KEY (reviewed_by) REFERENCES dbo.users(id),
      CONSTRAINT CK_replenish_field_exception_status
        CHECK (status IN ('MENUNGGU_REVIEW', 'DISETUJUI', 'DITOLAK')),
      CONSTRAINT CK_replenish_field_exception_mismatch
        CHECK (mismatch_json IS NULL OR ISJSON(mismatch_json) = 1)
    );
  END;

  IF OBJECT_ID(N'dbo.replenish_field_exception_evidence', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.replenish_field_exception_evidence (
      id BIGINT IDENTITY(1,1) NOT NULL,
      exception_id BIGINT NOT NULL,
      stored_file_name VARCHAR(180) NOT NULL,
      original_file_name NVARCHAR(255) NULL,
      mime_type VARCHAR(50) NOT NULL,
      file_size INT NOT NULL,
      sha256 CHAR(64) NOT NULL,
      created_by INT NOT NULL,
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_replenish_field_evidence_created DEFAULT (SYSDATETIME()),
      CONSTRAINT PK_replenish_field_exception_evidence PRIMARY KEY CLUSTERED (id),
      CONSTRAINT UX_replenish_field_evidence_file UNIQUE (stored_file_name),
      CONSTRAINT FK_replenish_field_evidence_exception
        FOREIGN KEY (exception_id) REFERENCES dbo.replenish_field_exceptions(id)
        ON DELETE CASCADE,
      CONSTRAINT FK_replenish_field_evidence_creator
        FOREIGN KEY (created_by) REFERENCES dbo.users(id),
      CONSTRAINT CK_replenish_field_evidence_size CHECK (file_size BETWEEN 1 AND 3145728)
    );
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.replenish_field_events')
      AND name = N'IX_replenish_field_events_work_order'
  )
    CREATE INDEX IX_replenish_field_events_work_order
      ON dbo.replenish_field_events(work_order_id, id DESC)
      INCLUDE (work_order_point_id, action, actor_user_id, device_recorded_at, server_recorded_at);

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.replenish_field_exceptions')
      AND name = N'IX_replenish_field_exceptions_queue'
  )
    CREATE INDEX IX_replenish_field_exceptions_queue
      ON dbo.replenish_field_exceptions(status, reported_at, id)
      INCLUDE (work_order_id, work_order_point_id, exception_type, reported_by);

  DECLARE @fieldRouteId INT;
  DECLARE @nextSortOrder INT;
  SELECT @nextSortOrder = ISNULL(MAX(sort_order), 0) + 1 FROM dbo.sidebar_routes;

  MERGE dbo.sidebar_routes AS target
  USING (VALUES (
    'Replenish Lapangan', '/field_replenish', 'IconTransfer', NULL, @nextSortOrder
  )) AS source(label, href, icon, badge, sort_order)
    ON target.href = source.href
  WHEN MATCHED THEN
    UPDATE SET target.label = source.label, target.icon = source.icon,
      target.is_active = 1, target.updated_at = SYSDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (label, href, icon, badge, sort_order, is_active)
    VALUES (source.label, source.href, source.icon, source.badge, source.sort_order, 1);

  SELECT @fieldRouteId = id FROM dbo.sidebar_routes WHERE href = '/field_replenish';
  IF @fieldRouteId IS NULL
    THROW 54704, 'Menu Replenish Lapangan gagal dibentuk.', 1;

  ;WITH field_roles AS (
    SELECT DISTINCT role.id AS role_id
    FROM dbo.roles role
    WHERE role.is_active = 1
      AND (
        UPPER(REPLACE(REPLACE(LTRIM(RTRIM(role.role_code)), ' ', '_'), '-', '_')) IN (
          'SUPER_ADMIN', 'CUSTODY', 'DRIVER', 'PENGEMUDI',
          'MANAGER_OPERASIONAL', 'ASISTEN_MANAGER_CRO'
        )
        OR UPPER(LTRIM(RTRIM(role.role_name))) IN (
          'SUPER ADMIN', 'CUSTODY', 'DRIVER', 'PENGEMUDI',
          'MANAGER OPERASIONAL', 'ASISTEN MANAGER CRO'
        )
        OR EXISTS (
          SELECT 1
          FROM dbo.users app_user
          INNER JOIN dbo.pegawai employee ON employee.id = app_user.pegawai_id
          WHERE app_user.role_id = role.id
            AND app_user.is_active = 1
            AND employee.status = 1
            AND UPPER(LTRIM(RTRIM(ISNULL(employee.jabatan, '')))) IN (
              'CUSTODY', 'DRIVER', 'PENGEMUDI',
              'MANAGER OPERASIONAL', 'ASISTEN MANAGER CRO'
            )
        )
      )
  )
  MERGE dbo.role_sidebar_routes AS target
  USING field_roles AS source
    ON target.role_id = source.role_id
   AND target.sidebar_route_id = @fieldRouteId
  WHEN MATCHED THEN
    UPDATE SET target.can_view = 1, target.can_create = 0,
      target.can_update = 1, target.can_delete = 0, target.updated_at = SYSDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (role_id, sidebar_route_id, can_view, can_create, can_update, can_delete)
    VALUES (source.role_id, @fieldRouteId, 1, 0, 1, 0);

  COMMIT TRANSACTION;

  SELECT 'Migration 047 Replenish Lapangan PWA berhasil dijalankan.' AS message;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
