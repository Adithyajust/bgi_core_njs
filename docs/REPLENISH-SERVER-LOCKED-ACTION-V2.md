# Replenish lifecycle action protocol V2

Aksi `SUBMIT`, `APPROVE`, `REJECT`, dan `CANCEL` tidak lagi menerima atau membutuhkan `row_version` dari browser.

Server melakukan langkah berikut dalam satu transaksi `SERIALIZABLE`:

1. Mengunci work order menggunakan `UPDLOCK, HOLDLOCK`.
2. Membaca `row_version` asli sebagai binary 8 byte.
3. Memvalidasi status, ownership, maker-checker, dan permission.
4. Melakukan update menggunakan token binary yang dibaca dari row terkunci.
5. Menulis status history dan audit trail.

Respons sukses menyertakan header dan data marker `SERVER_LOCKED_V2`. Jika browser masih menerima pesan `Versi data work order tidak valid`, server masih menjalankan build lama atau request yang dikirim bukan `PATCH`. Hapus cache build `.next`, restart proses Node/PM2, dan periksa method request di Network tab.
