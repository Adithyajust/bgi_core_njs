# Pembaruan Denom pada Master Mesin

## Cakupan

Pembaruan ini menambahkan atribut `denom` pada seluruh alur Master Mesin:

- struktur database;
- form tambah dan ubah;
- tabel daftar dan pencarian;
- filter Denom;
- detail API;
- validasi form;
- template upload XLSX;
- validasi dan preview upload;
- proses insert massal;
- audit metadata;
- pilihan ATM/CRM dan detail point pada transaksi Replenish.

## Aturan data

- Denom wajib diisi untuk data baru dan perubahan data.
- Panjang maksimum 50 karakter.
- Nilai dinormalisasi ke huruf kapital.
- Format sengaja berupa teks agar dapat menampung satu atau beberapa pecahan, misalnya `50.000`, `100.000`, atau `50.000 / 100.000`.
- Data lama tetap aman karena migration menambahkan kolom sebagai nullable. Data lama yang belum memiliki Denom akan tampil `-` dan wajib dilengkapi ketika diubah.

## Penerapan

```bash
npm run db:migrate
npm test
npm run dev
```

Migration yang diterapkan:

```text
scripts/migrations/030-add-master-mesin-denom.sql
```

Template upload terbaru:

```text
public/templates/template-upload-mesin.xlsx
```

Header upload harus memuat kolom `denom` setelah `db`. Maksimal upload tetap 500 baris dan seluruh transaksi upload dibatalkan jika satu baris tidak valid.
