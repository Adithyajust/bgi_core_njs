# Production Hardening

Dokumen ini menjelaskan perubahan production hardening, cara deployment, dan batas pengujian proyek.

## 1. Persyaratan Runtime

- Node.js 20.9 sampai sebelum Node.js 25.
- SQL Server dengan koneksi TLS untuk production.
- Direktori private storage yang dapat ditulis oleh proses aplikasi.
- Reverse proxy atau load balancer yang meneruskan header `X-Forwarded-For` secara tepercaya.

## 2. Environment Production

Salin `.env.example` ke secret manager atau environment deployment. Jangan menyimpan `.env` production di repository.

Konfigurasi minimum:

```env
NODE_ENV=production
MSSQL_ENCRYPT=true
MSSQL_TRUST_SERVER_CERTIFICATE=false
MSSQL_POOL_MAX=20
MSSQL_REQUEST_TIMEOUT_MS=30000
PEGAWAI_PHOTO_STORAGE_DIR=/var/lib/cro-njs/private/pegawai
```

Gunakan akun database dengan hak minimum. Akun runtime tidak perlu memiliki hak membuat database. Jalankan migration dengan akun deployment terpisah jika organisasi menerapkan separation of duties.

## 3. Migration

Migration disimpan di `scripts/migrations` dan dijalankan berdasarkan urutan nama file.

```bash
npm run db:migrate
```

Runner akan:

1. Membuat database jika belum tersedia.
2. Membuat tabel `schema_migrations`.
3. Menghitung SHA-256 setiap migration.
4. Menolak migration yang sudah pernah dijalankan tetapi kemudian diubah.
5. Menjalankan migration baru satu kali dan mencatat checksum.

Jangan mengubah file migration yang sudah diterapkan. Buat file migration baru untuk setiap perubahan schema.

Tidak ada akun dengan password default. Buat Super Admin pertama melalui:

```bash
npm run create:superadmin
```

Berikan kredensial melalui input aman pada terminal deployment, bukan melalui source code.

## 4. Permission

Permission menu terdiri dari:

- `can_view`
- `can_create`
- `can_update`
- `can_delete`

API memeriksa permission berdasarkan aksi HTTP. Menyembunyikan tombol pada UI bukan kontrol keamanan. Route mutation tetap memeriksa permission di server.

Perubahan permission memerlukan `can_update` pada `/settings`. Super Admin tetap memperoleh seluruh permission.

## 5. Security Controls

Kontrol yang ditambahkan:

- Session token disimpan sebagai hash.
- Akun dengan `must_change_password` tidak dapat membuka modul sebelum mengganti password.
- Setelah password diganti, seluruh session lain milik akun tersebut dicabut.
- Pembaruan aktivitas session dibatasi maksimal sekali setiap lima menit.
- Validasi same-origin untuk request yang mengubah data.
- Dual rate limit login berbasis IP dan kombinasi IP serta username.
- Security headers, termasuk CSP, HSTS, frame denial, no-sniff, referrer policy, dan permissions policy.
- TLS SQL Server dapat diwajibkan melalui environment.
- Audit log untuk perubahan Master Mesin.
- Foto pegawai disimpan di private storage dan dibaca melalui route terautentikasi.
- Validasi magic byte untuk file foto.

Pastikan reverse proxy menghapus header `X-Forwarded-For` dari client dan menulis nilainya sendiri. Tanpa konfigurasi ini, IP rate limiting dapat dipalsukan.

## 6. Query Pattern Master Mesin

Master Mesin menggunakan:

- Server-side autocomplete dengan `q`, `limit`, `after_id`, dan `selected_id`.
- Keyset pagination pada daftar utama.
- Exact dan prefix search untuk TID serta SN.
- Pencarian deskriptif terpisah untuk lokasi dan label relasi.
- Endpoint summary terpisah dari endpoint list.
- Optimistic concurrency menggunakan `ROWVERSION`.

Update yang memakai row version lama mengembalikan HTTP `409 Conflict` agar perubahan pengguna lain tidak tertimpa.

## 7. Health Check

- `GET /api/health/live` untuk liveness proses.
- `GET /api/health/ready` untuk readiness dan koneksi database.

Jangan memakai readiness sebagai endpoint monitoring publik tanpa pembatasan jaringan. Response tidak menampilkan detail koneksi atau pesan error database.

## 8. Testing

Jalankan:

```bash
npm test
npm run lint
npm run build
```

Test saat ini mencakup:

- Mapping permission dan aksi HTTP.
- Normalisasi pagination.
- Search term dan wildcard escaping.
- Validasi data Master Mesin.
- Production guardrails untuk query, permission, default password, dan private photo storage.

Tambahkan integration test dengan SQL Server disposable sebelum release. Unit test tidak dapat membuktikan migration dan query T-SQL berjalan pada versi SQL Server target.

## 9. Deployment Checklist

1. Buat dan commit `package-lock.json`, lalu gunakan `npm ci`.
2. Jalankan test dan build pada CI.
3. Backup database sebelum migration.
4. Jalankan migration hanya satu kali dari deployment job.
5. Gunakan rolling deployment setelah readiness berhasil.
6. Pastikan private storage persisten dan tersedia pada seluruh instance, atau ganti dengan object storage.
7. Jalankan `npm run storage:migrate-pegawai-photos` untuk instalasi lama, lalu aktifkan TLS antara aplikasi dan SQL Server.
8. Batasi endpoint health pada jaringan monitoring.
9. Kirim log aplikasi dan audit ke penyimpanan terpusat.
10. Uji restore backup, bukan hanya proses backup.

## 10. Batas Saat Ini

- Private storage lokal memerlukan shared persistent volume pada multi-instance deployment. Object storage tetap pilihan yang lebih baik.
- Rate limiter SQL Server sesuai untuk skala kecil sampai menengah. Gunakan Redis ketika request autentikasi atau jumlah instance meningkat tajam.
- Beberapa halaman lama masih memiliki komponen besar. Master Mesin sudah mulai dipisahkan menjadi constants, validation, search, dan pagination utility.
- Workflow `.github/workflows/ci.yml` menyediakan unit test, lint, build, dan migration test menggunakan SQL Server 2022.
- End-to-end test browser masih perlu ditambahkan untuk alur bisnis utama.

## 11. Upgrade dari Initializer Lama

Migration `000-00-legacy-schema-bridge.sql` mengadaptasi tabel `roles` dan `users` dari initializer lama. Akun demo persis `Admin Demo`, `Manager Corporate`, dan `Operator Cabang` dinonaktifkan karena initializer lama memakai password statis. Migration `000-z-legacy-menu-permissions.sql` memindahkan akses menu lama menjadi `can_view`. Hak create, update, dan delete harus diberikan ulang melalui halaman User Role.
