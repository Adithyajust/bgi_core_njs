# Audit Log Seluruh Menu

Tabel kanonis aplikasi adalah `dbo.audit_logs`. Migration `014-audit-log-all-menus.sql` juga membuat view kompatibilitas `dbo.audit_log` apabila nama tersebut belum dipakai oleh tabel atau view lain.

## Modul yang dicatat

Setiap operasi tambah, ubah, dan hapus pada modul berikut memanggil `writeAuditLog()` setelah operasi database berhasil:

- Master Kanwil
- Master Cabang
- Master Unit Kerja
- Master Pegawai
- Master Merk
- Master Tipe Mesin
- Master Project
- Master Mesin
- Master Kendaraan
- Pengaturan Side Menu
- Pengaturan User dan Role

Aksi administratif pada User dan Role juga dicatat, yaitu membuka kunci akun, mereset password, dan memperbarui hak akses role. Nilai password, hash, token sesi, cookie, dan authorization tidak disimpan pada metadata audit.

## Migration wajib

```bash
npm run db:migrate
```

Migration `014-audit-log-all-menus.sql` mengubah foreign key `audit_logs.user_id` menjadi `ON DELETE SET NULL`. Dengan demikian, riwayat audit tetap tersimpan ketika akun target dihapus dan penghapusan akun tidak terhambat oleh foreign key audit.

## Pemeriksaan

```bash
npm run audit:check
```

Perintah tersebut menampilkan jumlah audit, 20 aktivitas terbaru, serta rekap jumlah audit berdasarkan modul dan aksi.

Query manual:

```sql
SELECT TOP (100)
  al.id,
  al.created_at,
  al.user_id,
  u.username,
  al.action,
  al.module,
  al.entity_type,
  al.entity_id,
  al.ip_address,
  al.request_id,
  al.metadata_json
FROM dbo.audit_logs al
LEFT JOIN dbo.users u ON u.id = al.user_id
ORDER BY al.id DESC;
```

Riwayat baru hanya terbentuk untuk tindakan yang dilakukan setelah source code dan migration ini diterapkan. Aktivitas lama tidak dapat direkonstruksi secara akurat karena data pelaku, waktu tindakan, alamat IP, dan kondisi sebelum perubahan tidak tersedia.
