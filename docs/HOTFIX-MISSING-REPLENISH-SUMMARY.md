# Hotfix: Missing dbo.replenish_work_order_summary

## Gejala

SQL Server mengembalikan error 208:

```text
Invalid object name 'dbo.replenish_work_order_summary'.
```

Source aplikasi sudah menggunakan optimasi migration 031, sedangkan database aktif belum menerapkannya.

## Tindakan wajib

1. Hentikan aplikasi.
2. Pastikan `.env.local` mengarah ke database yang benar.
3. Jalankan:

```bash
npm run db:migrate
```

Output harus memuat:

```text
APPLY 031-replenish-production-scalability.sql
Seluruh migration berhasil diterapkan.
```

4. Verifikasi melalui SQL Server Management Studio:

```sql
SELECT DB_NAME() AS database_name;
SELECT OBJECT_ID(N'dbo.replenish_work_order_summary', N'U') AS summary_object_id;
SELECT OBJECT_ID(N'dbo.TR_replenish_work_orders_summary', N'TR') AS summary_trigger_id;
SELECT COL_LENGTH(N'dbo.replenish_work_orders', N'client_request_id') AS client_request_id_length;
SELECT version, applied_at
FROM dbo.schema_migrations
WHERE version = '031-replenish-production-scalability.sql';
```

Semua object ID dan panjang kolom harus tidak `NULL`, dan migration 031 harus tercatat.

## Recovery ketika migration tercatat tetapi object hilang

Jalankan hanya ketika `schema_migrations` memuat migration 031, tetapi tabel summary tidak tersedia:

```sql
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.replenish_work_order_summary', N'U') IS NULL
BEGIN
  DELETE FROM dbo.schema_migrations
  WHERE version = '031-replenish-production-scalability.sql';
END;

COMMIT TRANSACTION;
```

Kemudian jalankan ulang:

```bash
npm run db:migrate
```

Migration 031 bersifat idempoten terhadap object yang sudah berhasil dibuat.

## Compatibility mode

Endpoint GET Replenish sekarang mempunyai fallback ke agregasi tabel `replenish_work_orders` ketika summary table belum tersedia. Fallback mencegah HTTP 500, tetapi lebih mahal pada data besar. Compatibility mode bukan pengganti migration.

`GET /api/health/ready` akan mengembalikan HTTP 503 dan status `pending_migration` sampai migration 031 lengkap.

## Foto pegawai 404

Foto private tidak disertakan dalam ZIP source. Direktori berikut harus dipertahankan sebagai persistent storage ketika mengganti release:

```text
storage/private/pegawai
```

Salin file dari deployment lama atau backup ke direktori yang ditetapkan oleh:

```env
PEGAWAI_PHOTO_STORAGE_DIR=./storage/private/pegawai
```

Database saat ini masih mereferensikan nama file yang tidak tersedia. Jika file memang sudah hilang dan tidak akan dipulihkan, kosongkan referensinya secara selektif melalui menu Pegawai atau SQL setelah backup.
