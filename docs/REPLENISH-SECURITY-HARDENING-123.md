# Replenish Security Hardening: Work Order, Surat Tugas, dan Serah Terima Kunci

Perubahan ini mempertahankan struktur aplikasi existing. Tidak ada perubahan skema database dan tidak ada migration baru.

## 1. Barcode kunci tidak lagi bocor ke browser

`mapping.barcode` tetap dipakai server untuk pencocokan aksi `SCAN`, tetapi field tersebut dibuang dari snapshot API sebelum JSON dikirim ke client. Client hanya menerima `barcode_snapshot` setelah scan berhasil.

## 2. Surat Tugas selalu sinkron dengan Work Order terbaru

Saat draft Work Order diedit, snapshot Surat Tugas persiapan dibentuk ulang di transaksi database yang sama setelah detail Work Order diganti. Pada saat `SUBMIT`, server juga membentuk snapshot Work Order terkini dan membandingkan `document_hash` terhadap Surat Tugas tersimpan. Submit ditolak dengan HTTP 409 jika hash berbeda.

## 3. Serah Terima Kunci menjadi PDF server-side immutable

Aksi `PREPARE_PRINT` sekarang membentuk PDF di server dari snapshot scan yang sudah lengkap dan Work Order berstatus `DISETUJUI`. PDF disimpan pada:

`storage/private/replenish/key-handover/`

Setiap dokumen mempunyai `document_hash` untuk snapshot bisnis dan `pdf_hash` SHA-256 untuk bytes PDF. Sidecar metadata menyimpan scope unit kerja, owner Work Order, waktu generator, dan identitas generator. Bytes PDF diverifikasi kembali terhadap `pdf_hash` ketika file dibaca.

PDF untuk snapshot yang sama dibuat deterministik sehingga retry/request paralel tidak menghasilkan hash baru hanya karena waktu proses generator. File dengan `document_hash` berbeda tidak ditimpa otomatis.

`MARK_PRINTED` hanya diterima jika PDF server-side sudah ada dan `document_hash` file sama dengan snapshot Serah Terima Kunci saat ini. Audit cetak mencatat `document_hash`, `pdf_hash`, nama file, custody, verifier, dan barcode snapshot hasil scan.

Akses endpoint PDF dibatasi ke Super Admin, pembuat Work Order, atau approver Replenish yang berada dalam scope unit kerja yang sah. Route compatibility `?resource=key-handover-pdf` disediakan agar tetap tahan terhadap masalah nested route deployment yang sebelumnya menyebabkan 404 non-JSON.

## UI

Browser tidak lagi membentuk dokumen dengan `document.write()`. Tombol cetak meminta server menyiapkan PDF lalu membuka URL PDF private-storage. Konfirmasi cetak dilakukan sebagai aksi terpisah melalui tombol `Konfirmasi Sudah Dicetak`.

## Deployment

Tidak ada migration database. Deploy source baru, pastikan proses aplikasi mempunyai write permission ke `storage/private/replenish`, lalu build dan restart Next.js seperti prosedur existing.
