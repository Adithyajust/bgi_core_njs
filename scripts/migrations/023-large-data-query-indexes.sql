SET NOCOUNT ON;
SET XACT_ABORT ON;

/*
  Index tambahan untuk pola list yang paling sering dipakai aplikasi.
  Tujuan utamanya adalah mengurangi sort besar dan key lookup berulang ketika
  tabel pegawai, project, kendaraan, dan unit kerja mulai bertambah.
*/

IF OBJECT_ID(N'dbo.pegawai', N'U') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM sys.indexes
     WHERE object_id = OBJECT_ID(N'dbo.pegawai')
       AND name = N'IX_pegawai_list_name'
   )
BEGIN
  CREATE INDEX IX_pegawai_list_name
    ON dbo.pegawai(nama ASC, nip ASC, id ASC)
    INCLUDE (uker_id, status, status_peg, email, jabatan, updated_at);
END;

IF OBJECT_ID(N'dbo.pegawai', N'U') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM sys.indexes
     WHERE object_id = OBJECT_ID(N'dbo.pegawai')
       AND name = N'IX_pegawai_uker_status_name'
   )
BEGIN
  CREATE INDEX IX_pegawai_uker_status_name
    ON dbo.pegawai(uker_id, status, nama ASC, nip ASC, id ASC)
    INCLUDE (status_peg, email, jabatan, updated_at);
END;

IF OBJECT_ID(N'dbo.master_uker', N'U') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM sys.indexes
     WHERE object_id = OBJECT_ID(N'dbo.master_uker')
       AND name = N'IX_master_uker_list_code'
   )
BEGIN
  CREATE INDEX IX_master_uker_list_code
    ON dbo.master_uker(codeuker ASC, nama_uker ASC, id ASC)
    INCLUDE (kota, email, tanggal_ops, updated_at);
END;

IF OBJECT_ID(N'dbo.master_project', N'U') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM sys.indexes
     WHERE object_id = OBJECT_ID(N'dbo.master_project')
       AND name = N'IX_master_project_recent'
   )
BEGIN
  CREATE INDEX IX_master_project_recent
    ON dbo.master_project(created_at DESC, id DESC)
    INCLUDE (uker_id, status_project, is_active, kode_project, nama_project, progress, updated_at);
END;

IF OBJECT_ID(N'dbo.master_project', N'U') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM sys.indexes
     WHERE object_id = OBJECT_ID(N'dbo.master_project')
       AND name = N'IX_master_project_uker_recent'
   )
BEGIN
  CREATE INDEX IX_master_project_uker_recent
    ON dbo.master_project(uker_id, created_at DESC, id DESC)
    INCLUDE (status_project, is_active, kode_project, nama_project, progress, updated_at);
END;

IF OBJECT_ID(N'dbo.master_kendaraan', N'U') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM sys.indexes
     WHERE object_id = OBJECT_ID(N'dbo.master_kendaraan')
       AND name = N'IX_master_kendaraan_recent'
   )
BEGIN
  CREATE INDEX IX_master_kendaraan_recent
    ON dbo.master_kendaraan(updated_at DESC, id DESC)
    INCLUDE (uker_id, jenis_kendaraan, status, nomor_kendaraan, merk_kendaraan);
END;

IF OBJECT_ID(N'dbo.master_kendaraan', N'U') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM sys.indexes
     WHERE object_id = OBJECT_ID(N'dbo.master_kendaraan')
       AND name = N'IX_master_kendaraan_uker_recent'
   )
BEGIN
  CREATE INDEX IX_master_kendaraan_uker_recent
    ON dbo.master_kendaraan(uker_id, updated_at DESC, id DESC)
    INCLUDE (jenis_kendaraan, status, nomor_kendaraan, merk_kendaraan);
END;

IF OBJECT_ID(N'dbo.users', N'U') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM sys.indexes
     WHERE object_id = OBJECT_ID(N'dbo.users')
       AND name = N'IX_users_role_status'
   )
BEGIN
  CREATE INDEX IX_users_role_status
    ON dbo.users(role_id, is_active, id ASC)
    INCLUDE (pegawai_id, codeuker, username, full_name, email, locked_until, updated_at);
END;

SELECT N'Migration 023 indeks query data besar berhasil dijalankan.' AS message;
