# Stage 1 Scalability Hardening

Perubahan ini memindahkan operasi daftar yang sebelumnya memuat seluruh tabel ke pola server-side, mengurangi request bootstrap aplikasi, dan menyeragamkan optimistic concurrency.

## Perubahan utama

1. Master Pegawai dan Master Unit Kerja menggunakan filter serta pagination di SQL Server.
2. User & Role menggunakan pagination server-side; opsi pegawai dimuat terpisah hanya ketika modal pengguna dibuka.
3. `/api/bootstrap` menyediakan user, sidebar, navbar, dan permission melalui satu request.
4. Semua halaman master menggunakan bootstrap context sehingga tidak meminta `/api/auth/me` berulang kali.
5. Endpoint update tabel yang memiliki `ROWVERSION` memerlukan `row_version` dan menggunakan predicate atomik saat update.
6. `master_project` mendapat kolom `row_version` melalui migration `022-add-master-project-row-version.sql`.
7. File foto pegawai dikeluarkan dari source package dan root `.gitignore` ditambahkan.

## Langkah deployment

Jalankan migration sebelum menjalankan versi aplikasi ini:

```bash
npm run db:migrate
```

Pastikan proses deployment memiliki izin `ALTER TABLE` untuk menjalankan migration 022. Setelah migration berhasil, restart seluruh instance aplikasi agar semua instance menggunakan kontrak API yang sama.

## Perubahan kontrak API

- `GET /api/masters/pegawai` sekarang mengembalikan `pegawai`, `pagination`, dan `summary`.
- `GET /api/masters/uker` sekarang mengembalikan `ukers`, `pagination`, dan `summary`.
- Gunakan `GET /api/masters/uker?mode=options` untuk dropdown unit kerja.
- `GET /api/settings/user-role` mengembalikan daftar user terhalaman.
- Gunakan `GET /api/settings/user-role?mode=pegawai-options&search=...` untuk pilihan pegawai.
- Request `PUT` harus mengirimkan `row_version` terbaru. Konflik perubahan mengembalikan HTTP 409.
