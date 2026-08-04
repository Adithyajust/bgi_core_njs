# Replenish Admin CRO Submit Button Fix

## Masalah

Admin CRO dapat membuat dan menyimpan Work Order sebagai Draft, tetapi tombol
`Ajukan` dan `Simpan & Ajukan` tidak tampil ketika role legacy hanya memiliki
permission `can_create = 1` dan `can_update = 0` pada menu `/transactions`.

UI sebelumnya mensyaratkan `can_update` untuk mengajukan draft. Endpoint PATCH
juga hanya menerima permission `update`, sehingga draft yang sah tidak dapat
masuk ke antrian Manager Operasional.

## Perbaikan

1. Aksi lifecycle milik maker (`SUBMIT` dan `CANCEL`) dapat menggunakan salah
   satu permission `create` atau `update`.
2. Ownership tetap diperiksa: hanya pembuat Work Order atau Super Admin yang
   dapat mengajukan/membatalkan draft.
3. Tombol `Ajukan` ditampilkan pada tabel dan modal Detail untuk Draft/Ditolak.
4. Tombol `Simpan & Ajukan` ditampilkan saat pembuatan Work Order jika pengguna
   memiliki permission create.
5. Aksi approval (`APPROVE`/`REJECT`) tetap membutuhkan permission update dan
   identitas Manager Operasional/Manager CRO/Asisten Manager CRO.

## Dampak keamanan

Fallback permission tidak memberi akses ke Work Order pengguna lain karena API
masih memvalidasi `created_by`, status, unit kerja, row version, dan audit trail.
