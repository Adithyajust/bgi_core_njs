SET NOCOUNT ON;
SET XACT_ABORT ON;

/*
  Role aplikasi Custody untuk operator Replenish Lapangan.

  Hak bawaan dibuat minimum:
  - lihat menu Replenish Lapangan;
  - melakukan update/sinkronisasi pekerjaan lapangan;
  - tidak dapat membuat atau menghapus data melalui menu tersebut.

  Permission lain yang mungkin sudah diberikan manual tidak dihapus.
*/
BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.roles', N'U') IS NULL
    THROW 54801, 'Tabel dbo.roles belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.sidebar_routes', N'U') IS NULL
    THROW 54802, 'Tabel dbo.sidebar_routes belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.role_sidebar_routes', N'U') IS NULL
    THROW 54803, 'Tabel dbo.role_sidebar_routes belum tersedia.', 1;

  DECLARE @custodyRoleId INT;
  DECLARE @fieldRouteId INT;

  SELECT @custodyRoleId = id
  FROM dbo.roles WITH (UPDLOCK, HOLDLOCK)
  WHERE UPPER(REPLACE(REPLACE(LTRIM(RTRIM(role_code)), ' ', '_'), '-', '_')) = 'CUSTODY';

  IF @custodyRoleId IS NULL
  BEGIN
    SELECT TOP (1) @custodyRoleId = id
    FROM dbo.roles WITH (UPDLOCK, HOLDLOCK)
    WHERE UPPER(LTRIM(RTRIM(role_name))) = 'CUSTODY'
    ORDER BY id ASC;

    IF @custodyRoleId IS NOT NULL
    BEGIN
      UPDATE dbo.roles
      SET role_code = 'CUSTODY',
          role_name = 'Custody',
          description = 'Petugas Custody untuk pelaksanaan Replenish Lapangan',
          is_active = 1,
          updated_at = SYSDATETIME()
      WHERE id = @custodyRoleId;
    END
    ELSE
    BEGIN
      INSERT INTO dbo.roles
        (role_code, role_name, description, is_active, created_at, updated_at)
      VALUES
        ('CUSTODY', 'Custody', 'Petugas Custody untuk pelaksanaan Replenish Lapangan', 1, SYSDATETIME(), SYSDATETIME());

      SET @custodyRoleId = CONVERT(INT, SCOPE_IDENTITY());
    END;
  END
  ELSE
  BEGIN
    UPDATE dbo.roles
    SET role_name = 'Custody',
        description = 'Petugas Custody untuk pelaksanaan Replenish Lapangan',
        is_active = 1,
        updated_at = SYSDATETIME()
    WHERE id = @custodyRoleId;
  END;

  SELECT @fieldRouteId = id
  FROM dbo.sidebar_routes WITH (UPDLOCK, HOLDLOCK)
  WHERE href = '/field_replenish'
    AND is_active = 1;

  IF @fieldRouteId IS NULL
    THROW 54804, 'Menu Replenish Lapangan belum tersedia. Jalankan migration 047 terlebih dahulu.', 1;

  MERGE dbo.role_sidebar_routes WITH (HOLDLOCK) AS target
  USING (SELECT @custodyRoleId AS role_id, @fieldRouteId AS sidebar_route_id) AS source
    ON target.role_id = source.role_id
   AND target.sidebar_route_id = source.sidebar_route_id
  WHEN MATCHED THEN
    UPDATE SET
      target.can_view = 1,
      target.can_create = 0,
      target.can_update = 1,
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
      source.sidebar_route_id,
      1,
      0,
      1,
      0
    );

  COMMIT TRANSACTION;

  SELECT
    role.role_code,
    role.role_name,
    route.href,
    permission.can_view,
    permission.can_create,
    permission.can_update,
    permission.can_delete
  FROM dbo.roles role
  INNER JOIN dbo.role_sidebar_routes permission ON permission.role_id = role.id
  INNER JOIN dbo.sidebar_routes route ON route.id = permission.sidebar_route_id
  WHERE role.id = @custodyRoleId
    AND route.id = @fieldRouteId;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
