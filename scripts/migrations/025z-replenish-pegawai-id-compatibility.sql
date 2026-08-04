SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.master_uker', N'U') IS NULL
    THROW 52551, 'Tabel dbo.master_uker belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.master_kendaraan', N'U') IS NULL
    THROW 52552, 'Tabel dbo.master_kendaraan belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.pegawai', N'U') IS NULL
    THROW 52553, 'Tabel dbo.pegawai belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.users', N'U') IS NULL
    THROW 52554, 'Tabel dbo.users belum tersedia.', 1;

  DECLARE @pegawaiIdType NVARCHAR(128);
  DECLARE @pegawaiSystemTypeId INT;
  DECLARE @pegawaiMaxLength SMALLINT;
  DECLARE @pegawaiPrecision TINYINT;
  DECLARE @pegawaiScale TINYINT;

  SELECT
    @pegawaiSystemTypeId = c.system_type_id,
    @pegawaiMaxLength = c.max_length,
    @pegawaiPrecision = c.precision,
    @pegawaiScale = c.scale,
    @pegawaiIdType = CASE TYPE_NAME(c.system_type_id)
      WHEN N'tinyint' THEN N'TINYINT'
      WHEN N'smallint' THEN N'SMALLINT'
      WHEN N'int' THEN N'INT'
      WHEN N'bigint' THEN N'BIGINT'
      WHEN N'decimal' THEN N'DECIMAL(' + CONVERT(NVARCHAR(10), c.precision) + N',' + CONVERT(NVARCHAR(10), c.scale) + N')'
      WHEN N'numeric' THEN N'NUMERIC(' + CONVERT(NVARCHAR(10), c.precision) + N',' + CONVERT(NVARCHAR(10), c.scale) + N')'
      ELSE NULL
    END
  FROM sys.columns c
  WHERE c.object_id = OBJECT_ID(N'dbo.pegawai')
    AND c.name = N'id';

  IF @pegawaiIdType IS NULL
  BEGIN
    DECLARE @unsupportedTypeMessage NVARCHAR(2048) =
      N'Tipe dbo.pegawai.id tidak didukung untuk transaksi Replenish. Gunakan tipe integer atau numeric tanpa pecahan.';
    THROW 52555, @unsupportedTypeMessage, 1;
  END;

  IF @pegawaiScale <> 0
    THROW 52556, 'dbo.pegawai.id harus berupa angka bulat agar dapat digunakan sebagai foreign key Replenish.', 1;

  IF OBJECT_ID(N'dbo.replenish_work_order_sequence', N'SO') IS NULL
  BEGIN
    CREATE SEQUENCE dbo.replenish_work_order_sequence
      AS BIGINT
      START WITH 1
      INCREMENT BY 1
      NO CYCLE;
  END;

  /*
    Migration 026 versi awal membuat replenish_work_orders sebelum mencapai
    replenish_team_members. Tabel induk dibuat lebih awal di sini agar tabel
    tim dapat dibuat dengan tipe employee_id yang mengikuti dbo.pegawai.id.
    Migration 026 tetap idempotent dan akan melewati tabel yang sudah tersedia.
  */
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

  IF OBJECT_ID(N'dbo.replenish_team_members', N'U') IS NULL
  BEGIN
    DECLARE @createTeamSql NVARCHAR(MAX) = N'
      CREATE TABLE dbo.replenish_team_members (
        id BIGINT IDENTITY(1,1) NOT NULL,
        work_order_id BIGINT NOT NULL,
        employee_id ' + @pegawaiIdType + N' NOT NULL,
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
          CHECK (member_role IN (''CUSTODY'', ''PENGEMUDI'', ''PENGAWALAN''))
      );';

    EXEC sys.sp_executesql @createTeamSql;
  END;
  ELSE
  BEGIN
    DECLARE @teamSystemTypeId INT;
    DECLARE @teamMaxLength SMALLINT;
    DECLARE @teamPrecision TINYINT;
    DECLARE @teamScale TINYINT;

    SELECT
      @teamSystemTypeId = c.system_type_id,
      @teamMaxLength = c.max_length,
      @teamPrecision = c.precision,
      @teamScale = c.scale
    FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.replenish_team_members')
      AND c.name = N'employee_id';

    IF @teamSystemTypeId IS NULL
      THROW 52557, 'Kolom dbo.replenish_team_members.employee_id tidak ditemukan.', 1;

    IF @teamSystemTypeId <> @pegawaiSystemTypeId
      OR @teamMaxLength <> @pegawaiMaxLength
      OR @teamPrecision <> @pegawaiPrecision
      OR @teamScale <> @pegawaiScale
    BEGIN
      IF EXISTS (
        SELECT 1 FROM sys.foreign_keys
        WHERE parent_object_id = OBJECT_ID(N'dbo.replenish_team_members')
          AND name = N'FK_replenish_team_employee'
      )
        ALTER TABLE dbo.replenish_team_members DROP CONSTRAINT FK_replenish_team_employee;

      IF EXISTS (
        SELECT 1 FROM sys.key_constraints
        WHERE parent_object_id = OBJECT_ID(N'dbo.replenish_team_members')
          AND name = N'UX_replenish_team_employee'
      )
        ALTER TABLE dbo.replenish_team_members DROP CONSTRAINT UX_replenish_team_employee;

      IF EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.replenish_team_members')
          AND name = N'IX_replenish_team_employee'
      )
        DROP INDEX IX_replenish_team_employee ON dbo.replenish_team_members;

      DECLARE @alterTeamSql NVARCHAR(MAX) =
        N'ALTER TABLE dbo.replenish_team_members ALTER COLUMN employee_id '
        + @pegawaiIdType + N' NOT NULL;';
      EXEC sys.sp_executesql @alterTeamSql;
    END;

    IF EXISTS (
      SELECT 1
      FROM dbo.replenish_team_members tm
      LEFT JOIN dbo.pegawai p ON p.id = tm.employee_id
      WHERE p.id IS NULL
    )
      THROW 52558, 'Terdapat replenish_team_members.employee_id yang tidak memiliki pasangan pada dbo.pegawai.', 1;

    IF NOT EXISTS (
      SELECT 1 FROM sys.foreign_keys
      WHERE parent_object_id = OBJECT_ID(N'dbo.replenish_team_members')
        AND name = N'FK_replenish_team_employee'
    )
      ALTER TABLE dbo.replenish_team_members WITH CHECK
        ADD CONSTRAINT FK_replenish_team_employee
        FOREIGN KEY (employee_id) REFERENCES dbo.pegawai(id);

    IF NOT EXISTS (
      SELECT 1 FROM sys.key_constraints
      WHERE parent_object_id = OBJECT_ID(N'dbo.replenish_team_members')
        AND name = N'UX_replenish_team_employee'
    )
      ALTER TABLE dbo.replenish_team_members
        ADD CONSTRAINT UX_replenish_team_employee UNIQUE (work_order_id, employee_id);
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0
    ROLLBACK TRANSACTION;
  THROW;
END CATCH;
