# Replenish - Cetak Dokumen Terpisah dan Gate Approval Berdasarkan Validasi Kunci

## Alur akhir

1. Admin CRO menyimpan Work Order sebagai Draft.
2. Admin melakukan scan seluruh kunci Replenish yang dibutuhkan oleh ATM/CRM pada Work Order.
3. Backend memvalidasi bahwa seluruh point memiliki mapping, barcode scan cocok dengan mapping terkini, seluruh point sudah discan, dan kunci tersedia.
4. Jika seluruh data kunci valid, Work Order dapat langsung diajukan untuk persetujuan.
5. Cetak Serah Terima Kunci merupakan tombol/dokumen tersendiri dan tidak menjadi gate pengajuan.
6. Cetak Surat Tugas tetap menggunakan halaman/cetakan Surat Tugas yang sudah ada dan muncul sesuai status Work Order yang telah ditentukan sebelumnya.

## Perubahan teknis

- `key-handover.summary.can_submit` sekarang bergantung pada `allScanned`, bukan `allScanned && printed`.
- Validasi backend `validateReplenishKeyHandoverForSubmit()` tidak lagi mensyaratkan `printed_at`.
- Detail Work Order menggunakan `verified_at` sebagai indikator validasi kunci sebelum submit.
- Status UI `Menunggu Cetak` dihapus. Setelah seluruh scan valid, status menjadi `Siap Diajukan`.
- Tombol cetak dibedakan secara eksplisit menjadi `Cetak Surat Tugas` dan `Cetak Serah Terima Kunci`.
- Konfirmasi hasil cetak Serah Terima tetap dipertahankan untuk audit `printed_at`, tetapi tidak mengunci pengajuan.

## Pengamanan yang tetap berlaku

Pengajuan tetap ditolak backend apabila:

- tidak ada ATM/CRM pada Work Order;
- masih ada ATM/CRM yang belum memiliki mapping kunci Replenish;
- jumlah scan belum sama dengan jumlah kunci yang diwajibkan;
- mapping/barcode berubah setelah scan;
- ada kunci yang sedang tidak tersedia;
- status verifikasi lengkap belum terbentuk.

Tidak ada migration database baru.
