SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.replenish_work_orders', N'U') IS NULL
    THROW 53201, 'Tabel dbo.replenish_work_orders belum tersedia.', 1;

  IF OBJECT_ID(N'dbo.replenish_work_order_points', N'U') IS NULL
    THROW 53202, 'Tabel dbo.replenish_work_order_points belum tersedia.', 1;

  /*
    SQL Server mengompilasi satu migration file sebagai satu batch. Semua
    statement yang memakai kolom baru harus dieksekusi sebagai dynamic SQL
    agar kompilasinya terjadi setelah ALTER TABLE ADD selesai.
  */
  IF COL_LENGTH(N'dbo.replenish_work_order_points', N'activity_type') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.replenish_work_order_points
        ADD activity_type VARCHAR(20) NULL;
    ';
  END;

  IF COL_LENGTH(N'dbo.replenish_work_order_points', N'pagu') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.replenish_work_order_points
        ADD pagu INT NULL;
    ';
  END;

  IF COL_LENGTH(N'dbo.replenish_work_order_points', N'denomination_value') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.replenish_work_order_points
        ADD denomination_value BIGINT NULL;
    ';
  END;

  EXEC sys.sp_executesql N'
    UPDATE point
    SET activity_type = CASE
      WHEN wo.activity_type IN (''NORMAL'', ''PENGOSONGAN'', ''PERDANA'')
        THEN wo.activity_type
      ELSE ''NORMAL''
    END
    FROM dbo.replenish_work_order_points point
    INNER JOIN dbo.replenish_work_orders wo ON wo.id = point.work_order_id
    WHERE point.activity_type IS NULL;

    IF EXISTS (
      SELECT 1
      FROM dbo.replenish_work_order_points
      WHERE activity_type NOT IN (''NORMAL'', ''PENGOSONGAN'', ''PERDANA'')
    )
      THROW 53203, ''Terdapat activity_type point yang tidak valid.'', 1;

    ALTER TABLE dbo.replenish_work_order_points
      ALTER COLUMN activity_type VARCHAR(20) NOT NULL;
  ';


  /* Hapus seluruh check constraint header yang masih membatasi aktivitas lama. */
  DECLARE @woActivityConstraint SYSNAME;
  DECLARE @dropWoActivityConstraintSql NVARCHAR(MAX);

  WHILE 1 = 1
  BEGIN
    SET @woActivityConstraint = NULL;

    SELECT TOP (1) @woActivityConstraint = check_constraint.name
    FROM sys.check_constraints check_constraint
    WHERE check_constraint.parent_object_id = OBJECT_ID(N'dbo.replenish_work_orders')
      AND (
        LOWER(
          REPLACE(
            REPLACE(check_constraint.definition, N'[', N''),
            N']', N''
          )
        ) LIKE N'%activity_type%'
        OR check_constraint.name = N'CK_replenish_wo_activity_type'
      );

    IF @woActivityConstraint IS NULL BREAK;

    SET @dropWoActivityConstraintSql =
      N'ALTER TABLE dbo.replenish_work_orders DROP CONSTRAINT '
      + QUOTENAME(@woActivityConstraint)
      + N';';

    EXEC sys.sp_executesql @dropWoActivityConstraintSql;
  END;

  EXEC sys.sp_executesql N'
    IF EXISTS (
      SELECT 1
      FROM dbo.replenish_work_orders
      WHERE activity_type NOT IN (''NORMAL'', ''PENGOSONGAN'', ''PERDANA'', ''CAMPURAN'')
    )
      THROW 53205, ''Terdapat activity_type work order yang tidak valid.'', 1;

    ALTER TABLE dbo.replenish_work_orders WITH CHECK
      ADD CONSTRAINT CK_replenish_wo_activity_type
        CHECK (activity_type IN (''NORMAL'', ''PENGOSONGAN'', ''PERDANA'', ''CAMPURAN''));

    ALTER TABLE dbo.replenish_work_orders
      CHECK CONSTRAINT CK_replenish_wo_activity_type;
  ';

  /*
    Bila migration pernah dicoba secara manual, definisi constraint bernama
    sama dibangun ulang agar tidak meninggalkan formula lama atau untrusted.
  */
  DECLARE @pointConstraint SYSNAME;
  DECLARE @dropPointConstraintSql NVARCHAR(MAX);

  WHILE 1 = 1
  BEGIN
    SET @pointConstraint = NULL;

    SELECT TOP (1) @pointConstraint = check_constraint.name
    FROM sys.check_constraints check_constraint
    WHERE check_constraint.parent_object_id = OBJECT_ID(N'dbo.replenish_work_order_points')
      AND check_constraint.name IN (
        N'CK_replenish_point_activity_type',
        N'CK_replenish_point_pagu',
        N'CK_replenish_point_denomination',
        N'CK_replenish_point_amount_formula'
      );

    IF @pointConstraint IS NULL BREAK;

    SET @dropPointConstraintSql =
      N'ALTER TABLE dbo.replenish_work_order_points DROP CONSTRAINT '
      + QUOTENAME(@pointConstraint)
      + N';';

    EXEC sys.sp_executesql @dropPointConstraintSql;
  END;

  EXEC sys.sp_executesql N'
    IF EXISTS (
      SELECT 1
      FROM dbo.replenish_work_order_points
      WHERE pagu IS NOT NULL
        AND pagu NOT IN (2000, 4000, 6000, 8000)
    )
      THROW 53206, ''Terdapat nilai pagu point yang tidak valid.'', 1;

    IF EXISTS (
      SELECT 1
      FROM dbo.replenish_work_order_points
      WHERE denomination_value IS NOT NULL
        AND denomination_value <= 0
    )
      THROW 53207, ''Terdapat denomination_value point yang tidak valid.'', 1;

    IF EXISTS (
      SELECT 1
      FROM dbo.replenish_work_order_points
      WHERE
        (pagu IS NULL AND denomination_value IS NOT NULL)
        OR (pagu IS NOT NULL AND denomination_value IS NULL)
        OR (
          pagu IS NOT NULL
          AND denomination_value IS NOT NULL
          AND (
            requested_amount IS NULL
            OR CONVERT(DECIMAL(38,2), requested_amount) <>
              CONVERT(DECIMAL(38,2), pagu)
              * CONVERT(DECIMAL(38,2), denomination_value)
          )
        )
    )
      THROW 53208, ''Terdapat detail point dengan kombinasi pagu, denom, dan nominal yang tidak konsisten.'', 1;

  ';

  IF COL_LENGTH(N'dbo.replenish_work_order_points', N'required_cassettes') IS NULL
  BEGIN
    EXEC sys.sp_executesql N'
      ALTER TABLE dbo.replenish_work_order_points
        ADD required_cassettes AS (
          CASE
            WHEN pagu IS NULL THEN NULL
            ELSE CONVERT(SMALLINT, pagu / 2000)
          END
        ) PERSISTED;
    ';
  END
  ELSE IF NOT EXISTS (
    SELECT 1
    FROM sys.computed_columns computed_column
    WHERE computed_column.object_id = OBJECT_ID(N'dbo.replenish_work_order_points')
      AND computed_column.name = N'required_cassettes'
      AND computed_column.is_persisted = 1
      AND LOWER(
        REPLACE(
          REPLACE(
            REPLACE(
              REPLACE(computed_column.definition, N'[', N''),
              N']', N''
            ),
            N' ', N''
          ),
          CHAR(9), N''
        )
      ) LIKE N'%pagu%'
      AND LOWER(
        REPLACE(
          REPLACE(
            REPLACE(
              REPLACE(computed_column.definition, N'[', N''),
              N']', N''
            ),
            N' ', N''
          ),
          CHAR(9), N''
        )
      ) LIKE N'%2000%'
  )
  BEGIN
    THROW 53204, 'Kolom required_cassettes sudah ada tetapi bukan computed column PERSISTED dengan formula pagu / 2000.', 1;
  END;


  EXEC sys.sp_executesql N'
    ALTER TABLE dbo.replenish_work_order_points WITH CHECK
      ADD CONSTRAINT CK_replenish_point_activity_type
        CHECK (activity_type IN (''NORMAL'', ''PENGOSONGAN'', ''PERDANA''));

    ALTER TABLE dbo.replenish_work_order_points WITH CHECK
      ADD CONSTRAINT CK_replenish_point_pagu
        CHECK (pagu IS NULL OR pagu IN (2000, 4000, 6000, 8000));

    ALTER TABLE dbo.replenish_work_order_points WITH CHECK
      ADD CONSTRAINT CK_replenish_point_denomination
        CHECK (denomination_value IS NULL OR denomination_value > 0);

    ALTER TABLE dbo.replenish_work_order_points WITH CHECK
      ADD CONSTRAINT CK_replenish_point_amount_formula
        CHECK (
          (pagu IS NULL AND denomination_value IS NULL)
          OR (
            pagu IS NOT NULL
            AND denomination_value IS NOT NULL
            AND requested_amount IS NOT NULL
            AND CONVERT(DECIMAL(38,2), requested_amount) =
              CONVERT(DECIMAL(38,2), pagu)
              * CONVERT(DECIMAL(38,2), denomination_value)
          )
        );
  ';

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.replenish_work_order_points')
      AND name = N'IX_replenish_points_activity_work_order'
  )
  BEGIN
    EXEC sys.sp_executesql N'
      CREATE INDEX IX_replenish_points_activity_work_order
        ON dbo.replenish_work_order_points(activity_type, work_order_id)
        INCLUDE (pagu, denomination_value, requested_amount, required_cassettes);
    ';
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
