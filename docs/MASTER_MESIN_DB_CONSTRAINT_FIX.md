# Perbaikan Constraint Kategori Lokasi Master Mesin

## Penyebab

Validasi browser dan API sudah menerima `PERTOKOAN`, tetapi SQL Server masih memakai constraint `CK_master_mesin_kategori_lokasi` versi lama. Akibatnya seluruh transaksi import dibatalkan dengan SQL error 547.

## Perubahan

1. Menambahkan migration `017-repair-master-mesin-kategori-lokasi.sql`.
2. Migration selalu membuat ulang constraint dengan daftar kategori baku, termasuk `PERTOKOAN`.
3. Alias `TOKO`, `AREA TOKO`, dan `AREA PERTOKOAN` dinormalisasi menjadi `PERTOKOAN`.
4. Endpoint import memeriksa kesesuaian kategori terhadap constraint database sebelum proses INSERT.
5. SQL error 547 yang menyebut constraint kategori lokasi sekarang menghasilkan pesan yang spesifik dan dapat ditindaklanjuti.

## Penerapan

```powershell
npm run db:migrate
```

Kemudian verifikasi melalui SQL Server:

```sql
SELECT
  cc.name,
  cc.definition,
  cc.is_disabled,
  cc.is_not_trusted
FROM sys.check_constraints cc
WHERE cc.parent_object_id = OBJECT_ID(N'dbo.master_mesin')
  AND cc.name = N'CK_master_mesin_kategori_lokasi';
```

Definisi constraint harus memuat `PERTOKOAN`, `is_disabled` harus `0`, dan `is_not_trusted` harus `0`.
