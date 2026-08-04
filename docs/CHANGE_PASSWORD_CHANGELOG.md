# Form Ubah Password

Perubahan utama:

- Halaman `/change-password` kini dapat dibuka oleh seluruh pengguna yang sudah login, tidak hanya akun dengan `must_change_password = 1`.
- Form terdiri dari password saat ini, password baru, dan konfirmasi password baru.
- Validasi langsung mengikuti kebijakan server: panjang 10–72 karakter, huruf kecil, huruf besar, angka, karakter khusus, dan tidak mengandung username.
- Ditambahkan tombol tampilkan/sembunyikan password, validasi konfirmasi, pesan kesalahan per kolom, status proses, dan notifikasi berhasil.
- Pengguna yang diwajibkan mengganti password tidak memperoleh tombol Batal.
- Setelah berhasil, sesi pengguna lain dicabut oleh endpoint yang sudah tersedia dan pengguna diarahkan kembali ke dashboard.
- Respons endpoint non-JSON ditangani agar tidak lagi menghasilkan error `Unexpected token '<'`.

File yang diperbarui:

- `app/change-password/page.jsx`
- `app/globals.css`

Endpoint yang digunakan dan dipertahankan:

- `POST /api/auth/change-password`
