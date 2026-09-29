# Perbaikan RPL Terjadwal v4

Versi ini memisahkan upload parameter TID dari upload Perencanaan/DSR. Format detail mengikuti Excel yang dikirim: 10 kolom A–J. Master parameter memakai 8 kolom A–H pada sheet `rpl_tid_parameter`.

## Pemasangan

1. Gunakan `MANIFEST-UPDATE-RPL.json` untuk melihat file yang berubah dari ZIP sumber Anda. Gabungkan file dengan jalur yang sama ke proyek yang berisi `package.json`. Jangan mengganti seluruh folder dengan hanya sebagian isi paket.
2. Pastikan kedua template dalam `modules/rpl-terjadwal/templates` ikut dipasang.
3. Gunakan konfigurasi dan dependency aplikasi yang sudah terpasang. Tidak ada dependency NPM baru.
4. Jalankan dari root proyek:

```sh
npm run db:migrate
npm run lint
npm test
npm run build
```

5. Restart aplikasi dengan prosedur yang biasa digunakan.

Migrasi baru adalah **057-rpl-independent-tid-parameters.sql**. Migrasi 054–056 tidak diubah. Runner melewati migrasi yang sudah diterapkan. Versi laporan dan parameter lama tetap tersimpan.

## Cara penggunaan

1. Login sebagai **SUPER_ADMIN** dan buka **RPL Terjadwal**.
2. Pilih unit pelaporan dari Master Uker.
3. Pada **Upload dan kelola parameter**, pilih file Excel Anda. File gabungan tiga sheet dapat digunakan langsung. Proses ini hanya membaca sheet `rpl_tid_parameter` dan tidak memerlukan periode.
4. Klik **Preview parameter**, periksa hasilnya, lalu **Simpan parameter**. TID baru ditambahkan; TID yang sama diperbarui untuk unit yang dipilih. TID yang tidak tercantum dalam file tetap tersimpan.
5. Gunakan tombol **Ubah** pada daftar parameter untuk memperbarui satu TID kapan saja. Upload ulang dapat memperbarui banyak TID sekaligus.
6. Isi Perencanaan dan DSR pada format baru, pilih periode, kemudian **Preview & Validasi** dan **Simpan ke Database**. Sistem menyalin parameter master unit yang dipilih ke versi upload ini.
7. Buka laporan melalui riwayat. Untuk memakai perubahan master pada versi yang sudah tersimpan, buka **Edit → Terapkan parameter terbaru → Simpan perubahan**. Tindakan ini berlaku pada versi yang dipilih. TID tanpa pasangan mempertahankan parameter sebelumnya.
8. Tombol **Ubah** pada tab Edit tetap dapat mengubah parameter khusus versi laporan, termasuk rata-rata transaksi harian. Perubahan khusus laporan tidak mengubah master parameter.

Excel yang Anda lampirkan berisi **50 TID parameter**. Kedua sheet detail masih kosong. Parameter dapat langsung di-preview dan disimpan, sedangkan Perencanaan/DSR perlu diisi sebelum upload data RPL dapat disimpan.

## Perbedaan pengelolaan parameter

| Tindakan | Dampak |
| --- | --- |
| Upload atau edit master parameter | Berlaku untuk unit yang dipilih dan upload RPL berikutnya. |
| Upload Perencanaan/DSR | Membuat versi data dengan salinan parameter saat upload. |
| Edit TID pada versi laporan | Hanya mengubah versi laporan itu. |
| Terapkan parameter terbaru | Mengambil master terbaru untuk semua TID yang cocok pada versi laporan yang dipilih. |

Master menyimpan Lokasi, Kantor Cabang, Jenis, Denom, Cluster FLM, Cluster RPL, dan Sub Cluster RPL. Identitas pada laporan mengikuti salinan parameter bila tersedia. Data asli Excel tetap tersimpan. Pencocokan kejadian, status, KPI, lembar, dan rumus jadwal memakai aturan sebelumnya.

Rata-rata transaksi harian tidak ada dalam 8 kolom Excel parameter. Nilainya tetap dikelola pada tab Edit laporan dan dipertahankan saat master diterapkan kembali.

## Hasil verifikasi dan batas pengujian

- **53 pengujian RPL lulus, 0 gagal, 2 dilewati**. Dua test lama memerlukan workbook acuan historis yang tidak ada pada lampiran saat ini. Pengujian RPL mencakup format lama/baru, file Excel lampiran, mapping H–J, 50 parameter, validasi, hak akses, preview/commit, revisi, salinan parameter, dan rollback transaksi menggunakan adapter uji.
- Kedua template baru telah dibaca ulang oleh parser aplikasi dan diperiksa tampilannya. Template tidak berisi contoh TID yang bisa terunggah tanpa sengaja.
- Sintaks JSX dan kompilasi JSX berhasil untuk ketiga komponen yang berubah; pemeriksaan referensi tidak menemukan identifier yang belum didefinisikan.
- SQL Server aktual, migrasi di database, dan browser aplikasi belum dapat dijalankan dalam lingkungan perbaikan ini. Build/lint penuh juga belum terverifikasi karena dependency aplikasi tidak tersedia dan perintahnya tidak berhasil dijalankan.
- Pengujian proyek secara keseluruhan: **327 lulus, 1 gagal, 2 dilewati** (330 test). Satu kegagalan bawaan: berkas pengecualian Git di root tidak disertakan dalam ZIP asal. Pertahankan berkas asli proyek Anda. Ini tidak terkait alur RPL.

Sesudah pemasangan, uji upload parameter, edit dan reload, upload kedua detail, buka laporan, lalu terapkan master terbaru pada satu versi. Uji pula satu unit lain, data invalid, dan perubahan bersamaan. Semua penulisan parameter tetap memerlukan izin update serta akses Super Admin.

Rincian kontrak Excel, rumus, database, dan API: `docs/RPL-TERJADWAL-UPLOAD.md`.
