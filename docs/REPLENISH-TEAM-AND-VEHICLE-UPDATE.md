# Replenish Team and Vehicle Update

## Perubahan

1. Custody dan Pengemudi tetap dipilih dari `dbo.pegawai` berdasarkan unit kerja dan status aktif.
2. Petugas Pengawalan diubah menjadi free text wajib maksimal 200 karakter dan disimpan pada `dbo.replenish_work_orders.escort_name`.
3. Data pengawalan lama dimigrasikan dari anggota tim ber-role `PENGAWALAN` ke `escort_name`.
4. `dbo.replenish_team_members` kini hanya menyimpan role `CUSTODY` dan `PENGEMUDI`.
5. Referensi kendaraan Replenish hanya menampilkan kendaraan aktif dengan `jenis_kendaraan = 'MOBIL'`.
6. Backend memvalidasi ulang bahwa kendaraan yang dipilih adalah mobil, sehingga payload manual tidak dapat menggunakan motor.

## Migration

Jalankan:

```bash
npm run db:migrate
```

Migration yang ditambahkan:

```text
027-replenish-escort-free-text-car-only.sql
```

Migration bersifat idempotent pada penambahan kolom dan aman untuk data lama. Nama pengawalan lama dipertahankan sebelum relasi pegawainya dihapus.

## Perbaikan migration `escort_name`

SQL Server mengompilasi seluruh batch sebelum mengeksekusi `ALTER TABLE`. Karena itu,
statement yang langsung mereferensikan `escort_name` pada batch yang sama dapat gagal
meskipun `ALTER TABLE ... ADD escort_name` ditulis lebih dahulu.

Migration 027 sekarang menjalankan proses backfill, perubahan `NOT NULL`, dan pembuatan
check constraint melalui `sys.sp_executesql`, sehingga statement baru dikompilasi setelah
kolom tersedia. Migration tetap idempotent dan tidak memerlukan pemisah batch `GO`, sehingga
kompatibel dengan runner `mssql.Request.batch()`.
