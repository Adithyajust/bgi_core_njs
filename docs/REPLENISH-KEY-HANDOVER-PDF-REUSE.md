# Serah Terima Kunci — Pembacaan Ulang PDF Tersimpan

## Perilaku akhir

- Tombol cetak memeriksa metadata PDF Serah Terima Kunci yang tersimpan terlebih dahulu.
- File hanya dipakai ulang apabila `document_hash` sama dengan snapshot verifikasi aktif.
- Jika file valid tersedia, aplikasi langsung membuka PDF dari private storage tanpa menjalankan `PREPARE_PRINT`.
- Jika file belum tersedia atau metadata lama tidak sesuai, server menjalankan `PREPARE_PRINT`, membentuk PDF, menghitung hash, dan menyimpannya.
- PDF ditampilkan melalui viewer di dalam modal Detail Work Order yang sedang aktif; aplikasi tidak membuka tab, jendela, atau form baru.
- Tombol cetak pada tabel membuka Detail Work Order di halaman yang sama, kemudian menggulir ke viewer PDF.
- Pencetakan dilakukan melalui ikon printer pada toolbar viewer PDF, lalu pengguna dapat memilih `Konfirmasi Sudah Dicetak`.
- Konfirmasi cetak mengembalikan metadata PDF yang sama agar cetak ulang berikutnya tetap membaca file tersimpan.

## Penyimpanan

```text
storage/private/replenish/key-handover/work-order-{id}.pdf
storage/private/replenish/key-handover/work-order-{id}.json
```

Pola ini mengikuti alur Surat Tugas: status file dibaca lebih dahulu, integritas dokumen diverifikasi, lalu file PDF tersimpan diprioritaskan untuk pencetakan ulang.
