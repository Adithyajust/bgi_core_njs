SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.cpc_spare_cassettes', N'U') IS NULL
    THROW 55001, 'Tabel dbo.cpc_spare_cassettes belum tersedia. Jalankan migration 049 terlebih dahulu.', 1;

  IF OBJECT_ID(N'dbo.roles', N'U') IS NULL
    THROW 55002, 'Tabel dbo.roles belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.sidebar_routes', N'U') IS NULL
    THROW 55003, 'Tabel dbo.sidebar_routes belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.role_sidebar_routes', N'U') IS NULL
    THROW 55004, 'Tabel dbo.role_sidebar_routes belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.users', N'U') IS NULL
    THROW 55005, 'Tabel dbo.users belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.pegawai', N'U') IS NULL
    THROW 55006, 'Tabel dbo.pegawai belum tersedia.', 1;

  DECLARE @spareRouteId INT;
  DECLARE @nextSortOrder INT;

  SELECT @nextSortOrder = ISNULL(MAX(sort_order), 0) + 1
  FROM dbo.sidebar_routes;

  MERGE dbo.sidebar_routes AS target
  USING (VALUES (
    'Spare Kaset',
    '/spare_kaset',
    'IconTransfer',
    NULL,
    @nextSortOrder
  )) AS source(label, href, icon, badge, sort_order)
    ON target.href = source.href
  WHEN MATCHED THEN
    UPDATE SET
      target.label = source.label,
      target.icon = source.icon,
      target.badge = source.badge,
      target.is_active = 1,
      target.updated_at = SYSDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (label, href, icon, badge, sort_order, is_active)
    VALUES (source.label, source.href, source.icon, source.badge, source.sort_order, 1);

  SELECT @spareRouteId = id
  FROM dbo.sidebar_routes
  WHERE href = '/spare_kaset';

  IF @spareRouteId IS NULL
    THROW 55007, 'Menu Spare Kaset gagal dibentuk.', 1;

  ;WITH cpc_permission AS (
    SELECT
      permission.role_id,
      permission.can_view,
      permission.can_update
    FROM dbo.role_sidebar_routes permission
    INNER JOIN dbo.sidebar_routes route ON route.id = permission.sidebar_route_id
    WHERE route.href = '/transaksi_cpc'
  ),
  candidate_roles AS (
    SELECT
      role.id AS role_id,
      CAST(1 AS BIT) AS can_view,
      CAST(CASE
        WHEN UPPER(REPLACE(REPLACE(LTRIM(RTRIM(role.role_code)), ' ', '_'), '-', '_')) = 'SUPER_ADMIN' THEN 1
        WHEN UPPER(REPLACE(REPLACE(LTRIM(RTRIM(role.role_code)), ' ', '_'), '-', '_')) LIKE '%CPC%' THEN 1
        WHEN UPPER(LTRIM(RTRIM(role.role_name))) LIKE '%CPC%' THEN 1
        WHEN EXISTS (
          SELECT 1
          FROM dbo.users app_user
          INNER JOIN dbo.pegawai employee ON employee.id = app_user.pegawai_id
          WHERE app_user.role_id = role.id
            AND app_user.is_active = 1
            AND employee.status = 1
            AND UPPER(LTRIM(RTRIM(ISNULL(employee.jabatan, '')))) LIKE '%CPC%'
        ) THEN 1
        ELSE ISNULL(existing.can_update, 0)
      END AS BIT) AS can_update
    FROM dbo.roles role
    LEFT JOIN cpc_permission existing ON existing.role_id = role.id
    WHERE role.is_active = 1
      AND (
        ISNULL(existing.can_view, 0) = 1
        OR UPPER(REPLACE(REPLACE(LTRIM(RTRIM(role.role_code)), ' ', '_'), '-', '_')) = 'SUPER_ADMIN'
        OR UPPER(REPLACE(REPLACE(LTRIM(RTRIM(role.role_code)), ' ', '_'), '-', '_')) LIKE '%CPC%'
        OR UPPER(LTRIM(RTRIM(role.role_name))) LIKE '%CPC%'
        OR EXISTS (
          SELECT 1
          FROM dbo.users app_user
          INNER JOIN dbo.pegawai employee ON employee.id = app_user.pegawai_id
          WHERE app_user.role_id = role.id
            AND app_user.is_active = 1
            AND employee.status = 1
            AND UPPER(LTRIM(RTRIM(ISNULL(employee.jabatan, '')))) LIKE '%CPC%'
        )
      )
  )
  MERGE dbo.role_sidebar_routes AS target
  USING candidate_roles AS source
    ON target.role_id = source.role_id
   AND target.sidebar_route_id = @spareRouteId
  WHEN MATCHED THEN
    UPDATE SET
      target.can_view = source.can_view,
      target.can_create = 0,
      target.can_update = source.can_update,
      target.can_delete = 0,
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
      @spareRouteId,
      source.can_view,
      0,
      source.can_update,
      0
    );

  COMMIT TRANSACTION;

  SELECT
    route.label,
    route.href,
    role.role_code,
    role.role_name,
    permission.can_view,
    permission.can_update
  FROM dbo.role_sidebar_routes permission
  INNER JOIN dbo.sidebar_routes route ON route.id = permission.sidebar_route_id
  INNER JOIN dbo.roles role ON role.id = permission.role_id
  WHERE permission.sidebar_route_id = @spareRouteId
  ORDER BY role.role_code;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
