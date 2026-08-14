# Laporan Perbaikan Production BGI Core

## Kesimpulan

Source code telah dipatch pada jalur kritis keamanan dan performa. Perubahan utama mengurangi jumlah roundtrip SQL pada create Replenish, menghilangkan insert detail N+1, mempersempit cakupan locking, menambahkan idempotensi, mengubah summary menjadi pre-aggregated, membuat audit atomik, serta memperketat perimeter HTTP, sesi, SQL TLS, private storage, dan pipeline supply-chain.

Tidak ada sistem yang dapat dijamin 100% bebas celah keamanan atau bottleneck hanya melalui static review. Paket ini harus diperlakukan sebagai hardened release candidate dan tetap memerlukan pengujian pada SQL Server serta topologi production yang sebenarnya.

## Perubahan utama

1. `modules/replenish/database.js`
   - Batch insert titik melalui `OPENJSON`.
   - Validasi referensi dalam satu batch.
   - Lock jadwal memakai `sp_getapplock` dengan urutan konsisten.
   - Query konflik kendaraan dan pegawai dipisah.
   - Detail work order dibaca dalam satu request multi-resultset.

2. API Replenish
   - `READ_COMMITTED` dan row lock terarah menggantikan `SERIALIZABLE` menyeluruh.
   - `Idempotency-Key` UUID wajib pada create.
   - Retry deadlock/timeout terbatas untuk create yang idempoten.
   - Audit ditulis di transaksi yang sama.
   - List dan summary dibaca dalam satu batch.
   - Prefix search menggantikan leading-wildcard search.

3. Database migration 031
   - Unique idempotency index.
   - Index pagination dan conflict lookup.
   - Tabel serta trigger summary inkremental.
   - Cleanup procedure untuk rate limit dan session.

4. Keamanan aplikasi
   - CSP nonce, HSTS, anti-framing, no-sniff, origin validation, request-size limit.
   - Proxy header hanya dipercaya saat dikonfigurasi.
   - SQL TLS fail-closed pada production.
   - Dummy bcrypt untuk mengurangi username timing enumeration.
   - Maksimum sesi aktif dan lock pembuatan sesi per pengguna.
   - Private employee files dikeluarkan dari source.
   - Public readiness tidak mengungkap pool database.

5. Deployment guardrails
   - Node.js 22.
   - `.env.example`, `.gitignore`, `.dockerignore`, Dockerfile non-root.
   - GitHub Actions CI, npm production audit, CodeQL, Dependabot.
   - Script verifikasi database dan script load test.

## Hasil validasi lokal

- JavaScript/MJS syntax check: lulus.
- Source/unit regression test: 121/121 lulus.
- Integritas arsip ZIP: lulus.
- Pemeriksaan route API: seluruh route non-health memiliki authentication/authorization atau origin guard.
- `npm ci`, lint, npm audit, dan production build tidak dapat diselesaikan pada runtime ini karena akses registry npm mengalami DNS `EAI_AGAIN`. Pipeline CI telah ditambahkan agar empat pemeriksaan tersebut menjadi release gate pada environment yang memiliki akses registry.

## Urutan deployment

1. Gunakan Node.js 22 dan secret manager.
2. Backup database dan lakukan restore test.
3. Jalankan `npm ci`, audit, lint, test, dan build melalui CI.
4. Jalankan migration 031 pada maintenance window.
5. Jalankan `scripts/ops/verify-replenish-production.sql`.
6. Jadwalkan cleanup rate limit dan session.
7. Deploy canary, lalu jalankan load test serta DAST.
8. Lanjutkan rolling deployment hanya bila SLA, error rate, pool pending, dan lock wait memenuhi ambang organisasi.

## Risiko residual yang harus divalidasi

- Kapasitas SQL Server, latency jaringan, distribusi data, dan jumlah instance dapat mengubah titik saturasi.
- Trigger summary menambah operasi O(1) pada setiap perubahan work order; overhead harus diukur pada beban write aktual.
- Search deskriptif lintas lokasi masih perlu diuji dengan execution plan dan dapat dipindahkan ke full-text/search service bila volumenya sangat besar.
- Rate limiter SQL memadai untuk skala kecil-menengah. Pada banyak instance atau serangan login tinggi, gunakan Redis atau rate limiter pada API gateway.
- Private storage lokal memerlukan persistent shared storage atau object storage pada deployment multi-instance.
