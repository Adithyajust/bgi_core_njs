# Hardening Changelog

## Migration

- Menambahkan baseline schema yang dapat membangun database kosong.
- Menambahkan adapter untuk schema initializer lama.
- Menonaktifkan akun demo persis dari initializer lama.
- Menambahkan tabel `schema_migrations`, checksum SHA-256, transaction, dan SQL Server application lock.
- Menambahkan migration permission CRUD, rate limit, audit log, dan index Master Mesin.

## Security

- TLS, certificate trust, pool, dan timeout SQL Server dikendalikan melalui environment.
- Security headers ditambahkan pada Next.js.
- Same-origin validation memakai Origin, Referer, dan Sec-Fetch-Site.
- Dual rate limit login dan rate limit perubahan password.
- Mandatory password change kini benar-benar diberlakukan.
- Session lain dicabut setelah password berubah.
- Session activity write dibatasi sekali setiap lima menit.
- Foto pegawai dipindahkan ke private storage dengan pemeriksaan magic byte dan authorization.
- Liveness dan readiness endpoint ditambahkan.

## Permission

- Permission dipisahkan menjadi view, create, update, dan delete.
- API memeriksa permission aksi, bukan hanya visibilitas tombol UI.
- Halaman User Role dapat mengatur empat permission tersebut.

## Query Pattern

- Master Mesin memakai keyset pagination.
- TID dan SN memprioritaskan exact serta prefix search.
- Summary dipisahkan dari list query.
- Autocomplete memakai server-side search dan cursor.
- Update Master Mesin memakai optimistic concurrency dengan ROWVERSION.

## Structure

- Logic Master Mesin dipisahkan menjadi constants, validation, dan search module.
- Utility pagination dan permission dibuat reusable.
- Password policy dibuat sebagai module bersama.
- Alias `@/*` didefinisikan melalui `jsconfig.json`.

## Testing and Delivery

- Menambahkan 18 unit dan production guardrail tests.
- Menambahkan GitHub Actions untuk test, lint, build, dan migration test pada SQL Server 2022.
- Menambahkan dokumentasi production deployment dan hardening.
