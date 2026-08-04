# Perbaikan Permission Create Replenish

## Masalah

API `POST /api/transactions/replenish` memeriksa permission `create` pada menu
`/transactions`. Pada database lama, migration menu legacy dapat membuat baris
`role_sidebar_routes` dengan `can_view = 1`, tetapi `can_create = 0` dan
`can_update = 0`.

Migration 026 sebelumnya hanya menambahkan permission ketika relasi role-menu
belum ada. Akibatnya, baris legacy yang sudah ada tidak diperbarui dan pengguna
masih dapat membuka halaman tetapi gagal menyimpan draft.

## Perbaikan

Migration `028-replenish-permission-alignment.sql` melakukan upsert untuk:

- `SUPER_ADMIN`: view, create, update, delete;
- `OPERATOR` atau `Admin CRO`: view, create, update;
- `MANAGER`, `Manager CRO`, atau `Asisten Manager CRO`: view dan update.

Role lain tidak diubah. Hak Auditor, CPC, Custody, Pengemudi, dan role khusus
lainnya tetap mengikuti konfigurasi Super Admin.

UI Replenish juga membaca permission dari bootstrap. Tombol buat, ubah, ajukan,
review, dan batal tidak lagi ditampilkan kepada pengguna yang tidak memiliki
permission terkait.

## Penerapan

```bash
npm run db:migrate
```

Setelah migration, logout dan login kembali atau refresh aplikasi agar bootstrap
permission dimuat ulang.

## Pemeriksaan SQL

```sql
SELECT
  r.role_code,
  r.role_name,
  sr.href,
  rsr.can_view,
  rsr.can_create,
  rsr.can_update,
  rsr.can_delete
FROM dbo.role_sidebar_routes rsr
INNER JOIN dbo.roles r ON r.id = rsr.role_id
INNER JOIN dbo.sidebar_routes sr ON sr.id = rsr.sidebar_route_id
WHERE sr.href = '/transactions'
ORDER BY r.role_code;
```
