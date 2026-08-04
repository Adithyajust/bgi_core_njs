SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.master_uker', N'U') IS NULL
    THROW 52601, 'Tabel dbo.master_uker belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.master_mesin', N'U') IS NULL
    THROW 52602, 'Tabel dbo.master_mesin belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.master_kendaraan', N'U') IS NULL
    THROW 52603, 'Tabel dbo.master_kendaraan belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.pegawai', N'U') IS NULL
    THROW 52604, 'Tabel dbo.pegawai belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.users', N'U') IS NULL
    THROW 52605, 'Tabel dbo.users belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.replenish_work_order_sequence', N'SO') IS NULL
  BEGIN
    CREATE SEQUENCE dbo.replenish_work_order_sequence
      AS BIGINT
      START WITH 1
      INCREMENT BY 1
      NO CYCLE;
  END;

  IF OBJECT_ID(N'dbo.replenish_work_orders', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.replenish_work_orders (
      id BIGINT IDENTITY(1,1) NOT NULL,
      work_order_no VARCHAR(30) NOT NULL,
      uker_id BIGINT NOT NULL,
      activity_type VARCHAR(20) NOT NULL,
      schedule_date DATE NOT NULL,
      departure_time TIME(0) NOT NULL,
      estimated_finish_time TIME(0) NOT NULL,
      priority VARCHAR(10) NOT NULL
        CONSTRAINT DF_replenish_wo_priority DEFAULT ('NORMAL'),
      vehicle_id BIGINT NOT NULL,
      status VARCHAR(40) NOT NULL
        CONSTRAINT DF_replenish_wo_status DEFAULT ('DRAFT'),
      total_points SMALLINT NOT NULL
        CONSTRAINT DF_replenish_wo_total_points DEFAULT (0),
      total_requested_amount DECIMAL(19,2) NOT NULL
        CONSTRAINT DF_replenish_wo_total_amount DEFAULT (0),
      route_notes NVARCHAR(1000) NULL,
      notes NVARCHAR(1000) NULL,
      rejection_reason NVARCHAR(1000) NULL,
      created_by INT NOT NULL,
      submitted_by INT NULL,
      submitted_at DATETIME2(0) NULL,
      approved_by INT NULL,
      approved_at DATETIME2(0) NULL,
      cancelled_by INT NULL,
      cancelled_at DATETIME2(0) NULL,
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_replenish_wo_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_replenish_wo_updated_at DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_replenish_work_orders PRIMARY KEY CLUSTERED (id),
      CONSTRAINT UX_replenish_work_orders_no UNIQUE (work_order_no),
      CONSTRAINT FK_replenish_wo_uker
        FOREIGN KEY (uker_id) REFERENCES dbo.master_uker(id),
      CONSTRAINT FK_replenish_wo_vehicle
        FOREIGN KEY (vehicle_id) REFERENCES dbo.master_kendaraan(id),
      CONSTRAINT FK_replenish_wo_created_by
        FOREIGN KEY (created_by) REFERENCES dbo.users(id),
      CONSTRAINT FK_replenish_wo_submitted_by
        FOREIGN KEY (submitted_by) REFERENCES dbo.users(id),
      CONSTRAINT FK_replenish_wo_approved_by
        FOREIGN KEY (approved_by) REFERENCES dbo.users(id),
      CONSTRAINT FK_replenish_wo_cancelled_by
        FOREIGN KEY (cancelled_by) REFERENCES dbo.users(id),
      CONSTRAINT CK_replenish_wo_activity_type
        CHECK (activity_type IN ('NORMAL', 'PENGOSONGAN', 'PERDANA')),
      CONSTRAINT CK_replenish_wo_priority
        CHECK (priority IN ('RENDAH', 'NORMAL', 'TINGGI', 'DARURAT')),
      CONSTRAINT CK_replenish_wo_total_points
        CHECK (total_points BETWEEN 0 AND 50),
      CONSTRAINT CK_replenish_wo_total_amount
        CHECK (total_requested_amount >= 0),
      CONSTRAINT CK_replenish_wo_status
        CHECK (status IN (
          'DRAFT', 'MENUNGGU_PERSETUJUAN_TIM', 'DITOLAK', 'DISETUJUI',
          'MENUNGGU_VALIDASI_KASET', 'KASET_DALAM_PERSIAPAN', 'KASET_SIAP',
          'MENUNGGU_PENYERAHAN_KUNCI', 'SIAP_BERANGKAT', 'BERANGKAT',
          'DALAM_PERJALANAN', 'TIBA_DI_LOKASI', 'MENUNGGU_KODE_KOMBINASI',
          'DALAM_PROSES_REPLENISH', 'SELESAI_DI_LOKASI', 'BERHASIL_SEBAGIAN',
          'GAGAL', 'DALAM_PERJALANAN_KEMBALI', 'TIBA_DI_KANTOR',
          'MENUNGGU_PENGEMBALIAN_KUNCI', 'MENUNGGU_PENERIMAAN_KASET',
          'DALAM_PENGHITUNGAN_CPC', 'DALAM_REKONSILIASI', 'TERDAPAT_SELISIH',
          'DALAM_INVESTIGASI', 'SELESAI', 'DITUTUP', 'DIBATALKAN'
        ))
    );
  END;

  IF OBJECT_ID(N'dbo.replenish_work_order_points', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.replenish_work_order_points (
      id BIGINT IDENTITY(1,1) NOT NULL,
      work_order_id BIGINT NOT NULL,
      machine_id BIGINT NOT NULL,
      sequence_no SMALLINT NOT NULL,
      requested_amount DECIMAL(19,2) NULL,
      status VARCHAR(40) NOT NULL
        CONSTRAINT DF_replenish_point_status DEFAULT ('TERJADWAL'),
      notes NVARCHAR(500) NULL,
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_replenish_point_created_at DEFAULT (SYSDATETIME()),
      updated_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_replenish_point_updated_at DEFAULT (SYSDATETIME()),
      row_version ROWVERSION NOT NULL,
      CONSTRAINT PK_replenish_work_order_points PRIMARY KEY CLUSTERED (id),
      CONSTRAINT FK_replenish_point_work_order
        FOREIGN KEY (work_order_id) REFERENCES dbo.replenish_work_orders(id)
        ON DELETE CASCADE,
      CONSTRAINT FK_replenish_point_machine
        FOREIGN KEY (machine_id) REFERENCES dbo.master_mesin(id),
      CONSTRAINT UX_replenish_point_machine UNIQUE (work_order_id, machine_id),
      CONSTRAINT UX_replenish_point_sequence UNIQUE (work_order_id, sequence_no),
      CONSTRAINT CK_replenish_point_sequence CHECK (sequence_no BETWEEN 1 AND 50),
      CONSTRAINT CK_replenish_point_amount CHECK (requested_amount IS NULL OR requested_amount >= 0),
      CONSTRAINT CK_replenish_point_status CHECK (status IN (
        'TERJADWAL', 'DALAM_PERJALANAN', 'TIBA', 'DALAM_PROSES',
        'BERHASIL', 'BERHASIL_DENGAN_CATATAN', 'GAGAL', 'DITUNDA', 'DIBATALKAN'
      ))
    );
  END;

  IF OBJECT_ID(N'dbo.replenish_team_members', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.replenish_team_members (
      id BIGINT IDENTITY(1,1) NOT NULL,
      work_order_id BIGINT NOT NULL,
      employee_id INT NOT NULL,
      member_role VARCHAR(20) NOT NULL,
      is_lead BIT NOT NULL CONSTRAINT DF_replenish_team_is_lead DEFAULT (0),
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_replenish_team_created_at DEFAULT (SYSDATETIME()),
      CONSTRAINT PK_replenish_team_members PRIMARY KEY CLUSTERED (id),
      CONSTRAINT FK_replenish_team_work_order
        FOREIGN KEY (work_order_id) REFERENCES dbo.replenish_work_orders(id)
        ON DELETE CASCADE,
      CONSTRAINT FK_replenish_team_employee
        FOREIGN KEY (employee_id) REFERENCES dbo.pegawai(id),
      CONSTRAINT UX_replenish_team_employee UNIQUE (work_order_id, employee_id),
      CONSTRAINT UX_replenish_team_role UNIQUE (work_order_id, member_role),
      CONSTRAINT CK_replenish_team_role
        CHECK (member_role IN ('CUSTODY', 'PENGEMUDI', 'PENGAWALAN'))
    );
  END;

  IF OBJECT_ID(N'dbo.replenish_status_history', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.replenish_status_history (
      id BIGINT IDENTITY(1,1) NOT NULL,
      work_order_id BIGINT NOT NULL,
      from_status VARCHAR(40) NULL,
      to_status VARCHAR(40) NOT NULL,
      action VARCHAR(30) NOT NULL,
      notes NVARCHAR(1000) NULL,
      actor_user_id INT NOT NULL,
      created_at DATETIME2(0) NOT NULL
        CONSTRAINT DF_replenish_history_created_at DEFAULT (SYSDATETIME()),
      CONSTRAINT PK_replenish_status_history PRIMARY KEY CLUSTERED (id),
      CONSTRAINT FK_replenish_history_work_order
        FOREIGN KEY (work_order_id) REFERENCES dbo.replenish_work_orders(id)
        ON DELETE CASCADE,
      CONSTRAINT FK_replenish_history_actor
        FOREIGN KEY (actor_user_id) REFERENCES dbo.users(id)
    );
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.replenish_work_orders')
      AND name = N'IX_replenish_wo_scope_schedule'
  )
    CREATE INDEX IX_replenish_wo_scope_schedule
      ON dbo.replenish_work_orders(uker_id, schedule_date DESC, id DESC)
      INCLUDE (work_order_no, activity_type, priority, vehicle_id, status,
               total_points, total_requested_amount, created_by, updated_at);

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.replenish_work_orders')
      AND name = N'IX_replenish_wo_status_schedule'
  )
    CREATE INDEX IX_replenish_wo_status_schedule
      ON dbo.replenish_work_orders(status, schedule_date DESC, id DESC)
      INCLUDE (uker_id, work_order_no, activity_type, priority, vehicle_id,
               total_points, total_requested_amount, created_by, updated_at);

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.replenish_work_order_points')
      AND name = N'IX_replenish_points_work_order'
  )
    CREATE INDEX IX_replenish_points_work_order
      ON dbo.replenish_work_order_points(work_order_id, sequence_no)
      INCLUDE (machine_id, requested_amount, status, notes);

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.replenish_team_members')
      AND name = N'IX_replenish_team_employee'
  )
    CREATE INDEX IX_replenish_team_employee
      ON dbo.replenish_team_members(employee_id, work_order_id)
      INCLUDE (member_role, is_lead);

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.replenish_status_history')
      AND name = N'IX_replenish_history_work_order'
  )
    CREATE INDEX IX_replenish_history_work_order
      ON dbo.replenish_status_history(work_order_id, id DESC)
      INCLUDE (from_status, to_status, action, notes, actor_user_id, created_at);

  IF OBJECT_ID(N'dbo.sidebar_routes', N'U') IS NOT NULL
  BEGIN
    MERGE dbo.sidebar_routes AS target
    USING (VALUES ('Transaksi', '/transactions', 'IconTransfer', NULL, 5))
      AS source(label, href, icon, badge, sort_order)
    ON target.href = source.href
    WHEN MATCHED THEN
      UPDATE SET
        label = source.label,
        icon = source.icon,
        badge = source.badge,
        sort_order = source.sort_order,
        is_active = 1,
        updated_at = SYSDATETIME()
    WHEN NOT MATCHED THEN
      INSERT (label, href, icon, badge, sort_order, is_active)
      VALUES (source.label, source.href, source.icon, source.badge, source.sort_order, 1);
  END;

  IF OBJECT_ID(N'dbo.role_sidebar_routes', N'U') IS NOT NULL
  BEGIN
    INSERT INTO dbo.role_sidebar_routes
      (role_id, sidebar_route_id, can_view, can_create, can_update, can_delete)
    SELECT
      r.id,
      sr.id,
      role_defaults.can_view,
      role_defaults.can_create,
      role_defaults.can_update,
      role_defaults.can_delete
    FROM (VALUES
      ('MANAGER', CAST(1 AS BIT), CAST(0 AS BIT), CAST(1 AS BIT), CAST(0 AS BIT)),
      ('OPERATOR', CAST(1 AS BIT), CAST(1 AS BIT), CAST(1 AS BIT), CAST(0 AS BIT))
    ) role_defaults(role_code, can_view, can_create, can_update, can_delete)
    INNER JOIN dbo.roles r ON r.role_code = role_defaults.role_code
    INNER JOIN dbo.sidebar_routes sr ON sr.href = '/transactions'
    WHERE NOT EXISTS (
      SELECT 1
      FROM dbo.role_sidebar_routes existing
      WHERE existing.role_id = r.id
        AND existing.sidebar_route_id = sr.id
    );
  END;

  COMMIT TRANSACTION;

  SELECT 'Migration 026 Replenish Work Order Core berhasil dijalankan.' AS message;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
