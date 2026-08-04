# Perbaikan tombol aksi Upload Data Mesin

## Masalah
Footer modal yang berisi tombol **Batal** dan **Upload Mesin** berada setelah tabel pratinjau. Modal memakai `overflow: hidden`, tetapi elemen modal belum menggunakan layout flex. Akibatnya konten panjang mendorong footer melewati tinggi viewport lalu terpotong.

## Perbaikan
- Modal upload dijadikan flex container vertikal.
- Header dan footer dibuat tidak menyusut.
- Area isi/pratinjau menjadi satu-satunya bagian yang dapat di-scroll.
- Footer diberi latar dan bayangan atas agar tetap jelas saat tabel digulir.
- Scroll horizontal utama modal dinonaktifkan; tabel tetap memiliki scroll horizontal pada wrapper-nya.

Tidak ada perubahan API atau database.
