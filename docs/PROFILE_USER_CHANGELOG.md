# Penambahan Informasi Profil Pengguna

Perubahan utama terdapat pada:

- `components/header.jsx`
- `app/globals.css`

Fitur yang ditambahkan:

1. Nama pengguna dan role ditampilkan secara dinamis dari `/api/auth/me`.
2. Foto pegawai ditampilkan bila tersedia; jika tidak, digunakan inisial nama.
3. Klik bagian profil pada header untuk membuka rincian profil.
4. Rincian profil mencakup username, NIP, jabatan, unit kerja, email, dan nomor handphone.
5. Tersedia tombol `Ubah Password` dan `Logout` pada panel profil.
6. Panel tertutup ketika pengguna mengklik area luar atau menekan tombol Escape.
7. Tampilan responsif untuk desktop dan perangkat seluler.

Tidak diperlukan perubahan skema database karena `/api/auth/me` dan `serializeAuthenticatedUser()` sudah menyediakan data pegawai yang dibutuhkan.
