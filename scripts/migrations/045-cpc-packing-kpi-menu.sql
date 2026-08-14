SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.roles', N'U') IS NULL
    THROW 54501, 'Tabel dbo.roles belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.users', N'U') IS NULL
    THROW 54502, 'Tabel dbo.users belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.pegawai', N'U') IS NULL
    THROW 54503, 'Tabel dbo.pegawai belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.sidebar_routes', N'U') IS NULL
    THROW 54504, 'Tabel dbo.sidebar_routes belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.role_sidebar_routes', N'U') IS NULL
    THROW 54505, 'Tabel dbo.role_sidebar_routes belum tersedia.', 1;

  DECLARE @kpiRouteId INT;
  DECLARE @nextSortOrder INT;

  SELECT @nextSortOrder = ISNULL(MAX(sort_order), 0) + 1
  FROM dbo.sidebar_routes;

  MERGE dbo.sidebar_routes AS target
  USING (VALUES (
    'KPI Packing CPC',
    '/kpi_cpc',
    'IconReport',
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

  SELECT @kpiRouteId = id
  FROM dbo.sidebar_routes
  WHERE href = '/kpi_cpc';

  IF @kpiRouteId IS NULL
    THROW 54506, 'Menu KPI Packing CPC gagal dibentuk.', 1;

  ;WITH assistant_manager_cpc_roles AS (
    SELECT DISTINCT role.id AS role_id
    FROM dbo.roles role
    WHERE role.is_active = 1
      AND (
        UPPER(REPLACE(REPLACE(LTRIM(RTRIM(role.role_code)), ' ', '_'), '-', '_')) IN (
          'SUPER_ADMIN',
          'ASISTEN_MANAGER_CPC'
        )
        OR UPPER(LTRIM(RTRIM(role.role_name))) IN (
          'SUPER ADMIN',
          'ASISTEN MANAGER CPC'
        )
        OR EXISTS (
          SELECT 1
          FROM dbo.users app_user
          INNER JOIN dbo.pegawai employee ON employee.id = app_user.pegawai_id
          WHERE app_user.role_id = role.id
            AND app_user.is_active = 1
            AND employee.status = 1
            AND UPPER(LTRIM(RTRIM(ISNULL(employee.jabatan, '')))) = 'ASISTEN MANAGER CPC'
        )
      )
  )
  MERGE dbo.role_sidebar_routes AS target
  USING assistant_manager_cpc_roles AS source
    ON target.role_id = source.role_id
   AND target.sidebar_route_id = @kpiRouteId
  WHEN MATCHED THEN
    UPDATE SET
      target.can_view = 1,
      target.can_create = 0,
      target.can_update = 0,
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
      @kpiRouteId,
      1,
      0,
      0,
      0
    );

  COMMIT TRANSACTION;

  SELECT
    role.role_code,
    role.role_name,
    permission.can_view,
    permission.can_create,
    permission.can_update,
    permission.can_delete
  FROM dbo.role_sidebar_routes permission
  INNER JOIN dbo.roles role ON role.id = permission.role_id
  WHERE permission.sidebar_route_id = @kpiRouteId
  ORDER BY role.role_code;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
