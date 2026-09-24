SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.roles', N'U') IS NULL
    THROW 55401, 'Tabel dbo.roles belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.sidebar_routes', N'U') IS NULL
    THROW 55402, 'Tabel dbo.sidebar_routes belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.role_sidebar_routes', N'U') IS NULL
    THROW 55403, 'Tabel dbo.role_sidebar_routes belum tersedia.', 1;

  DECLARE @routeId INT;
  DECLARE @nextSortOrder INT;

  SELECT @nextSortOrder = ISNULL(MAX(sort_order), 0) + 1
  FROM dbo.sidebar_routes;

  MERGE dbo.sidebar_routes WITH (HOLDLOCK) AS target
  USING (VALUES (
    'RPL Terjadwal',
    '/rpl_terjadwal',
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

  SELECT @routeId = id
  FROM dbo.sidebar_routes
  WHERE href = '/rpl_terjadwal';

  IF @routeId IS NULL
    THROW 55404, 'Menu RPL Terjadwal gagal dibentuk.', 1;

  -- Pastikan permission menu ini eksklusif untuk Super Admin.
  DELETE permission
  FROM dbo.role_sidebar_routes permission
  INNER JOIN dbo.roles role ON role.id = permission.role_id
  WHERE permission.sidebar_route_id = @routeId
    AND UPPER(REPLACE(REPLACE(LTRIM(RTRIM(role.role_code)), ' ', '_'), '-', '_')) <> 'SUPER_ADMIN';

  ;WITH superadmin_roles AS (
    SELECT id AS role_id
    FROM dbo.roles
    WHERE is_active = 1
      AND UPPER(REPLACE(REPLACE(LTRIM(RTRIM(role_code)), ' ', '_'), '-', '_')) = 'SUPER_ADMIN'
  )
  MERGE dbo.role_sidebar_routes WITH (HOLDLOCK) AS target
  USING superadmin_roles AS source
    ON target.role_id = source.role_id
   AND target.sidebar_route_id = @routeId
  WHEN MATCHED THEN
    UPDATE SET
      target.can_view = 1,
      target.can_create = 1,
      target.can_update = 1,
      target.can_delete = 1,
      target.updated_at = SYSDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (
      role_id, sidebar_route_id, can_view, can_create, can_update, can_delete
    )
    VALUES (
      source.role_id, @routeId, 1, 1, 1, 1
    );

  IF NOT EXISTS (
    SELECT 1
    FROM dbo.role_sidebar_routes permission
    INNER JOIN dbo.roles role ON role.id = permission.role_id
    WHERE permission.sidebar_route_id = @routeId
      AND UPPER(REPLACE(REPLACE(LTRIM(RTRIM(role.role_code)), ' ', '_'), '-', '_')) = 'SUPER_ADMIN'
      AND permission.can_view = 1
  )
    THROW 55405, 'Role SUPER_ADMIN aktif tidak ditemukan atau permission gagal dibuat.', 1;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
