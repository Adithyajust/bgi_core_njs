# Migration troubleshooting

## Invalid column name `updated_at` pada `000-core-schema.sql`

Penyebabnya adalah database lama sudah memiliki `sidebar_routes`, `navbar_routes`, atau
`role_sidebar_routes`, tetapi struktur tabel tersebut belum sama dengan baseline terbaru.
Karena tabel sudah ada, `000-core-schema.sql` tidak membuat ulang tabel tersebut lalu langsung
menjalankan `MERGE` yang memakai `updated_at`.

Perbaikannya tersedia pada migration:

```text
scripts/migrations/000-01-legacy-navigation-bridge.sql
```

Migration ini berjalan sebelum `000-core-schema.sql` dan menambahkan kolom serta default yang
belum tersedia. Migration yang sebelumnya berhasil tetap dipertahankan dan tidak perlu dihapus
dari `dbo.schema_migrations`.

Jalankan kembali:

```bash
npm run db:migrate
```

Migration yang sudah berhasil akan berstatus `SKIP`. Migration yang sebelumnya gagal tidak
tercatat karena transaction telah di-rollback, sehingga akan dijalankan kembali.

Untuk memeriksa urutan dan status migration:

```sql
SELECT version, checksum, applied_at
FROM dbo.schema_migrations
ORDER BY applied_at, version;
```

Jangan menghapus tabel atau seluruh database hanya untuk mengatasi error ini. Buat backup sebelum
menjalankan perubahan schema pada database production.

## Error 515 pada `dbo.roles.updated_at`

Pesan:

```text
Cannot insert the value NULL into column 'updated_at', table 'dbo.roles'.
```

Penyebabnya adalah tabel `roles` versi lama mempunyai kolom timestamp `NOT NULL`
tanpa `DEFAULT` constraint. Migration `000-02-legacy-role-defaults.sql` menambahkan
default untuk `is_active`, `created_at`, dan `updated_at` sebelum core schema
menjalankan `MERGE` data role.
