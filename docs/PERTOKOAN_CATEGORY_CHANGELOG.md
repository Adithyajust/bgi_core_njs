# Penambahan Kategori Lokasi PERTOKOAN

Perubahan:

- Menambahkan `PERTOKOAN` pada daftar kategori lokasi aplikasi.
- Menambahkan `PERTOKOAN` pada form tambah/edit dan filter Master Mesin.
- Mengizinkan `PERTOKOAN` pada validasi upload Excel/CSV dan API.
- Menambahkan normalisasi `TOKO`, `AREA TOKO`, dan `AREA PERTOKOAN` menjadi `PERTOKOAN`.
- Memperbarui template upload Excel dan dropdown kategori lokasi.
- Menambahkan migration `016-add-pertokoan-kategori-lokasi.sql` untuk memperbarui check constraint database yang sudah berjalan.
- Memperbarui migration awal agar instalasi database baru langsung mendukung `PERTOKOAN`.

Penerapan database:

```powershell
npm run db:migrate
```
