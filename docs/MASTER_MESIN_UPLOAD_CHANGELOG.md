# Upload Massal Master Mesin

## Perubahan utama

- Menambahkan tombol **Upload Mesin** pada halaman `/masters/mesin`.
- Menambahkan modal unggah berkas XLSX/CSV dengan drag-and-drop, pratinjau 10 baris, ringkasan validasi, dan daftar kesalahan per baris.
- Menambahkan template `public/templates/template-upload-mesin.xlsx` dengan lembar Data Mesin dan Petunjuk.
- Menambahkan endpoint `POST /api/masters/mesin/import` untuk impor maksimal 500 baris per proses.
- Proses impor bersifat atomik: seluruh berkas dibatalkan apabila satu baris tidak valid.

## Validasi identitas mesin

Validasi diterapkan pada browser, API, transaksi SQL, dan basis data:

1. TID wajib diisi dan unik tanpa membedakan huruf besar/kecil.
2. SN wajib diisi dan unik tanpa membedakan huruf besar/kecil.
3. TID dan SN pada mesin yang sama tidak boleh memiliki nilai yang sama.
4. TID/SN yang sudah ada di basis data ditolak.
5. TID/SN duplikat antarbaris dalam berkas ditolak.

## Referensi master

Kode Cabang, Kode Project, serta kombinasi Kode Merk + Jenis Mesin + Nama Model harus ditemukan dan aktif pada master terkait. Scope unit kerja tetap diterapkan untuk pengguna non-Super Admin.

## Migrasi basis data

Jalankan:

```bash
npm run db:migrate
```

Migration `015-master-mesin-identifier-integrity.sql` menambahkan:

- normalisasi TID dan SN;
- computed column `tid_normalized` dan `sn_normalized`;
- unique index untuk TID dan SN;
- check constraint agar TID dan SN pada baris yang sama tidak identik.

Migrasi akan dihentikan apabila data historis masih memiliki TID/SN kosong, duplikat setelah normalisasi, atau TID dan SN yang sama. Perbaiki data tersebut, kemudian jalankan kembali migrasi.

## Kolom template

`tid`, `sn`, `db`, `kode_cabang`, `kode_project`, `kode_merk`, `jenis_mesin`, `nama_model`, `lokasi`, `site`, `kategori_lokasi`, `garansi`, `hari_ops`, `jam_ops`, `waktu_ops`, `longitude`, `latitude`, `status`.

## Pemeriksaan

- `npm test`: 39 lulus, 0 gagal.
- Pemeriksaan sintaks modul JavaScript: lulus.
- Pemeriksaan keseimbangan kurung CSS: lulus.
