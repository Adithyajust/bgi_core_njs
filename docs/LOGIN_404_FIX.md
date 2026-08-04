# Perbaikan POST /api/auth/login 404

## Temuan

- Route login tersedia pada `app/api/auth/login/route.js` dan mengekspor fungsi `POST`.
- Log runtime menyebut `proxy.ts`, tetapi file tersebut tidak terdapat dalam source ZIP. Ini menunjukkan aplikasi yang dijalankan tidak identik dengan source ZIP atau terdapat `proxy.ts` lain pada folder proyek aktif.
- Status 404 mengembalikan halaman HTML. Pemanggilan `response.json()` pada halaman login kemudian menghasilkan `Unexpected token '<'`.

## Langkah penerapan

1. Hentikan `npm run dev`.
2. Pastikan terminal berada pada folder yang memuat `package.json` dan folder `app`.
3. Hapus atau ganti `proxy.ts` lama. Jangan menyimpan `proxy.ts` dan `proxy.js` bersamaan. Gunakan `proxy.js` dari paket ini, atau pastikan matcher Proxy lama mengecualikan `/api`.
4. Hapus cache build: PowerShell `Remove-Item -Recurse -Force .next` atau CMD `rmdir /s /q .next`.
5. Jalankan kembali `npm run dev`.
6. Buka `http://localhost:3000/api/auth/me`. Endpoint harus mengembalikan JSON dengan status 401 bila belum login, bukan halaman HTML 404.
7. Uji login kembali.

## Verifikasi route pada build

Sesudah server pernah dijalankan, cari `/api/auth/login/route` di `.next/server/app-paths-manifest.json`. Bila tidak ada, server dijalankan dari folder/source yang salah atau route tidak ikut tersalin.
