# Persediaan Spare Kaset CPC

Fitur ini memisahkan proses **Sortir ke Kaset** dari proses packing Work Order RPL.

## Aturan denominasi dan isi

| Pilihan denominasi | Isi wajib |
| ---: | ---: |
| Rp50.000 | 2.000 lembar per kaset |
| Rp100.000 | 2.000 lembar per kaset |

Label adalah identitas fisik kaset dan tidak dikunci permanen ke salah satu denominasi. Petugas CPC memilih atau memindai kaset terlebih dahulu, lalu memilih denom Rp50.000 atau Rp100.000 sesuai uang yang dimasukkan. Jumlah isi tetap dikunci 2.000 lembar di server dan database.

Kaset yang sudah selesai dipakai dan dilepas dari Work Order dapat disortir ulang memakai salah satu denom yang tersedia serta nomor segel baru. Kaset yang masih berstatus **Dipakai WO** tetap dikunci.

## Alur kerja

1. Petugas CPC membuka menu **Spare Kaset** (`/spare_kaset`). Tabel awal kosong setelah migration 051 dijalankan.
2. Pada form **Input Spare Kaset dari Nol**, petugas memilih atau memindai label kaset.
3. Petugas memilih denom Rp50.000 atau Rp100.000, menyusun tepat 2.000 lembar, lalu memindai nomor segel karet.
4. Sistem mengubah kaset menjadi **Siap Dipakai** dan mencatat petugas serta waktu persiapan.
5. Saat Work Order, misalnya `RPL-20260811-0000000054`, memasuki packing CPC, petugas membuka **Scan Spare Kaset Sesuai Denom**.
6. Kolom kaset menggunakan autocomplete. Saat kolom diklik atau petugas mulai mengetik, pilihan Spare Kaset `READY` yang sesuai denom mesin tampil di bawah kolom, lengkap dengan label, segel, jumlah lembar, dan petugas persiapan.
7. Petugas dapat mencari berdasarkan label, nomor segel, atau nama petugas lalu memilih hasil autocomplete. Pemindai barcode tetap dapat digunakan; label atau segel yang cocok persis langsung mengisi kaset dan segelnya secara otomatis.
8. Setelah disimpan, kaset berstatus **Dipakai WO** dan tidak dapat dipilih oleh Work Order lain.

Hasil autocomplete selalu difilter berdasarkan denom slot mesin dan tidak menampilkan kaset yang sudah dipakai pada slot lain. Jika label atau segel tidak ditemukan, denom tidak sesuai, kaset belum `READY`, atau kaset sudah dipakai, form menolak hasil scan dan menampilkan penyebabnya. Setelah scan atau pilihan valid, fokus berpindah otomatis ke scan berikutnya; scanner dengan suffix Enter juga tetap didukung.

Setiap persiapan, sortir ulang, alokasi, dan pelepasan disimpan pada `cpc_spare_cassette_history`. Data aktif disimpan pada `cpc_spare_cassettes`, sedangkan kaitannya ke slot packing disimpan pada `cpc_packing_cassettes.spare_cassette_id`.

## Instalasi database

Jalankan migration terbaru sebelum memakai form:

```bash
npm run migrate
```

Migration `049-cpc-spare-cassette-inventory.sql` membuat struktur persediaan awal dan seluruh constraint integritasnya. Migration `050-spare-cassette-menu.sql` membuat menu **Spare Kaset** dan memberikan akses kepada role CPC yang sebelumnya memiliki akses transaksi CPC.

Migration `051-empty-spare-cassette-placeholders.sql` menghapus baris placeholder berstatus `KOSONG` yang belum pernah dipersiapkan, belum memiliki histori, dan belum terhubung ke packing. Data `READY`, `ALLOCATED`, dan histori operasional tetap dipertahankan.

Migration `052-flexible-spare-cassette-denomination.sql` melepas mapping label-denom lama dan menggantinya dengan constraint bahwa denom yang dapat dipilih hanya Rp50.000 atau Rp100.000. Migration ini tidak menghapus data persediaan maupun histori.

Migration 049 menggunakan `sys.sp_executesql` saat menambah dan mengindeks kolom baru pada `cpc_packing_cassettes`. Ini diperlukan karena SQL Server melakukan kompilasi satu file migration sebagai satu batch. Jika versi lama pernah gagal dengan pesan `Invalid column name 'spare_cassette_id'`, gunakan file 049 terbaru lalu jalankan kembali `npm run migrate`; transaksi yang gagal sudah di-rollback dan belum dicatat sebagai migration berhasil.
