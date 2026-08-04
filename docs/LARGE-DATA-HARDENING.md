# Large Data Hardening

Perubahan ini menutup risiko konsumsi memori berlebihan pada impor dan menambah indeks untuk pola query daftar yang paling sering digunakan.

## Perbaikan aplikasi

- Hanya satu konfigurasi Next.js yang digunakan. `allowedDevOrigins` dipindahkan ke `next.config.mjs` dan dapat diatur melalui `NEXT_ALLOWED_DEV_ORIGINS` (dipisahkan koma).
- Body JSON impor dibaca secara streaming dengan batas ukuran. Request yang melampaui batas dihentikan sebelum seluruh body ditahan di memori dan mengembalikan HTTP 413.
- Impor mesin dibatasi 2 MB untuk body JSON; impor kendaraan dibatasi 1 MB. Batas file spreadsheet tetap 5 MB dan maksimal 500 baris per batch.
- Parser XLSX memvalidasi batas direktori ZIP, jumlah entri, offset data, ukuran hasil ekstraksi, jumlah baris/kolom/sel, shared strings, dan panjang nilai sel.
- Hasil dekompresi dibaca bertahap dan dihentikan ketika melewati batas 12 MB per entri XML.
- Nomor baris atau kolom XLSX yang ekstrem tidak lagi dapat membuat sparse array sangat besar.

## Perbaikan database

Migration `023-large-data-query-indexes.sql` menambah indeks untuk:

- daftar pegawai berdasarkan nama dan ruang lingkup unit kerja;
- daftar unit kerja berdasarkan kode;
- daftar project terbaru dan project per unit kerja;
- daftar kendaraan terbaru dan kendaraan per unit kerja;
- filter user berdasarkan role serta status.

Jalankan sebelum deployment aplikasi:

```bash
npm run db:migrate
```

Pembuatan indeks pada tabel yang sudah sangat besar dapat menambah beban I/O dan transaction log. Jalankan pada maintenance window dan pastikan ruang log mencukupi.

## Batas yang tetap berlaku

Beberapa daftar selain Master Mesin masih memakai pagination `OFFSET`. Indeks baru mengurangi biaya sort dan lookup, tetapi halaman yang sangat dalam tetap semakin mahal. Untuk tabel yang tumbuh sampai jutaan baris, tahap berikutnya adalah mengubah Pegawai, Project, Kendaraan, dan User Role ke keyset/cursor pagination serta mengganti dropdown besar menjadi autocomplete server-side.
