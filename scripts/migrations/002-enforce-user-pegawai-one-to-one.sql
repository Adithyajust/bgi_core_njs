SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('dbo.users', 'U') IS NULL
  THROW 50001, 'Tabel dbo.users tidak ditemukan.', 1;

IF OBJECT_ID('dbo.pegawai', 'U') IS NULL
  THROW 50002, 'Tabel dbo.pegawai tidak ditemukan.', 1;

IF COL_LENGTH('dbo.users', 'pegawai_id') IS NULL
  THROW 50003, 'Kolom dbo.users.pegawai_id belum tersedia.', 1;

IF EXISTS (
  SELECT pegawai_id
  FROM dbo.users
  WHERE pegawai_id IS NOT NULL
  GROUP BY pegawai_id
  HAVING COUNT_BIG(*) > 1
)
  THROW 50004, 'Terdapat pegawai_id yang digunakan oleh lebih dari satu user. Bersihkan duplikasi terlebih dahulu.', 1;

IF EXISTS (
  SELECT 1
  FROM dbo.users u
  LEFT JOIN dbo.pegawai p
    ON p.id = u.pegawai_id
  WHERE u.pegawai_id IS NOT NULL
    AND p.id IS NULL
)
  THROW 50005, 'Terdapat users.pegawai_id yang tidak memiliki pasangan pada dbo.pegawai.', 1;

BEGIN TRANSACTION;

IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_key_columns fkc
  WHERE fkc.parent_object_id = OBJECT_ID('dbo.users')
    AND fkc.parent_column_id = COLUMNPROPERTY(
      OBJECT_ID('dbo.users'),
      'pegawai_id',
      'ColumnId'
    )
    AND fkc.referenced_object_id = OBJECT_ID('dbo.pegawai')
    AND fkc.referenced_column_id = COLUMNPROPERTY(
      OBJECT_ID('dbo.pegawai'),
      'id',
      'ColumnId'
    )
)
BEGIN
  ALTER TABLE dbo.users WITH CHECK
    ADD CONSTRAINT FK_users_pegawai
    FOREIGN KEY (pegawai_id)
    REFERENCES dbo.pegawai(id);

  ALTER TABLE dbo.users
    CHECK CONSTRAINT FK_users_pegawai;
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.users')
    AND name = 'UX_users_pegawai_id'
)
BEGIN
  CREATE UNIQUE INDEX UX_users_pegawai_id
    ON dbo.users(pegawai_id)
    WHERE pegawai_id IS NOT NULL;
END;

COMMIT TRANSACTION;
