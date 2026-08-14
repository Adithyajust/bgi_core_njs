# Perubahan Form Mapping Kunci Mesin

Perubahan yang diterapkan:

1. Autocomplete mesin hanya mengembalikan mesin aktif yang belum memiliki mapping. Penyaringan dilakukan di SQL Server dengan `NOT EXISTS`, bukan filter per item di browser.
2. Satu mesin hanya dapat memiliki satu mapping. API memakai locking defensif dan migration 037 menambahkan unique index pada `machine_id`.
3. Konfigurasi bawaan matrix menjadi A1–A5, kolom A–Z, dan baris 01–15.
4. Daftar dinding, kolom, baris, total slot, validasi barcode, dan lebar grid dibentuk dari satu konfigurasi dinamis.
5. Header kolom dan label baris dibuat sticky agar matrix besar tetap mudah dibaca.

## Langkah deployment

1. Jalankan `npm run db:migrate` agar migration 037 diterapkan.
2. Tambahkan environment berikut bila ingin menimpa konfigurasi bawaan:

```env
MACHINE_KEY_MATRIX_WALL_COUNT=5
MACHINE_KEY_MATRIX_COLUMN_COUNT=26
MACHINE_KEY_MATRIX_ROW_COUNT=15
```

3. Mulai ulang aplikasi. Lakukan build ulang bila environment dimasukkan pada tahap build.

Migration 037 akan berhenti apabila satu mesin sudah memiliki lebih dari satu mapping. Data duplikat tersebut harus diselesaikan terlebih dahulu agar aturan baru tidak menghapus data secara otomatis.

## Hotfix pencarian autocomplete SQL Server

- Memperbaiki literal `ESCAPE` pada query `LIKE` di endpoint Kunci Mesin. Literal backslash pada template string JavaScript sekarang ditulis ganda agar SQL Server menerima `ESCAPE '\\'` sebagai satu karakter escape, bukan `ESCAPE ''`.
- Memperbaiki pola yang sama pada endpoint autocomplete Master Mesin untuk mencegah kegagalan serupa pada pencarian cabang, project, dan tipe mesin.
- Menambahkan pengujian regresi `tests/sql-like-escape.test.mjs`.

## Pelebaran halaman dan form Kunci Mesin

- Container halaman Kunci Mesin sekarang menggunakan seluruh lebar area konten, sama seperti halaman Master Mesin.
- Modal Tambah/Ubah Mapping diperlebar sampai 1.680 px atau mengikuti lebar viewport yang tersedia.
- Padding backdrop diperkecil agar ruang horizontal lebih optimal untuk matrix A–Z.
- Tampilan mobile tetap responsif dengan jarak tepi 8 px dan tinggi modal menyesuaikan viewport.
- Perubahan hanya menyentuh layout; logika mapping, pencarian mesin, dan akses basis data tidak berubah.

## Barcode, QR Code, dan cetak label gantungan sling

- Pratinjau barcode teks diganti menjadi barcode Code 128-B yang dapat dipindai.
- QR Code dibuat secara lokal dan memuat nilai yang sama persis dengan barcode final.
- Tidak menggunakan layanan barcode/QR eksternal dan tidak menambah dependensi npm.
- Tombol `Cetak Pratinjau` tersedia pada form ketika data label sudah lengkap.
- Tombol `Simpan & Cetak Label` menyimpan mapping terlebih dahulu, lalu mencetak data yang dikembalikan server agar label konsisten dengan basis data.
- Mapping yang sudah tersimpan dapat dicetak ulang melalui tombol `Cetak` pada tabel.
- Layout cetak label sling telah disesuaikan menjadi 25 mm × 15 mm dan mencantumkan barcode, QR Code, TID, SN, posisi matrix, jenis set, serta project dalam tata letak ringkas.
- Menambahkan pengujian encoder Code 128, QR lokal, dan alur cetak label pada `tests/machine-key-label.test.mjs`.

Tidak diperlukan migration basis data baru untuk perubahan label ini.
## Penyesuaian label sling 25 × 15 mm

- Ukuran kertas dan area label diubah menjadi 25 mm × 15 mm.
- Tata letak label dipadatkan: identitas TID/posisi, Code 128, teks kode, QR Code, SN, jenis set, dan project.
- Quiet zone serta ukuran SVG disesuaikan untuk media kecil tanpa menambahkan layanan atau dependensi eksternal.
- Pratinjau form menampilkan ukuran cetak aktual.
- Tidak ada perubahan basis data atau API.


## Penyederhanaan pratinjau barcode dan QR Code

- Menghapus judul kecil `Barcode Code 128` dan `QR Code` dari bagian atas kotak pratinjau.
- Nilai barcode final ditempatkan tepat di bawah gambar barcode dan tepat di bawah QR Code.
- Nilai yang sama juga dicetak di bawah QR Code pada label fisik 25 mm × 15 mm.
- Tidak ada perubahan pada API, query SQL, maupun struktur basis data.
