# Konfigurasi Matrix Kunci Mesin

Dimensi matrix dibentuk secara dinamis dari tiga environment variable berikut.

```env
MACHINE_KEY_MATRIX_WALL_COUNT=5
MACHINE_KEY_MATRIX_COLUMN_COUNT=26
MACHINE_KEY_MATRIX_ROW_COUNT=15
```

Konfigurasi bawaan menghasilkan dinding A1–A5, kolom A–Z, baris 01–15, dan 1.950 slot pada setiap unit kerja.

Setelah migration `037-expand-machine-key-matrix.sql` dijalankan, skema basis data mendukung 1–9 dinding, 1–26 kolom, dan 1–99 baris. Mulai ulang aplikasi setelah mengubah environment variable. Pada deployment yang memasukkan environment saat build, lakukan build ulang agar konfigurasi klien dan server konsisten.

Jangan memperkecil dimensi sampai menghilangkan slot yang sudah berisi mapping. Pindahkan atau hapus mapping pada slot di luar dimensi baru terlebih dahulu.

Migration 037 juga menambahkan unique index pada `machine_id`, sehingga satu mesin hanya dapat memiliki satu mapping kunci. Pencarian mesin di form menggunakan satu query `NOT EXISTS`; mesin yang sudah dimapping tidak dikirim kembali ke daftar pilihan.
