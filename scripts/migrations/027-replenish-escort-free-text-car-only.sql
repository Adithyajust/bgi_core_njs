SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.replenish_work_orders', N'U') IS NULL
    THROW 52701, 'Tabel dbo.replenish_work_orders belum tersedia. Jalankan migration 026 terlebih dahulu.', 1;

  IF OBJECT_ID(N'dbo.replenish_team_members', N'U') IS NULL
    THROW 52702, 'Tabel dbo.replenish_team_members belum tersedia. Jalankan migration 026 terlebih dahulu.', 1;

  /*
    Petugas pengawalan tidak lagi mereferensikan master pegawai.
    Nama pengawalan disimpan sebagai snapshot/free text pada work order.

    Catatan SQL Server:
    Statement yang mereferensikan kolom baru dijalankan melalui sp_executesql.
    Ini mencegah error "Invalid column name 'escort_name'" akibat seluruh batch
    dikompilasi sebelum ALTER TABLE ADD selesai dikenali.
  */
  IF COL_LENGTH(N'dbo.replenish_work_orders', N'escort_name') IS NULL
  BEGIN
    ALTER TABLE dbo.replenish_work_orders
      ADD escort_name NVARCHAR(200) NULL;
  END;

  EXEC sys.sp_executesql N'
    /* Pertahankan nama pengawalan dari data lama sebelum baris tim lama dihapus. */
    UPDATE wo
    SET wo.escort_name = p.nama
    FROM dbo.replenish_work_orders wo
    INNER JOIN dbo.replenish_team_members tm
      ON tm.work_order_id = wo.id
     AND tm.member_role = ''PENGAWALAN''
    INNER JOIN dbo.pegawai p
      ON p.id = tm.employee_id
    WHERE NULLIF(LTRIM(RTRIM(wo.escort_name)), N'''') IS NULL;

    /* Data legacy tanpa pengawalan tetap dibuat valid dan dapat diedit. */
    UPDATE dbo.replenish_work_orders
    SET escort_name = N''Belum ditentukan''
    WHERE NULLIF(LTRIM(RTRIM(escort_name)), N'''') IS NULL;

    ALTER TABLE dbo.replenish_work_orders
      ALTER COLUMN escort_name NVARCHAR(200) NOT NULL;
  ';

  IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.replenish_work_orders')
      AND name = N'CK_replenish_wo_escort_name'
  )
    ALTER TABLE dbo.replenish_work_orders
      DROP CONSTRAINT CK_replenish_wo_escort_name;

  /* Constraint yang menyebut kolom baru juga dikompilasi setelah kolom tersedia. */
  EXEC sys.sp_executesql N'
    ALTER TABLE dbo.replenish_work_orders WITH CHECK
      ADD CONSTRAINT CK_replenish_wo_escort_name
      CHECK (LEN(LTRIM(RTRIM(escort_name))) BETWEEN 1 AND 200);
  ';

  /* Hapus relasi pegawai untuk role pengawalan; Custody dan Pengemudi tetap dari pegawai. */
  DELETE FROM dbo.replenish_team_members
  WHERE member_role = 'PENGAWALAN';

  IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.replenish_team_members')
      AND name = N'CK_replenish_team_role'
  )
    ALTER TABLE dbo.replenish_team_members
      DROP CONSTRAINT CK_replenish_team_role;

  ALTER TABLE dbo.replenish_team_members WITH CHECK
    ADD CONSTRAINT CK_replenish_team_role
    CHECK (member_role IN ('CUSTODY', 'PENGEMUDI'));

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0
    ROLLBACK TRANSACTION;
  THROW;
END CATCH;
