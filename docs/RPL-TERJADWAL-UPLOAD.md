# RPL Terjadwal v4: upload parameter terpisah

Pemasangan dan langkah operasional tersedia di `PETUNJUK-UPDATE-RPL-v4.md`. Tidak ada dependency baru. Akses halaman dan seluruh endpoint tetap terbatas pada Super Admin dengan izin menu RPL. Upload data memakai izin create; upload ulang/edit parameter dan penerapan parameter memakai izin update. Penulisan memeriksa same-origin melalui mekanisme otorisasi aplikasi yang sudah ada.

## Kontrak Excel baru

Nama sheet detail tetap `Data Detail TID Perencanaan` dan `Data Detail TID DSR`. Header biasanya pada baris 7. Parser mencari header yang sesuai, sehingga posisi baris header tidak harus 7.

| Kolom | Perencanaan | DSR |
| --- | --- | --- |
| A | Date | Date |
| B | TID | TID |
| C | Nama Lokasi | Nama Lokasi |
| D | Jenis Mesin | Jenis Mesin |
| E | Cluster | Cluster |
| F | Pagu Perencanaan (lembar) | Pagu Realisasi (lembar) |
| G | Forecast (Perencanaan) | Realisasi |
| H | Penyebab | Penyebab |
| I | Kendala | Kendala |
| J | Catatan Tambahan | Catatan Tambahan |

Perencanaan memakai Forecast pada G; DSR memakai Realisasi pada G. Aplikasi menghitung pasangan dan Status. Kedua hasil itu tidak perlu dimasukkan dalam Excel baru. Kolom H–J dipertahankan sebagai catatan input.

- Date berisi angka hari sesuai bulan/tahun pilihan, termasuk tahun kabisat. C3 diperiksa jika memuat nama bulan Indonesia dan tahun yang dikenali.
- TID maksimal 50 karakter huruf/angka/titik/garis bawah/tanda minus tanpa spasi. Gunakan format Text agar nol di depan tetap tersimpan. Nilai numerik yang sudah kehilangan nol di Excel tidak dipulihkan.
- Nama Lokasi wajib, maksimal 250 karakter. Jenis Mesin ATM/CRM. Cluster wajib, maksimal 100 karakter.
- Pagu berupa bilangan bulat 0–10.000.000 lembar. Forecast/Realisasi Ya/Tidak. Penyebab/Kendala/Catatan masing-masing maksimal 4.000 karakter.
- Maksimal file 10 MB dan 20.000 baris data per sheet. Nomor baris mengikuti batas format XLSX (1.048.576); jarak/gap, row record kosong, sel kosong, dan formatting pada baris tinggi tidak dihitung sebagai jumlah data. Parser hanya menyimpan baris yang memiliki nilai pada kolom importer, sehingga workbook yang memiliki >100.000 row record fisik akibat formatting tetap dapat diproses selama data aktualnya berada dalam batas bisnis. Guard keamanan tetap membatasi 100.000 baris bernilai dan 1.000.000 sel bernilai per sheet sebelum validasi bisnis 20.000 baris. Preview menampilkan 50 baris dan maksimal 200 pesan kesalahan.
- Kedua sheet detail harus memiliki data valid sebelum disimpan. Semua kesalahan membatalkan penyimpanan. Seluruh data tersimpan atomik sebagai satu versi.
- Format lama 12 kolom A–L dan Denom opsional M pada Perencanaan tetap didukung. Parameter Jadwal lama tetap menjadi pelengkap. Master Parameter TID unit yang dipilih diprioritaskan bila TID cocok.
- Sheet `rpl_tid_parameter` yang ikut dalam file detail tidak diimpor secara otomatis. Gunakan panel upload parameter tersendiri.

Template detail: `modules/rpl-terjadwal/templates/RPL-Template-Upload.xlsx`. File berisi dua sheet dengan format 10 kolom tanpa contoh kejadian.

## Kontrak parameter

Gunakan sheet `rpl_tid_parameter` dengan header delapan kolom ini:

`TID | Lokasi | Kantor Cabang | Jenis | Denom | Cluster FLM | Cluster RPL | Sub Cluster RPL`

- Header dapat ditemukan di baris mana pun. Template menempatkannya pada baris 1, data mulai baris 2.
- TID, Lokasi, Kantor Cabang, Jenis, Denom, dan Cluster RPL wajib. Cluster FLM/Sub Cluster RPL boleh kosong, sesuai field opsional sebelumnya.
- TID mengikuti aturan detail. TID berulang, termasuk beda huruf besar/kecil, ditolak dalam satu file.
- Jenis ATM/CRM. Denom 50000, 100000, atau All Denom. Nilai seperti 50.000 dinormalisasi menjadi 50000.
- Batas Lokasi 250 karakter; Kantor Cabang 150; setiap cluster 100. Maksimal 20.000 TID per file dan per unit.
- File gabungan atau file yang hanya berisi sheet parameter dapat dipakai. Tidak memerlukan periode atau batch RPL.
- Upload memakai upsert berdasarkan unit pelaporan + TID. Field pada baris yang diunggah mengganti field master TID tersebut. Field opsional kosong akan dikosongkan. TID yang tidak diunggah tetap ada.
- Unit pelaporan dipilih dari Master Uker dan disimpan dengan ID unit. Kolom Kantor Cabang adalah atribut pelaporan TID dan tidak mengubah unit penyimpanan.
- Rata-rata transaksi harian tetap menjadi input khusus laporan karena tidak ada pada delapan kolom contoh. Penerapan master mempertahankan nilai ini.

Template parameter: `modules/rpl-terjadwal/templates/RPL-Template-Parameter.xlsx`. Template kosong, hanya satu sheet. Contoh lampiran dalam `tests/fixtures/rpl-upload-v4-reference.xlsx` digunakan sebagai acuan pengujian, bukan template default.

## Salinan parameter dan riwayat

Upload data menyalin master ke `rpl_tid_parameters` untuk TID yang muncul dalam data. Lokasi, Jenis, dan Cluster RPL pada laporan memakai salinan parameter jika tersedia; data detail mentah tetap tersimpan. Penghitungan KPI dan pencocokan tetap memakai tanggal + TID.

Perubahan master tidak otomatis mengubah versi laporan yang sudah tersimpan. Tab Edit menyediakan penerapan master terbaru secara eksplisit. Hanya TID yang cocok pada versi terpilih yang diperbarui. Tidak ada penambahan/penghapusan kejadian dan tidak ada perubahan ke versi lain. Catatan detail, pengaturan laporan, dan rata-rata transaksi harian dipertahankan. TID tanpa pasangan master tetap menggunakan nilai sebelumnya.

Upload data tanpa master tetap diizinkan seperti versi sebelumnya. Rupiah yang belum memiliki Denom ditandai belum lengkap. Parameter dapat dilengkapi kemudian.

File detail identik untuk periode dan nama unit yang sama tetap ditolak (409). Gunakan penerapan parameter terbaru pada versi yang sudah ada jika hanya parameternya yang berubah.

## Rumus dan penanganan kasus khusus

- Pencocokan memakai TID tanpa membedakan kapitalisasi + tanggal lengkap dalam batch sama, tanpa H+1. Pasangan memakai **baris pertama menurut nomor baris Excel**, mengikuti INDEX/MATCH. Pemisah pada kunci mencegah tabrakan antara gabungan TID dan hari yang berbeda.
- Semua kejadian duplikat dihitung di KPI. Grid jadwal mengambil pagu pertama per TID/tanggal. Jadi 3.758 kejadian DSR dapat menjadi 3.750 point tanggal/TID pada grid.
- Forecast Accuracy = Sesuai Perencanaan / Forecast Ya; % Sesuai = Sesuai DSR / Realisasi Ya; FP rate = FP / Forecast; FN rate = FN / Realisasi. Pembagi nol menghasilkan 0 sesuai Excel.
- Daily Grand Total = Forecast Ya Perencanaan + Forecast Tidak DSR. Persentase total dihitung dari total bulanan, bukan rata-rata persentase hari.
- Rincian kategori Rekap KPI memakai seluruh baris Perencanaan sebagai pembagi, termasuk FN (kolom D Excel), sehingga bisa melebihi 100%. KPI FN utama tetap memakai total realisasi.
- Cluster Implemented = cluster unik Perencanaan (E6). Total Cluster adalah isian manual (B6), tersedia di Edit. Narasi menjelaskan bahwa cluster implemented berasal dari perencanaan, sesuai sumber rumus.
- Grid tanggal mengambil F detail, termasuk nol, sesuai INDEX/MATCH. Jumlah RPL per TID menghitung tanggal dengan pagu > 0. Total point menghitung semua sel tanggal numerik. Flag Forecast/Realisasi tersedia di detail dan tidak mengubah aturan lookup jadwal.
- Pola = pembulatan jumlah hari bulan / jumlah tanggal rencana dengan pagu > 0. Angka 31 hardcoded diganti jumlah hari bulan terpilih.
- Lembar harian = transaksi harian / Denom untuk ATM; CRM memakai nilai estimasi All Denom (default 75.000). Transaksi pola = transaksi harian × pola; lembar berdasarkan frekuensi = lembar harian × pola.
- Pagu lembar dibulatkan ke atas ke kelipatan 2.000. Pagu rupiah = pagu lembar × Denom ATM atau nilai estimasi All Denom untuk CRM.
- Status dibandingkan dengan batas ATM 8.000 / CRM 6.000 lembar: lebih besar = Melebihi Pagu, sama = Maksimum Pagu, di bawah = Minimum Pagu.
- Kas tanggal = pagu detail pertama × Denom. All Denom memakai 75.000 sesuai SUMPRODUCT. Ini estimasi gabungan pecahan, bukan rincian pecahan fisik.
- Tim harian = pembulatan ke atas point / 14. Total merupakan tim-hari, bukan tim unik bulanan. Kapasitas, kelipatan, batas pagu, dan estimasi All Denom dapat diubah per batch.
- Rata-rata transaksi harian kosong di workbook acuan. Perhitungan pagu berbasis transaksi ditandai belum lengkap sampai diisi, agar angka kosong tidak memberi kesan pagu sebenarnya nol.

## Database dan API

Migrasi 057 menambahkan:

- `rpl_tid_parameter_sets`: nomor revisi master per ID unit.
- `rpl_tid_parameter_master`: delapan field parameter, ID unit, waktu dan pengguna pembaruan.
- `rpl_upload_batches.reporting_uker_id` dan `parameter_revision`.
- `rpl_tid_parameters.location`, `machine_type`, dan `cluster` untuk salinan per versi.

Migrasi mempertahankan seluruh data lama. Batch lama dihubungkan ke ID unit hanya jika nama unit cocok secara unik. Batch yang belum terhubung tetap dapat diedit per TID; penerapan master hanya tersedia untuk batch yang memiliki ID unit.

| Endpoint | Fungsi |
| --- | --- |
| `GET /api/rpl-terjadwal` | Riwayat, detail, laporan, pilihan unit, atau template detail (`template=1`). |
| `POST /api/rpl-terjadwal` | Preview/commit kedua sheet dengan period, uker_id, file_name, mode; commit menyertakan preview_hash dan parameter_revision dari preview. |
| `PATCH /api/rpl-terjadwal` | Edit TID, pengaturan, atau catatan khusus batch dengan report revision. |
| `GET /api/rpl-terjadwal/parameters` | Master per uker_id, search, page; atau template parameter (`template=1`). |
| `POST /api/rpl-terjadwal/parameters` | Preview/commit sheet parameter dengan uker_id, file_name, mode; commit menyertakan preview_hash dan revision dari preview. Body berupa byte XLSX. |
| `PATCH /api/rpl-terjadwal/parameters` | `type=edit`: uker_id, revision, parameter. `type=apply`: uker_id, batch, revision laporan, parameter_revision master. |

Transaksi parameter menggunakan application lock SQL Server per ID unit. Pembacaan master memakai shared lock; perubahan master exclusive lock. Proses yang juga menyentuh batch selalu mengunci master lebih dahulu agar urutan lock konsisten. Laporan tetap mengunci batch saat membaca beberapa sheet.

Preview tidak menulis data. Commit membaca ulang file dan memeriksa hash serta revisi. Perubahan revisi antara preview dan penyimpanan menghasilkan 409. Pemeriksaan revisi diulang di dalam transaksi penyimpanan RPL agar perubahan master setelah pembacaan API tidak terlewat.

Upsert bertahap per 500 baris tetap berada dalam satu transaksi. Kegagalan tulis atau audit melakukan rollback. Penerapan master memeriksa kesamaan ID unit dan kedua nomor revisi. Update satu TID yang tidak ditemukan ditolak. Semua query memakai parameter SQL untuk nilai input.

## Verifikasi

Hasil dan batas pengujian tersedia di `PETUNJUK-UPDATE-RPL-v4.md`. Jalankan test RPL dengan Node 22.15+ atau Node 24 agar pengujian adapter API/database juga aktif:

```sh
node --test tests/rpl-*.test.mjs
```

Uji integrasi database dan antarmuka tetap perlu dijalankan pada aplikasi dengan dependency dan SQL Server yang tersedia. Test adapter memeriksa alur dan penanganan kegagalan, bukan menggantikan eksekusi migrasi/query pada SQL Server.
