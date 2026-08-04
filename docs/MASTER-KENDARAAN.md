# Master Kendaraan

Modul ini menambahkan pengelolaan kendaraan operasional pada menu Master Data.

## Struktur data

Tabel: `dbo.master_kendaraan`

- `id`: primary key.
- `uker_id`: relasi ke `dbo.master_uker`.
- `jenis_kendaraan`: `MOBIL` atau `MOTOR`.
- `merk_kendaraan`: nama merk/model kendaraan.
- `nomor_kendaraan`: nomor kendaraan unik dan disimpan dalam huruf kapital.
- `status`: `AKTIF` atau `NONAKTIF`.
- `created_at`, `updated_at`, dan `row_version`.

## Pembatasan akses

- Pengguna non-Super Admin hanya melihat, menambah, mengubah, dan menghapus kendaraan pada unit kerja yang terhubung ke akunnya.
- `uker_id` dari request pengguna non-Super Admin diabaikan oleh API dan ditentukan dari sesi pengguna.
- Super Admin dapat memilih unit kerja.
- Seluruh operasi tetap mengikuti permission `view`, `create`, `update`, dan `delete` pada menu `/masters`.

## Menjalankan migration

```bash
npm run db:migrate
```

Migration yang ditambahkan: `scripts/migrations/013-master-kendaraan.sql`.

## URL modul

- Halaman: `/masters/kendaraan`
- API: `/api/masters/kendaraan`
