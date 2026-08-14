# Surat Tugas Replenish dan QR Verifikasi

## Alur bisnis

Surat Tugas bukan transaksi atau approval terpisah. Dokumen terbentuk otomatis ketika approval final Work Order mengubah status menjadi `DISETUJUI`.

Dalam transaksi SQL yang sama, sistem:

1. memperbarui status, approver, dan waktu approval Work Order;
2. membentuk snapshot Work Order, tim, kendaraan, jadwal, dan seluruh titik ATM/CRM;
3. menerbitkan nomor `ST-{NOMOR-WORK-ORDER}`;
4. membuat token verifikasi QR;
5. menghitung SHA-256 isi dokumen dan SHA-256 tanda tangan approval;
6. menyimpan Surat Tugas dengan status `DISETUJUI`;
7. menulis audit log Work Order dan Surat Tugas;
8. melakukan commit hanya jika seluruh proses berhasil.

Jika pembuatan Surat Tugas gagal, approval Work Order ikut rollback. Dengan demikian tidak ada kondisi approval final berhasil tetapi Surat Tugas belum terbentuk.

## Penandatangan

Penandatangan Surat Tugas adalah user yang melakukan approval final Work Order. Nama, NIP, jabatan, dan waktu persetujuan ditampilkan pada area tanda tangan bersama QR.

## QR dan verifikasi

QR membuka URL:

`/transactions/replenish/surat-tugas/verify/{verification_token}`

Halaman verifikasi menampilkan nomor Surat Tugas, nomor Work Order, unit kerja, approver, waktu approval, document hash, serta status integritas payload dan approval hash.

QR dibuat oleh encoder lokal pada `modules/replenish/qr-code.js`; tidak menggunakan API QR pihak ketiga.

## Kompatibilitas data lama

Untuk Work Order yang telah berstatus disetujui sebelum fitur otomatis dipasang, endpoint baca Surat Tugas melakukan backfill otomatis dari approver dan waktu approval Work Order. Pengguna tidak melihat tombol pembuatan atau approval Surat Tugas.

## Migration

Jalankan:

```bash
npm run db:migrate
```

Migration terkait:

- `034-replenish-assignment-letter.sql`
- `035-replenish-assignment-letter-auto-generation.sql`

## Catatan legal

QR ini merupakan bukti persetujuan elektronik internal dan pemeriksaan integritas dokumen aplikasi. Implementasi ini bukan tanda tangan digital tersertifikasi PSrE.
