SET NOCOUNT ON;
SET XACT_ABORT ON;

/*
  Menyelaraskan permission transaksi Replenish pada database lama.

  Pada database legacy, role_sidebar_routes dapat lebih dahulu dibuat oleh
  migration menu lama dengan can_view = 1 tetapi can_create/can_update = 0.
  Migration 026 sebelumnya hanya INSERT ketika relasi role-menu belum ada,
  sehingga permission lama tidak pernah diperbarui.

  Kebijakan default:
  - SUPER_ADMIN: akses penuh.
  - OPERATOR / Admin CRO: lihat, buat, dan ubah.
  - MANAGER / Manager CRO: lihat dan ubah untuk proses review/approval.

  Role lain tidak diubah agar hak Auditor, CPC, Custody, Pengemudi, dan role
  khusus lainnya tetap mengikuti konfigurasi administrator aplikasi.
*/
BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.roles', N'U') IS NULL
    THROW 50070, 'Tabel dbo.roles belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.sidebar_routes', N'U') IS NULL
    THROW 50071, 'Tabel dbo.sidebar_routes belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.role_sidebar_routes', N'U') IS NULL
    THROW 50072, 'Tabel dbo.role_sidebar_routes belum tersedia.', 1;

  DECLARE @transactionsRouteId INT;

  SELECT @transactionsRouteId = id
  FROM dbo.sidebar_routes
  WHERE href = '/transactions';

  IF @transactionsRouteId IS NULL
    THROW 50073, 'Menu /transactions belum tersedia.', 1;

  ;WITH role_defaults AS (
    SELECT
      r.id AS role_id,
      CAST(1 AS BIT) AS can_view,
      CAST(
        CASE
          WHEN r.role_code = 'SUPER_ADMIN' THEN 1
          WHEN r.role_code = 'OPERATOR' THEN 1
          WHEN UPPER(REPLACE(REPLACE(LTRIM(RTRIM(r.role_code)), ' ', '_'), '-', '_')) = 'ADMIN_CRO' THEN 1
          WHEN UPPER(LTRIM(RTRIM(r.role_name))) = 'ADMIN CRO' THEN 1
          ELSE 0
        END
        AS BIT
      ) AS can_create,
      CAST(
        CASE
          WHEN r.role_code IN ('SUPER_ADMIN', 'OPERATOR', 'MANAGER') THEN 1
          WHEN UPPER(REPLACE(REPLACE(LTRIM(RTRIM(r.role_code)), ' ', '_'), '-', '_')) IN (
            'ADMIN_CRO',
            'MANAGER_CRO',
            'ASISTEN_MANAGER_CRO'
          ) THEN 1
          WHEN UPPER(LTRIM(RTRIM(r.role_name))) IN (
            'ADMIN CRO',
            'MANAGER CRO',
            'ASISTEN MANAGER CRO'
          ) THEN 1
          ELSE 0
        END
        AS BIT
      ) AS can_update,
      CAST(CASE WHEN r.role_code = 'SUPER_ADMIN' THEN 1 ELSE 0 END AS BIT) AS can_delete
    FROM dbo.roles r
    WHERE r.is_active = 1
      AND (
        r.role_code IN ('SUPER_ADMIN', 'OPERATOR', 'MANAGER')
        OR UPPER(REPLACE(REPLACE(LTRIM(RTRIM(r.role_code)), ' ', '_'), '-', '_')) IN (
          'ADMIN_CRO',
          'MANAGER_CRO',
          'ASISTEN_MANAGER_CRO'
        )
        OR UPPER(LTRIM(RTRIM(r.role_name))) IN (
          'ADMIN CRO',
          'MANAGER CRO',
          'ASISTEN MANAGER CRO'
        )
      )
  )
  MERGE dbo.role_sidebar_routes AS target
  USING role_defaults AS source
    ON target.role_id = source.role_id
   AND target.sidebar_route_id = @transactionsRouteId
  WHEN MATCHED THEN
    UPDATE SET
      target.can_view = CASE WHEN target.can_view = 1 THEN 1 ELSE source.can_view END,
      target.can_create = CASE WHEN target.can_create = 1 THEN 1 ELSE source.can_create END,
      target.can_update = CASE WHEN target.can_update = 1 THEN 1 ELSE source.can_update END,
      target.can_delete = CASE WHEN target.can_delete = 1 THEN 1 ELSE source.can_delete END,
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
      source.can_view,
      source.can_create,
      source.can_update,
      source.can_delete
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
  ORDER BY r.role_code;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
