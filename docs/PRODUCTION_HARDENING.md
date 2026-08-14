# Production Hardening BGI Core

Dokumen ini menjelaskan baseline keamanan, skalabilitas, deployment, dan verifikasi untuk source code hasil hardening.

## Status

Source telah diperbaiki untuk mengatasi temuan kritis pada transaksi Replenish, autentikasi, akses SQL Server, request perimeter, private storage, serta pipeline deployment. Perubahan ini tidak dapat dianggap sebagai jaminan bahwa aplikasi bebas dari seluruh kerentanan atau bottleneck pada semua kondisi. Release production tetap harus melewati migration test pada SQL Server target, load test dengan data representatif, dynamic application security testing, dan canary deployment.

## Runtime dan environment

Gunakan Node.js 22 dan instalasi deterministik melalui `npm ci`. Seluruh secret harus berasal dari secret manager, bukan file repository.

Konfigurasi minimum production:

```env
NODE_ENV=production
APP_ORIGIN=https://bgi.example.co.id
SECURITY_REQUIRE_ORIGIN=true
SECURITY_TRUST_PROXY_HEADERS=true
SECURITY_MAX_API_BODY_BYTES=10485760
SESSION_MAX_ACTIVE_PER_USER=5

MSSQL_ENCRYPT=true
MSSQL_TRUST_SERVER_CERTIFICATE=false
MSSQL_POOL_MAX=20
MSSQL_POOL_MIN=2
MSSQL_REQUEST_TIMEOUT_MS=30000
PEGAWAI_PHOTO_STORAGE_DIR=/var/lib/bgi-core/pegawai
```

`SECURITY_TRUST_PROXY_HEADERS=true` hanya boleh digunakan bila reverse proxy menghapus header forwarding dari client dan menulis ulang header tersebut. `APP_ORIGIN` harus berisi origin tunggal yang benar, termasuk skema HTTPS.

## Perubahan performa transaksi

Jalur Replenish telah diubah sebagai berikut:

- Detail ATM/CRM disimpan melalui satu operasi set-based `OPENJSON`, bukan satu query per titik.
- Detail work order, titik, tim, dan histori dibaca dalam satu batch SQL, bukan empat request koneksi.
- Daftar dan summary dikembalikan melalui satu batch SQL.
- Summary global tidak lagi dihitung dari seluruh tabel pada setiap request. Migration 031 membuat tabel ringkasan yang dipelihara secara inkremental oleh trigger.
- Validasi benturan kendaraan dan pegawai menggunakan indeks terpisah serta `sp_getapplock` dengan urutan resource deterministik.
- Transaksi menggunakan `READ_COMMITTED` dengan row lock terarah, bukan `SERIALIZABLE` untuk seluruh alur.
- Create work order wajib menggunakan `Idempotency-Key` UUID dan dilindungi unique index.
- Deadlock/lock timeout create di-retry secara terbatas dan aman karena idempotensi.
- Pencarian identifier menggunakan prefix search agar indeks dapat dimanfaatkan.
- Audit transaksi ditulis di dalam transaksi bisnis yang sama.

## Perubahan keamanan

- Validasi Origin/Referer terhadap `APP_ORIGIN` untuk request mutasi.
- Header CSP nonce, HSTS, frame denial, no-sniff, referrer policy, permissions policy, COOP, dan CORP.
- Batas body global dan bounded JSON reader pada seluruh endpoint JSON.
- SQL Server production menolak `trustServerCertificate=true` dan memerlukan konfigurasi database eksplisit.
- Header proxy dan request ID hanya dipercaya bila konfigurasi proxy diaktifkan.
- Token sesi acak 256-bit disimpan dalam bentuk hash.
- Pencarian sesi dan touch aktivitas digabung menjadi satu batch database.
- Pembuatan sesi diserialisasi per pengguna dan jumlah sesi aktif dibatasi.
- Login username tidak dikenal tetap menjalankan bcrypt dummy untuk mengurangi timing enumeration.
- Rate limit login berbasis IP dan akun tetap aktif, dengan cleanup dipindahkan dari hot path ke stored procedure terjadwal.
- Foto pegawai dikeluarkan dari source package dan private storage.
- Readiness endpoint tidak mengekspos statistik pool atau pesan internal database.

## Migration

Jalankan migration dengan akun deployment terpisah yang memiliki hak DDL. Akun aplikasi runtime sebaiknya hanya memiliki hak DML dan execute yang diperlukan.

```bash
npm run db:migrate
```

Migration `031-replenish-production-scalability.sql` menambahkan idempotency column/index, indeks konflik dan pagination, tabel ringkasan, trigger ringkasan, serta prosedur cleanup rate limit dan session.

Pada database besar, jalankan migration dalam maintenance window karena pembuatan indeks dan backfill summary dapat mengunci atau menggunakan I/O signifikan. Backup dan uji restore wajib dilakukan sebelum migration.

Setelah migration:

```bash
sqlcmd -S "$MSSQL_SERVER" -d "$MSSQL_DATABASE" -i scripts/ops/verify-replenish-production.sql
```

Jadwalkan prosedur berikut melalui SQL Server Agent atau scheduler operasional minimal satu kali per hari:

```sql
EXEC dbo.cleanup_security_rate_limits @retention_days = 2, @batch_size = 5000;
EXEC dbo.cleanup_user_sessions @revoked_retention_days = 7, @batch_size = 5000;
```

## CI dan container

Repository menyediakan:

- `.github/workflows/ci.yml`: install deterministik, audit production dependencies, lint, test, migration SQL Server 2022, dan build.
- `.github/workflows/codeql.yml`: static security analysis.
- `.github/dependabot.yml`: pembaruan dependency dan GitHub Actions.
- `Dockerfile`: multi-stage image, Next.js standalone, dan runtime non-root.

Migration tidak dijalankan otomatis saat container aplikasi dimulai. Jalankan migration sebagai deployment job tunggal sebelum rolling/canary deployment.

## Uji beban

Gunakan akun dan database khusus non-production:

```bash
LOAD_BASE_URL=https://staging.example.co.id \
LOAD_SESSION_COOKIE='<nilai-cookie>' \
LOAD_CONCURRENCY=50 \
LOAD_DURATION_SECONDS=60 \
LOAD_MAX_P95_MS=1000 \
node scripts/load/replenish-list-load.mjs
```

Minimal uji:

1. Daftar Replenish dengan 1 juta work order dan distribusi per unit kerja yang realistis.
2. Create/update bersamaan pada tanggal, kendaraan, dan pegawai yang sama untuk memverifikasi conflict handling.
3. Create bersamaan pada resource berbeda untuk mengukur throughput tanpa false serialization.
4. Pool saturation pada jumlah instance production yang direncanakan.
5. Failover SQL, timeout, deadlock, retry, dan idempotent replay.

Target awal yang disarankan untuk staging adalah error rate di bawah 1%, p95 daftar di bawah 1 detik, tidak ada duplicate semantic transaction, dan tidak ada pertumbuhan antrean pool yang terus-menerus. Target final harus disesuaikan dengan SLA organisasi dan kapasitas SQL Server.

## Release gate

Release production hanya dilanjutkan bila seluruh kondisi berikut terpenuhi:

- `npm ci`, `npm audit --omit=dev --audit-level=high`, lint, 121 test, migration test, dan production build lulus di CI.
- Script verifikasi database menghasilkan `OK`.
- Execution plan tidak menunjukkan table scan besar pada query daftar dan konflik untuk data representatif.
- Load test memenuhi SLA dan tidak menghasilkan deadlock berulang, timeout, atau pool pending yang meningkat.
- DAST dan pengujian otorisasi horizontal/vertikal lulus.
- Backup, restore, rollback aplikasi, dan prosedur respons insiden telah diuji.
