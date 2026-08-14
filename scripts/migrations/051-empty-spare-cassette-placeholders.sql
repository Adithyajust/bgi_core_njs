SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.cpc_spare_cassettes', N'U') IS NULL
    THROW 55101, 'Tabel dbo.cpc_spare_cassettes belum tersedia. Jalankan migration 049 terlebih dahulu.', 1;

  IF OBJECT_ID(N'dbo.cpc_spare_cassette_history', N'U') IS NULL
    THROW 55102, 'Tabel histori spare kaset belum tersedia. Jalankan migration 049 terlebih dahulu.', 1;

  IF OBJECT_ID(N'dbo.cpc_packing_cassettes', N'U') IS NULL
    THROW 55103, 'Tabel packing kaset CPC belum tersedia.', 1;

  DECLARE @deletedPlaceholders INT = 0;

  /*
    Hanya hapus seed placeholder yang benar-benar belum pernah dipersiapkan,
    belum memiliki histori, dan belum terhubung ke packing. Data READY,
    ALLOCATED, serta histori operasional tidak boleh dihapus.
  */
  DELETE spare
  FROM dbo.cpc_spare_cassettes spare
  WHERE spare.status = 'KOSONG'
    AND spare.rubber_seal_no IS NULL
    AND spare.prepared_by IS NULL
    AND spare.prepared_at IS NULL
    AND spare.allocated_packing_cassette_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM dbo.cpc_spare_cassette_history history
      WHERE history.spare_cassette_id = spare.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM dbo.cpc_packing_cassettes packing
      WHERE packing.spare_cassette_id = spare.id
    );

  SET @deletedPlaceholders = @@ROWCOUNT;

  COMMIT TRANSACTION;

  SELECT
    @deletedPlaceholders AS deleted_placeholder_rows,
    'Placeholder spare kaset dikosongkan. Input berikutnya dilakukan dari menu Spare Kaset.' AS message;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
