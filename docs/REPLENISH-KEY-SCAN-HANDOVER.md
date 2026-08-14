# Replenish - Scan dan Serah Terima Kunci sebelum Approval

## Alur baru

1. Admin CRO membuat atau memperbarui Work Order sebagai **Draft**.
2. Admin membuka **Scan Kunci**.
3. Sistem mengambil seluruh ATM/CRM pada Work Order dan mencocokkannya dengan `machine_key_mappings` bertipe `REPLENISH`.
4. Setiap label sling kunci dipindai. Barcode hanya diterima bila benar-benar milik mesin pada Work Order tersebut.
5. Setelah seluruh kunci cocok, tombol **Cetak Serah Terima** aktif.
6. Sistem mencetak Berita Acara Serah Terima Kunci berisi Work Order, unit kerja, jadwal, Custody, TID/SN/lokasi, posisi matrix, dan barcode.
7. Setelah dialog printer selesai, pengguna wajib mengonfirmasi bahwa dokumen benar-benar berhasil dicetak.
8. Hanya setelah konfirmasi cetak, **Ajukan Approval** aktif.
9. Endpoint `PATCH ... action=SUBMIT` tetap melakukan validasi server-side. Manipulasi UI tidak dapat melewati kewajiban scan dan cetak.

## Pengamanan

- Scan menggunakan transaksi `SERIALIZABLE` dan penguncian Work Order.
- Tidak ada query per daftar ATM/CRM (tidak menggunakan pola N+1 untuk pemuatan/verifikasi daftar).
- Barcode harus merupakan mapping `REPLENISH` untuk machine yang berada pada Work Order yang sama.
- Snapshot barcode harus masih sama dengan barcode mapping saat pengajuan.
- Draft yang diubah mereset hasil verifikasi sebelumnya.
- Work Order yang ditolak atau dibatalkan mereset kesiapan pengajuan; pengajuan ulang wajib scan dan cetak ulang.
- Proses cetak dicatat ke `audit_logs`, termasuk snapshot daftar kunci saat dicetak.

## Database

Migration baru:

`038-replenish-key-handover.sql`

Tabel:

- `dbo.replenish_key_handovers`
- `dbo.replenish_key_handover_items`

Jalankan:

```bash
npm run db:migrate
```

## Catatan cetak

Browser tidak menyediakan API yang dapat memastikan secara kriptografis bahwa kertas benar-benar keluar dari printer. Karena itu sistem menggunakan dua lapis kontrol:

1. dialog printer harus dibuka setelah seluruh kunci terverifikasi; dan
2. pengguna harus mengonfirmasi hasil cetak setelah dialog printer ditutup.

Status server `printed_at` hanya diisi setelah konfirmasi kedua tersebut.
