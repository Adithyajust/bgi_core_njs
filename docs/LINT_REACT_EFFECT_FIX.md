# Perbaikan lint React 19

Perubahan:

- `app/masters/kendaraan/page.jsx`
  - Reset status loading/error dijadwalkan melalui `queueMicrotask`, sehingga tidak ada pemanggilan setter state secara sinkron di badan effect.
  - Penutupan modal pada tombol Escape dilakukan langsung di effect agar dependency effect lengkap tanpa menangkap fungsi yang berubah setiap render.

- `app/masters/project/page.jsx`
  - Reset status loading/error dijadwalkan melalui `queueMicrotask`.

- `components/header.jsx`
  - Menghapus effect yang mereset kegagalan gambar.
  - Status kegagalan disimpan berdasarkan URL foto (`failedPhoto`). Saat URL berubah, foto baru otomatis dicoba tanpa setter di effect.
  - Mengganti elemen `<img>` dengan `next/image` menggunakan `unoptimized` agar foto lokal/dinamis tidak diproses optimizer.
