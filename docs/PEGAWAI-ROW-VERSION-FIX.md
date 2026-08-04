# Perbaikan `pegawai.row_version`

## Gejala

Endpoint `GET /api/masters/pegawai` mengembalikan HTTP 500 dengan pesan SQL Server:

```text
Invalid column name 'row_version'.
```

## Penyebab

API Pegawai menggunakan kolom SQL Server `ROWVERSION` untuk mencegah dua pengguna menimpa perubahan satu sama lain. Database yang dibangun dari schema lama sudah memiliki tabel `dbo.pegawai`, tetapi belum memiliki kolom `row_version`.

## Perbaikan

Migration berikut ditambahkan:

```text
scripts/migrations/024-add-pegawai-row-version.sql
```

Jalankan:

```bash
npm run db:migrate
```

Kemudian restart aplikasi Next.js. Migration bersifat idempotent: kolom hanya ditambahkan apabila belum ada.

## Hotfix langsung di SQL Server

Apabila migration runner belum dapat dijalankan, eksekusi isi file migration tersebut pada database aplikasi. Jangan membuat kolom bertipe `BIGINT`, `BINARY`, atau `DATETIME`; kolom wajib bertipe SQL Server `ROWVERSION`.
