HOTFIX VIEWER PDF SURAT TUGAS

Masalah:
- PDF sudah tersimpan, tetapi halaman menampilkan teks "Browser tidak dapat menampilkan PDF".
- Penyebabnya adalah halaman memakai elemen <object>, sedangkan Content Security Policy aplikasi menetapkan object-src 'none'.

Perbaikan:
1. Viewer diubah dari <object> menjadi <iframe> same-origin.
2. Endpoint PDF secara khusus diizinkan untuk ditampilkan oleh halaman pada origin aplikasi yang sama.
   Kebijakan object-src tetap 'none' untuk seluruh route lain, tetapi menjadi 'self'
   hanya pada endpoint PDF karena viewer PDF bawaan Chrome menggunakan renderer plugin.
3. Endpoint PDF mendukung HTTP byte range (206 Partial Content) agar viewer PDF browser dapat memuat file secara stabil.
4. Kebijakan X-Frame-Options DENY tetap berlaku pada route lain. Hanya endpoint PDF Surat Tugas yang memakai SAMEORIGIN.
5. File PDF yang sudah tersimpan tetap digunakan; tidak perlu membentuk ulang PDF dan tidak ada pembacaan ulang data transaksi.

Cara memasang:
- Salin isi folder hotfix ke root project dan timpa file yang sama.
- Tidak perlu menjalankan migration database.
- Restart proses Next.js.
- Lakukan hard refresh browser (Ctrl+F5).

File yang berubah:
- proxy.js
- app/api/transactions/replenish/[id]/surat-tugas/pdf/route.js
- app/transactions/replenish/[id]/surat-tugas/page.jsx
- app/globals.css
- tests/replenish-assignment-letter-pdf.test.mjs

Hasil endpoint PDF yang diharapkan:
- Content-Type: application/pdf
- Content-Disposition: inline
- Accept-Ranges: bytes
- Status 200 atau 206
- X-Frame-Options: SAMEORIGIN khusus endpoint PDF Surat Tugas
