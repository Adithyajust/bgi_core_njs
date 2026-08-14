# Perubahan Sinkronisasi Otomatis Mapping Kunci Mesin

## Ringkasan

Menu **Sinkronisasi** ditambahkan pada halaman Mapping Set Kunci dan Matrix. Fitur ini memetakan seluruh mesin aktif yang belum memiliki mapping ke slot matrix kosong secara otomatis dan berurutan.

## Urutan pengisian

Urutan default bersifat deterministik:

1. Dinding A1 diproses terlebih dahulu.
2. Pada setiap dinding, sistem mengisi baris 01 dari kolom A sampai Z.
3. Sistem melanjutkan ke baris 02 sampai 15.
4. Setelah dinding A1 penuh, sistem melanjutkan ke A2, A3, A4, dan A5.
5. Dimensi tetap mengikuti konfigurasi dinamis `MACHINE_KEY_MATRIX_WALL_COUNT`, `MACHINE_KEY_MATRIX_COLUMN_COUNT`, dan `MACHINE_KEY_MATRIX_ROW_COUNT`.

Slot yang sudah terisi tidak diubah. Apabila terdapat lubang pada urutan awal, slot kosong tersebut akan diprioritaskan sebelum slot berikutnya.

## Aturan mapping otomatis

- Hanya mesin aktif yang belum mempunyai mapping yang diproses.
- Jenis set kunci otomatis: `REPLENISH`.
- Kode fungsi: `R`.
- Kunci tombak dan fascia: tersedia.
- Status awal: `IN`.
- Barcode dibentuk di server dan diperiksa terhadap unique index.
- Apabila kapasitas tidak mencukupi, sistem memetakan sebanyak slot yang tersedia dan melaporkan jumlah TID yang tersisa.

## Ketahanan proses besar

Implementasi tidak melakukan satu `INSERT` untuk setiap mesin dari JavaScript. Seluruh assignment dan insert dilakukan secara set-based dalam satu request SQL menggunakan:

- `OPENJSON` untuk membentuk dimensi matrix;
- table variable untuk slot, mesin, assignment, dan barcode;
- satu `INSERT ... SELECT` untuk seluruh mapping;
- transaksi `SERIALIZABLE`;
- `sp_getapplock` per unit kerja;
- `UPDLOCK` dan `HOLDLOCK` pada unique index mesin, slot, dan barcode;
- satu audit log batch di dalam transaksi yang sama.

Pendekatan ini menghindari N+1 dan mengurangi round-trip database saat ribuan TID diproses.

## Endpoint baru

```text
POST /api/masters/kunci-mesin/synchronize
```

Payload untuk pengguna biasa:

```json
{
  "scope_machine_id": null
}
```

Untuk Super Admin, `scope_machine_id` wajib berisi ID salah satu mesin pada unit kerja yang akan diproses.

## Berkas yang berubah

- `app/api/masters/kunci-mesin/route.js`
- `app/api/masters/kunci-mesin/synchronize/route.js`
- `app/masters/kunci-mesin/page.jsx`
- `app/globals.css`
- `tests/machine-key-synchronization.test.mjs`

## Basis data

Tidak diperlukan migration baru. Fitur menggunakan struktur dan indeks yang telah dibuat oleh migration 036 dan 037.

## Validasi

- 190 pengujian berhasil.
- Route API lulus `node --check`.
- JSX lulus parse/transpile TypeScript.
