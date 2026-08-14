# CPC Packing Save - Exclusive Work Order Owner Snapshot Fix

## Masalah
Form scanner CPC dapat menampilkan input dan menandai form berubah, tetapi tombol **Simpan Hasil Scan** / **Selesaikan Packing & Ajukan** menampilkan pesan `Tidak ada perubahan pada TID yang menjadi assignment Anda.`

Penyebabnya adalah frontend masih memilih payload berdasarkan marker perubahan dan assignment per-TID, sedangkan model terbaru sudah memakai **exclusive owner per Work Order**. Snapshot assignment TID yang legacy/stale dapat membuat payload kosong walaupun user adalah owner sah Work Order.

## Perbaikan
- Owner Work Order menjadi sumber kebenaran untuk daftar TID yang dapat disimpan.
- Marker dirty per-TID hanya dipakai sebagai optimasi. Bila marker tidak valid/stale, frontend menyimpan snapshot seluruh WO milik owner.
- Backend tetap melakukan claim/lock owner secara transactional sebelum menerima perubahan.
- Backend tidak lagi menjadikan `assigned_to` per-TID sebagai syarat otorisasi update; semua ID item/TID tetap diverifikasi berasal dari batch Work Order yang terkunci.
- Exclusive Work Order lock, single-active-job lock, unique cassette/seal validation, audit log, dan maker-checker tetap dipertahankan.

Tidak ada perubahan skema database dan tidak diperlukan migration baru.
