# Perbaikan tipe employee_id Replenish

## Masalah

Migration awal mendefinisikan `replenish_team_members.employee_id` sebagai `INT`.
Pada database legacy tertentu, `dbo.pegawai.id` menggunakan `BIGINT`. SQL Server
mensyaratkan kolom foreign key memiliki tipe yang sama dengan kolom tujuan,
sehingga pembuatan `FK_replenish_team_employee` gagal dengan error 1778.

## Perbaikan

Migration `025z-replenish-pegawai-id-compatibility.sql` dijalankan sebelum
migration `026-replenish-work-order-core.sql`. Migration tersebut:

- membaca tipe aktual `dbo.pegawai.id` dari katalog SQL Server;
- mendukung `TINYINT`, `SMALLINT`, `INT`, `BIGINT`, `DECIMAL`, dan `NUMERIC`
  dengan skala nol;
- membuat `replenish_team_members.employee_id` menggunakan tipe yang sama;
- memperbaiki tabel yang sudah terlanjur dibuat dengan tipe berbeda;
- memvalidasi data orphan sebelum memasang foreign key;
- tetap aman dijalankan berulang kali.

Binding parameter anggota tim pada API juga diubah menjadi `sql.BigInt` agar
kompatibel dengan database legacy yang menggunakan identitas pegawai `BIGINT`.

## Penerapan

Jalankan kembali:

```bash
npm run db:migrate
```

Migration 026 yang sebelumnya gagal tidak tercatat pada `schema_migrations`,
sehingga akan dicoba kembali setelah migration kompatibilitas berhasil.
