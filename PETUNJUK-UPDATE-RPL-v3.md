> Dokumen versi sebelumnya. Untuk perubahan terbaru gunakan `PETUNJUK-UPDATE-RPL-v4.md`.

# Update RPL Terjadwal v3

Paket berisi file tambahan/perubahan untuk menu RPL Terjadwal khusus Super Admin, upload Perencanaan/DSR dengan Denom, dan grid seluruh sheet hingga Jadwal RPL vs Realisasi. Ini patch kumulatif terhadap ZIP kode awal: bisa dipasang ke kode awal atau versi menu/upload sebelumnya.

## Pemasangan

1. Cadangkan kode dan database; ekstrak paket ke folder sementara.
2. Gabungkan isi `app`, `lib`, `modules`, `scripts`, `tests`, dan `docs` ke root proyek yang berisi `package.json`. Ganti hanya file dengan jalur sama, bukan seluruh folder.
3. Bila `lib/routes.js` sudah Anda ubah sendiri, gabungkan hanya entri `/rpl_terjadwal` dari patch ke `routeMap` Anda. Perubahan mandiri pada modul RPL juga perlu digabungkan.
4. Pastikan `modules/rpl-terjadwal/templates/RPL-Template-Upload.xlsx` ikut tersalin.
5. Jalankan dari root proyek dengan konfigurasi database aplikasi yang sudah tersedia:

```sh
npm run db:migrate
npm run lint
npm test
npm run build
```

6. Restart aplikasi menggunakan prosedur deployment yang biasa dipakai.
7. Login sebagai `SUPER_ADMIN`, buka **RPL Terjadwal**, dan upload workbook Anda. Contoh memakai **Agustus 2026** (`2026-08`).

Migrasi 054 menambah menu, 055 tabel upload, dan **056** parameter TID/laporan. Isi 054/055 tidak diubah; yang sudah tercatat akan dilewati runner. Jangan ubah migrasi yang sudah diterapkan. Tidak ada dependency NPM tambahan.

## Denom dan pelaporan

- Pertahankan A–L pada kedua sheet. Tambahkan **M: Denom** pada **Data Detail TID Perencanaan**: `50000`, `100000`, atau `All Denom`.
- File lama tetap didukung. Denom pada Jadwal dibaca sebagai pelengkap; M Perencanaan diprioritaskan. Jika kosong, lengkapi melalui **Edit**.
- Edit menyediakan rata-rata transaksi harian, cluster FLM, sub cluster RPL, dan parameter laporan tanpa memakai master aplikasi.
- Tombol **Unduh template dengan Denom** menyediakan workbook untuk upload berikutnya.
- Tab tersedia: Petunjuk Pengisian, dua Detail TID, Daily_Accuracy, Rekap KPI, Ringkasan Manajemen, Jadwal RPL vs Realisasi, dan Edit.

30 test RPL lulus; 29.749 nilai cocok dengan acuan. Build aplikasi serta migrasi/penyimpanan SQL Server aktual masih perlu diuji di staging Anda. Ada satu kegagalan test lama karena `.gitignore` root tidak disertakan dalam arsip awal; pertahankan file asli proyek Anda.

Rincian terdapat di `docs/RPL-TERJADWAL-UPLOAD.md`. `MANIFEST-UPDATE-RPL.json` memuat daftar file dan SHA-256 untuk pemeriksaan isi paket. Patch tidak menghapus file kode lama.
