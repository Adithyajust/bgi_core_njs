# Pemeriksaan Audit Log

Tabel audit kanonis aplikasi adalah `dbo.audit_logs` (bentuk jamak), bukan `dbo.audit_log`.

## Mengapa tabel dapat tetap kosong

Audit bukan trigger database global. Setiap endpoint `POST`, `PUT`, atau `DELETE` harus memanggil `writeAuditLog()` setelah operasi bisnis berhasil. Sebelumnya, route Master Kendaraan belum memiliki pemanggilan tersebut. Selain itu, helper audit sengaja tidak membatalkan transaksi bisnis saat pencatatan audit gagal; kegagalan hanya dicetak pada terminal server dengan awalan `Audit log write failed`.

## Langkah pemeriksaan

```bash
npm run db:migrate
npm run audit:check
```

Kemudian lakukan tambah, ubah, atau hapus satu data kendaraan dan jalankan kembali:

```bash
npm run audit:check
```

Query SQL manual:

```sql
SELECT TOP (100)
  id,
  created_at,
  user_id,
  action,
  module,
  entity_type,
  entity_id,
  ip_address,
  request_id,
  metadata_json
FROM dbo.audit_logs
ORDER BY id DESC;
```

Jika data menu berhasil tersimpan tetapi audit tetap kosong, periksa terminal Next.js. Pesan `Audit log write failed` kini memuat nama modul, aksi, ID entitas, ID pengguna, nomor error SQL, dan pesan error database.

## Error `Incorrect syntax near 'QUOTENAME'` pada migration 014

Migration `014-audit-log-all-menus.sql` harus membentuk perintah `ALTER TABLE ... DROP CONSTRAINT` ke dalam variabel `NVARCHAR(MAX)` terlebih dahulu, lalu menjalankannya dengan `sys.sp_executesql`. SQL Server dapat menolak pemanggilan `QUOTENAME()` yang ditempatkan langsung di dalam ekspresi `EXEC (...)`.

Versi migration yang benar menggunakan pola berikut:

```sql
DECLARE @dropAuditForeignKeySql NVARCHAR(MAX);
SET @dropAuditForeignKeySql =
  N'ALTER TABLE dbo.audit_logs DROP CONSTRAINT ' +
  QUOTENAME(@auditUserForeignKey) + N';';
EXEC sys.sp_executesql @dropAuditForeignKeySql;
```

Apabila migration sebelumnya gagal, tidak perlu menghapus baris pada `dbo.schema_migrations` karena migration yang gagal tidak dicatat. Jalankan kembali `npm run db:migrate` setelah file diperbarui.
