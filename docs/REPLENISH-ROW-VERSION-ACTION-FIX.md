# Replenish Action Row-Version Fix

## Masalah

Aksi **Ajukan/Setujui/Tolak/Batal** dari tabel dapat mengirim `row_version` kosong atau dalam bentuk Buffer-like object. Endpoint PATCH kemudian menolak request dengan pesan *Versi data work order tidak valid*.

## Perbaikan

1. Endpoint daftar menormalisasi seluruh token menjadi `0x` + 16 digit heksadesimal.
2. Frontend memvalidasi token sebelum PATCH dan mengambil detail terbaru bila token list tidak valid.
3. Endpoint PATCH memakai token row yang sudah dikunci dalam transaksi hanya bila token client kosong/tidak valid. Token client yang valid tetapi stale tetap ditolak oleh optimistic locking.
4. Tidak ada perubahan database atau migration baru.
