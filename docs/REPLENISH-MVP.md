# Modul Transaksi Replenish ATM/CRM — Tahap 1

## Cakupan yang sudah dibangun

Tahap pertama membangun induk transaksi yang akan digunakan oleh seluruh proses lanjutan:

- Work order unik dengan nomor `RPL-YYYYMMDD-XXXXXXXXXX`.
- Jenis aktivitas Normal, Pengosongan, dan Pengisian Perdana.
- Satu work order dapat memuat maksimal 50 ATM/CRM.
- Jadwal, jam berangkat, estimasi selesai, prioritas, dan catatan rute.
- Kendaraan operasional.
- Tim wajib: Custody, Pengemudi, dan Petugas Pengawalan.
- Validasi anggota aktif, unit kerja, mesin aktif, dan kendaraan aktif.
- Pemeriksaan benturan anggota tim dan kendaraan pada tanggal yang sama.
- Workflow Draft → Menunggu Persetujuan Tim → Disetujui/Ditolak.
- Pembatalan work order sebelum memasuki tahap operasional lanjutan.
- Maker-checker: pembuat tidak boleh menyetujui transaksi sendiri.
- Optimistic locking dengan SQL Server `ROWVERSION`.
- Riwayat status dan audit log.
- Pencarian server-side dan cursor pagination untuk data besar.

## Migration

Jalankan:

```bash
npm run db:migrate
```

Migration yang ditambahkan:

```text
scripts/migrations/026-replenish-work-order-core.sql
```

## URL modul

```text
/transactions/replenish
```

## Peran aplikasi sementara

Pemetaan tahap awal menggunakan peran yang sudah tersedia:

- `OPERATOR`: Admin CRO / maker.
- `MANAGER`: Manager CRO / checker.
- `SUPER_ADMIN`: administrasi dan supervisi lintas unit, tetap terkena maker-checker.

Pemetaan peran yang lebih rinci—CPC, Asisten Manager CPC, Custody, Pengemudi,
dan Pengawalan—perlu ditambahkan pada tahap berikutnya.

## Tahap pengembangan berikutnya

1. Permintaan kaset, validasi CPC, pengisian kaset, dan blotter.
2. Master kaset dan status siklus kaset.
3. Master kunci, barcode, BAST, dan pengembalian kunci.
4. Aplikasi lapangan Custody: tiba lokasi, geolocation, bill count, set cash.
5. Kode kombinasi terenkripsi dengan akses berjangka dan autentikasi ulang.
6. Penerimaan kaset kembali, penghitungan CPC, dan rekonsiliasi.
7. Tiket selisih, insiden, dashboard operasional, dan laporan.

## Catatan keamanan

Kode kombinasi tidak dimasukkan pada tahap ini. Implementasinya harus memakai
penyimpanan terenkripsi, akses terbatas per work order, batas waktu akses,
autentikasi ulang, masking audit, dan larangan penyimpanan offline tanpa kontrol khusus.
