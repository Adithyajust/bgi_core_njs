SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.pegawai', N'U') IS NULL
  BEGIN
    THROW 50401, 'Tabel dbo.pegawai tidak ditemukan.', 1;
  END;

  IF COL_LENGTH(N'dbo.pegawai', N'ktp') IS NULL
  BEGIN
    ALTER TABLE dbo.pegawai ADD ktp VARCHAR(50) NULL;
  END;

  IF EXISTS (
    SELECT LTRIM(RTRIM(ktp))
    FROM dbo.pegawai
    WHERE NULLIF(LTRIM(RTRIM(ktp)), '') IS NOT NULL
    GROUP BY LTRIM(RTRIM(ktp))
    HAVING COUNT_BIG(*) > 1
  )
  BEGIN
    THROW 50402, 'Terdapat nomor KTP duplikat. Rapikan data sebelum membuat index unik.', 1;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.pegawai')
      AND name = N'UX_pegawai_ktp'
  )
  BEGIN
    CREATE UNIQUE INDEX UX_pegawai_ktp
      ON dbo.pegawai(ktp)
      WHERE ktp IS NOT NULL;
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
