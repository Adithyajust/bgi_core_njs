# Replenish Lapangan PWA — Baseline Fase 1

Dokumen ini menjaga pengembangan Replenish Lapangan tetap mengikuti struktur
modul yang sudah ada. Modul lapangan adalah ekstensi dari Work Order Replenish
dan packing CPC; modul ini tidak membuat sumber data Work Order atau packing baru.

## Keputusan operasional

- Perangkat: Android milik perusahaan.
- Operator transaksi: Custody yang tercatat pada tim Work Order.
- Driver: akses terbatas untuk melihat job dan mengonfirmasi keberangkatan.
- Sinyal: alur utama harus dapat antre secara offline dan disinkronkan kembali.
- GPS: wajib pada keberangkatan, tiba TID, mulai proses, selesai/lapor TID,
  perjalanan kembali, dan tiba kantor.
- Foto: wajib hanya pada ketidaksesuaian.
- Supervisor: Manager Operasional atau Asisten Manager CRO meninjau pengecualian.

## Urutan scan per TID

1. Pilih TID pada Work Order yang ditugaskan.
2. Scan Segel BAG Berangkat.
3. Untuk setiap slot, scan serial dan segel kaset lama dari ATM.
4. Untuk setiap slot, scan serial dan segel kaset baru dari CPC.
5. Scan serial dan segel kaset reject.
6. Scan Segel BAG Kembali.
7. Simpan hasil berhasil atau laporkan ketidaksesuaian.

Semua kode aktual di atas harus unik. Data kaset baru, kaset reject, dan kedua
Segel BAG dibandingkan dengan snapshot packing CPC pada TID yang sama. Hasil
yang berbeda tidak dapat diselesaikan sebagai transaksi normal.

## Struktur teknis

- Menu UI: `/field_replenish`.
- API daftar/detail: `/api/transactions/replenish/field`.
- API event idempoten: `/api/transactions/replenish/field/{workOrderId}/sync`.
- Event perangkat memakai `client_event_id` UUID agar retry tidak menggandakan data.
- Antrean perangkat memakai IndexedDB; API dan halaman terlindung tidak pernah
  disimpan ke cache Service Worker.
- Bukti foto disimpan pada storage privat dan hanya dibaca lewat API terotorisasi.
- Riwayat status Work Order tetap memakai `replenish_status_history`.
- Riwayat perangkat, hasil pertukaran kaset, dan pengecualian memakai tabel
  `replenish_field_*` dari migration 047.

## Aturan pengembangan lanjutan

- Jangan menyalin atau mengubah data packing CPC menjadi master baru.
- Selalu periksa assignment anggota tim pada server, bukan hanya permission menu.
- Setiap mutasi baru harus idempoten, tercatat pada audit log, dan aman diulang.
- Jangan menyimpan response API, halaman terautentikasi, kode kombinasi, atau
  session ke cache Service Worker.
- PENGOSONGAN tanpa kaset packing CPC memerlukan desain alur khusus sebelum
  diaktifkan pada form pertukaran kaset fase ini.
