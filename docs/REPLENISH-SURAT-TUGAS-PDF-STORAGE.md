# Surat Tugas PDF Persisten

## Tujuan

Surat Tugas tetap menggunakan snapshot Work Order yang sudah disetujui. Pada pencetakan pertama, aplikasi membentuk satu file PDF immutable dan menyimpannya pada private storage. Pencetakan ulang membaca file PDF tersebut tanpa mengambil ulang isi Work Order, personel, titik ATM/CRM, atau data Surat Tugas dari database.

## Alur

1. Halaman Surat Tugas memeriksa endpoint status file PDF.
2. Jika PDF sudah tersedia, halaman langsung menampilkan file tersimpan.
3. Jika PDF belum tersedia, halaman memuat snapshot Surat Tugas seperti sebelumnya.
4. Tombol `Bentuk PDF & Cetak` memanggil endpoint generator.
5. Server memvalidasi status, payload hash, dan approval hash.
6. Server membentuk PDF A4 dengan header BGI, isi Surat Tugas, QR, penandatangan, dan hash dokumen.
7. PDF dan sidecar metadata ditulis secara atomik ke private storage.
8. Browser membuka file PDF untuk pencetakan.
9. Akses berikutnya hanya membaca PDF dan sidecar metadata dari storage. Database tetap digunakan untuk autentikasi dan permission, bukan untuk merender ulang isi dokumen.

## Lokasi file

```text
storage/private/replenish/surat-tugas/work-order-{id}.pdf
storage/private/replenish/surat-tugas/work-order-{id}.json
```

Sidecar JSON menyimpan scope unit kerja, nomor Surat Tugas, document hash, PDF hash, waktu pembentukan, dan user pembentuk. Metadata ini memungkinkan validasi akses unit kerja tanpa membaca ulang data transaksi.

## Endpoint

```text
GET  /api/transactions/replenish/{id}/surat-tugas/pdf?status=1
GET  /api/transactions/replenish/{id}/surat-tugas/pdf
POST /api/transactions/replenish/{id}/surat-tugas/pdf
```

`POST` hanya membentuk file ketika file belum tersedia. Jika file sudah tersedia, endpoint mengembalikan file yang sama dan tidak membentuk ulang dokumen.

## Catatan deployment

Private storage harus persisten. Pada deployment multi-instance atau container, mount `storage/private/replenish/surat-tugas` ke shared/persistent volume agar semua instance membaca file yang sama dan file tidak hilang ketika container diganti.

Tidak ada migration database baru dan tidak ada dependency PDF eksternal. Generator menggunakan modul Node.js lokal dan QR encoder yang sudah tersedia.
