SET NOCOUNT ON;
SET XACT_ABORT ON;

/*
  Replenish BRD alignment:
  1. Custody dan Pengemudi dipilih dari pegawai sesuai jabatan operasionalnya.
     Validasi detail dilakukan pada API agar tidak dapat dilewati melalui request manual.
  2. Manager Operasional dan Asisten Manager CRO bertindak sebagai checker
     pembentukan tim, termasuk ketika nama role aplikasi berbeda dari jabatan pegawai.

  Permission aplikasi masih disimpan per role. Karena itu role yang dipakai oleh
  pengguna aktif dengan jabatan Manager Operasional atau Asisten Manager CRO
  diberi akses lihat + ubah pada menu /transactions. Backend tetap melakukan
  pemeriksaan jabatan/role approver dan maker-checker sebelum APPROVE/REJECT.
*/
BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.roles', N'U') IS NULL
    THROW 50080, 'Tabel dbo.roles belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.users', N'U') IS NULL
    THROW 50081, 'Tabel dbo.users belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.pegawai', N'U') IS NULL
    THROW 50082, 'Tabel dbo.pegawai belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.sidebar_routes', N'U') IS NULL
    THROW 50083, 'Tabel dbo.sidebar_routes belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.role_sidebar_routes', N'U') IS NULL
    THROW 50084, 'Tabel dbo.role_sidebar_routes belum tersedia.', 1;

  DECLARE @transactionsRouteId INT;

  SELECT @transactionsRouteId = id
  FROM dbo.sidebar_routes
  WHERE href = '/transactions';

  IF @transactionsRouteId IS NULL
    THROW 50085, 'Menu /transactions belum tersedia.', 1;

  ;WITH candidate_roles AS (
    SELECT DISTINCT r.id AS role_id
    FROM dbo.roles r
    WHERE r.is_active = 1
      AND (
        UPPER(REPLACE(REPLACE(LTRIM(RTRIM(r.role_code)), ' ', '_'), '-', '_')) IN (
          'SUPER_ADMIN',
          'MANAGER',
          'MANAGER_CRO',
          'ASISTEN_MANAGER_CRO',
          'MANAGER_OPERASIONAL',
          'ASISTEN_MANAGER_OPERASIONAL'
        )
        OR UPPER(LTRIM(RTRIM(r.role_name))) IN (
          'SUPER ADMIN',
          'MANAGER',
          'MANAGER CRO',
          'ASISTEN MANAGER CRO',
          'MANAGER OPERASIONAL',
          'ASISTEN MANAGER OPERASIONAL'
        )
        OR EXISTS (
          SELECT 1
          FROM dbo.users u
          INNER JOIN dbo.pegawai p ON p.id = u.pegawai_id
          WHERE u.role_id = r.id
            AND u.is_active = 1
            AND p.status = 1
            AND UPPER(LTRIM(RTRIM(ISNULL(p.jabatan, '')))) IN (
              'MANAGER OPERASIONAL',
              'ASISTEN MANAGER CRO'
            )
        )
      )
  )
  MERGE dbo.role_sidebar_routes AS target
  USING candidate_roles AS source
    ON target.role_id = source.role_id
   AND target.sidebar_route_id = @transactionsRouteId
  WHEN MATCHED THEN
    UPDATE SET
      target.can_view = 1,
      target.can_update = 1,
      target.updated_at = SYSDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (
      role_id,
      sidebar_route_id,
      can_view,
      can_create,
      can_update,
      can_delete
    )
    VALUES (
      source.role_id,
      @transactionsRouteId,
      1,
      0,
      1,
      0
    );

  COMMIT TRANSACTION;

  SELECT
    r.role_code,
    r.role_name,
    rsr.can_view,
    rsr.can_create,
    rsr.can_update,
    rsr.can_delete
  FROM dbo.role_sidebar_routes rsr
  INNER JOIN dbo.roles r ON r.id = rsr.role_id
  WHERE rsr.sidebar_route_id = @transactionsRouteId
    AND rsr.can_update = 1
  ORDER BY r.role_code;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
