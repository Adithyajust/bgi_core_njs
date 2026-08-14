# QR Approval Serah Terima Kunci

Dokumen Serah Terima Kunci memperoleh QR verifikasi ketika Work Order mencapai approval akhir (`APPROVE`). QR Penyerah dicetak pada blok kiri dan QR Penerima dicetak pada blok kanan, mengikuti identitas masing-masing pihak.

## Data yang dibekukan saat approval

- Penyerah: nama, NIP, dan jabatan petugas yang memverifikasi/menyerahkan kunci.
- Penerima: nama, NIP, dan jabatan petugas Custody pada tim Work Order.
- Pejabat approval: user dan waktu approval akhir.
- Token verifikasi unik untuk setiap dokumen Serah Terima Kunci.

Snapshot tersebut tidak mengikuti perubahan data pegawai setelah approval. Saat PDF pertama kali dibentuk, aplikasi menyimpan hash snapshot dokumen, hash file PDF, dan hash approval. Pemindaian QR membuka halaman verifikasi yang mencocokkan token, identitas, approval, serta integritas PDF tersimpan.

PDF dengan template lama akan ditandai sebagai `stale` dan dibentuk ulang otomatis ketika pengguna menekan tombol cetak. URL pratinjau membawa versi template dan hash PDF agar browser tidak memakai cache lama. Penggantian pasangan PDF dan metadata menggunakan mekanisme backup sementara yang kompatibel dengan Windows.

## Instalasi

Jalankan migration berikut sebelum menggunakan fitur:

```bash
npm run migrate
```

Migration yang menambahkan data QR adalah `scripts/migrations/053-key-handover-approval-qr.sql`. Data Serah Terima Kunci lama yang Work Order-nya sudah disetujui akan diisi snapshot dan token sejauh data penyerah/penerima masih tersedia.
