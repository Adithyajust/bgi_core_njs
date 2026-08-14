# Hotfix GET Mapping Kunci Mesin — SQL Server Error 130

## Gejala

Endpoint `GET /api/masters/kunci-mesin` mengembalikan HTTP 500 dengan SQL Server error 130:

`Cannot perform an aggregate function on an expression containing an aggregate or a subquery.`

## Penyebab

Query status sinkronisasi menghitung mesin belum dimapping menggunakan pola berikut:

```sql
SUM(CASE WHEN NOT EXISTS (SELECT ...) THEN 1 ELSE 0 END)
```

SQL Server tidak mengizinkan fungsi agregat membungkus ekspresi yang masih mengandung subquery.

## Perbaikan

Subquery `NOT EXISTS` dipindahkan menjadi `LEFT JOIN` terhadap `machine_key_mappings`. Nilai mesin belum dimapping dihitung melalui pemeriksaan kolom hasil join:

```sql
LEFT JOIN dbo.machine_key_mappings existing_mapping
  ON existing_mapping.machine_id = ms.id

SUM(
  CASE
    WHEN existing_mapping.machine_id IS NULL THEN 1
    ELSE 0
  END
) AS unmapped_machines
```

Unique index `UX_machine_key_machine` menjamin satu mesin paling banyak mempunyai satu mapping, sehingga join tidak menggandakan jumlah mesin.

## Dampak

- Endpoint daftar mapping kembali dapat dijalankan.
- Status sinkronisasi tetap menghitung mesin aktif dan mesin belum dimapping.
- Tidak ada perubahan struktur basis data.
- Tidak ada tambahan round-trip atau pola N+1.

## Validasi

- `node --check app/api/masters/kunci-mesin/route.js`: berhasil.
- `npm test`: 191 pengujian berhasil.
- Ditambahkan pengujian regresi yang melarang pola `SUM(... WHEN NOT EXISTS (...))` pada query status sinkronisasi.
