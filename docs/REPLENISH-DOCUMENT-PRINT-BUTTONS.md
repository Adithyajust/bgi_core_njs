# Tombol Cetak Dokumen Replenish

Perubahan ini menambahkan akses cetak yang eksplisit pada halaman Transaksi Replenish.

## Perilaku

- `Cetak Surat Tugas` muncul ketika status Work Order sudah memenuhi syarat Surat Tugas.
- `Cetak Serah Terima` muncul setelah seluruh kunci terverifikasi untuk pembuat draft, atau tetap tersedia sebagai cetak ulang setelah dokumen pernah dicetak.
- Cetak pertama Serah Terima tetap harus dikonfirmasi berhasil agar backend mencatat `printed_at` dan membuka pengajuan approval.
- Cetak ulang Serah Terima hanya membaca snapshot melalui endpoint GET dan tidak mengubah lifecycle Work Order.
- Daftar Work Order mengambil metadata handover melalui satu `LEFT JOIN` ke `replenish_key_handovers`; tidak ada query per baris/N+1.

## Validasi

- Seluruh 198 pengujian proyek lulus.
- JSX halaman transaksi dan Surat Tugas berhasil ditranspilasi menggunakan TypeScript parser.
- Tidak diperlukan migration database baru.
