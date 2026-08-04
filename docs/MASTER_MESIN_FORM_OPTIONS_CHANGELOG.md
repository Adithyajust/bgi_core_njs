# Master Mesin — Penambahan Kategori Lokasi dan Waktu Operasional

## Opsi baru

Kategori Lokasi:

- `APOTEK`
- `TERAS BRI`
- `KANTOR PUSAT`

Waktu Operasional:

- `09:00 - 15:00`

## Area yang diperbarui

1. Dropdown form tambah/edit Master Mesin.
2. Filter Kategori Lokasi.
3. Validasi payload API tambah/edit.
4. Validasi upload Excel/CSV.
5. Normalisasi nilai upload:
   - `APOTIK` menjadi `APOTEK`;
   - `TERASBRI` menjadi `TERAS BRI`;
   - `KANTORPUSAT` menjadi `KANTOR PUSAT`;
   - `09.00-15.00`, `09.00–15.00`, dan variasi spasi menjadi `09:00 - 15:00`.
6. Template Excel dan dropdown pada kolom `kategori_lokasi` serta `waktu_ops`.
7. Pemeriksaan constraint sebelum import.
8. Pesan kesalahan khusus bila constraint database belum diperbarui.
9. Migration baru `019-add-master-mesin-location-and-time-options.sql`.

## Penerapan

Jalankan:

```powershell
npm run db:migrate
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run dev
```

Output migration harus memuat:

```text
APPLY 019-add-master-mesin-location-and-time-options.sql
Seluruh migration berhasil diterapkan.
```

Migration lama tidak diubah agar checksum pada `dbo.schema_migrations` tetap valid.

## Verifikasi database

```sql
SELECT name, definition, is_disabled, is_not_trusted
FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
  AND name IN (
    N'CK_master_mesin_kategori_lokasi',
    N'CK_master_mesin_waktu_ops'
  );
```

Pastikan definisi kategori memuat `APOTEK`, `TERAS BRI`, dan `KANTOR PUSAT`, sedangkan definisi waktu memuat `09:00 - 15:00`.

## Pengujian

`npm test` menghasilkan 49 pengujian lulus dan 0 gagal.
