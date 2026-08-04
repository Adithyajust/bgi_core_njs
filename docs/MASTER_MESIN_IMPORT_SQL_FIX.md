# Perbaikan Import Master Mesin — Invalid column name 'N'

## Penyebab
Query pemeriksaan CHECK constraint `CK_master_mesin_waktu_ops` membentuk pencarian literal SQL dengan sintaks yang salah:

```sql
N + LTRIM(RTRIM(source.waktu_ops)) + N
```

SQL Server menafsirkan `N` sebagai nama kolom, sehingga request gagal dengan error 207 `Invalid column name 'N'` sebelum proses insert dimulai.

## Perbaikan
Literal tanda petik sekarang dibentuk secara eksplisit menggunakan `NCHAR(39)`:

```sql
NCHAR(39) + LTRIM(RTRIM(source.waktu_ops)) + NCHAR(39)
```

Pemeriksaan kategori lokasi juga diseragamkan menggunakan pola yang sama agar tidak bergantung pada escaping tanda petik berlapis.

## Dampak
- Tidak ada perubahan skema database.
- Tidak perlu migration baru.
- Validasi constraint waktu operasional tetap berjalan sebelum insert.
- Transaksi import dan validasi TID/SN tetap dipertahankan.
