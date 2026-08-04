SET NOCOUNT ON;
SET XACT_ABORT ON;

/* Memindahkan hak lihat dari tabel menus/role_menus versi lama. */
BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.menus', N'U') IS NOT NULL
     AND OBJECT_ID(N'dbo.role_menus', N'U') IS NOT NULL
     AND OBJECT_ID(N'dbo.sidebar_routes', N'U') IS NOT NULL
     AND OBJECT_ID(N'dbo.role_sidebar_routes', N'U') IS NOT NULL
  BEGIN
    INSERT INTO dbo.role_sidebar_routes
    (
      role_id,
      sidebar_route_id,
      can_view,
      can_create,
      can_update,
      can_delete
    )
    SELECT DISTINCT
      rm.role_id,
      sr.id,
      1,
      0,
      0,
      0
    FROM dbo.role_menus rm
    INNER JOIN dbo.menus m ON m.id = rm.menu_id
    INNER JOIN dbo.sidebar_routes sr
      ON sr.href = CASE WHEN m.url = '/approval' THEN '/approvals' ELSE m.url END
    WHERE NOT EXISTS (
      SELECT 1
      FROM dbo.role_sidebar_routes rsr
      WHERE rsr.role_id = rm.role_id
        AND rsr.sidebar_route_id = sr.id
    );

    UPDATE rsr
    SET
      can_view = 1,
      updated_at = SYSDATETIME()
    FROM dbo.role_sidebar_routes rsr
    INNER JOIN dbo.role_menus rm ON rm.role_id = rsr.role_id
    INNER JOIN dbo.menus m ON m.id = rm.menu_id
    INNER JOIN dbo.sidebar_routes sr
      ON sr.id = rsr.sidebar_route_id
     AND sr.href = CASE WHEN m.url = '/approval' THEN '/approvals' ELSE m.url END;
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
