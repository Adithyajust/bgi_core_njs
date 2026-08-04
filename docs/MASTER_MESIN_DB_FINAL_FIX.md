# Final repair — kategori lokasi PERTOKOAN

Perbaikan ini menambahkan migration `018-force-rebuild-master-mesin-kategori-lokasi.sql`.
Versi baru digunakan agar migration tetap dieksekusi apabila migration 016/017 pernah tercatat pada `schema_migrations`, tetapi constraint di database aktif masih menggunakan definisi lama.

Endpoint import sekarang juga mengembalikan identitas SQL Server dan database aktif. Gunakan informasi tersebut untuk memastikan migration dijalankan pada koneksi yang sama dengan aplikasi.

## Cara utama

```powershell
npm run db:migrate
```

Pastikan output menampilkan target server/database yang sama dengan pesan pada halaman upload dan memuat:

```text
APPLY 018-force-rebuild-master-mesin-kategori-lokasi.sql
Seluruh migration berhasil diterapkan.
```

## Cara langsung melalui SSMS

Jalankan file `repair-master-mesin-kategori-lokasi-ssms.sql` pada SQL Server yang sama dengan `MSSQL_SERVER` di `.env.local`.
