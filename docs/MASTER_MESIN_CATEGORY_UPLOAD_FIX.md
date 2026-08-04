# Perbaikan Validasi Kategori Lokasi Upload Mesin

## Gejala

Upload file dapat berhenti dengan pesan umum seperti:

- Baris 130: Kategori Lokasi tidak valid.
- Baris 148: Kategori Lokasi tidak valid.
- Baris 159: Kategori Lokasi tidak valid.

Pesan sebelumnya tidak menampilkan nilai yang bermasalah, sedangkan pratinjau hanya menampilkan 10 baris pertama. Akibatnya, baris 130 ke atas sulit diperiksa dari aplikasi.

## Perubahan

1. Nilai kategori lokasi dinormalisasi sebelum divalidasi:
   - huruf besar/kecil;
   - spasi berlebih;
   - non-breaking space dari Excel;
   - zero-width character;
   - spasi di sekitar tanda `/`;
   - variasi umum seperti `MINIMARKET`, `ALFA MART`, `INSTANSI PEMERINTAH`, dan `BRI UNIT`.
2. Pesan kesalahan sekarang menampilkan nilai yang diterima dari file.
3. Sistem memberikan saran kategori terdekat untuk kesalahan ketik ringan.
4. Pratinjau otomatis menampilkan baris yang bermasalah terlebih dahulu.
5. Kolom `Kategori Lokasi` ditambahkan pada tabel pratinjau.
6. Daftar kategori lokasi yang diterima ditampilkan pada ketentuan upload.
7. Template versi baru memiliki dropdown untuk:
   - Site;
   - Kategori Lokasi;
   - Garansi;
   - Hari Operasional;
   - Jam Operasional;
   - Waktu Operasional;
   - Status.
8. Sheet `Referensi Upload` ditambahkan ke template agar pengguna dapat melihat nilai baku.

## Integritas Data

Perbaikan tidak menghapus validasi kategori. Nilai yang benar-benar tidak termasuk kategori resmi tetap ditolak sehingga constraint database tetap konsisten.

## Database

Tidak diperlukan migration database baru.

## Pengujian

`npm test` menghasilkan 42 pengujian lulus dan 0 gagal.
