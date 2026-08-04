# Replenish Approval UX Fix

## Masalah

Manager Operasional melihat work order berstatus `DRAFT`, tetapi mengira tombol Setujui/Tolak tidak tersedia. Sesuai maker-checker, work order hanya dapat disetujui setelah Admin CRO mengubah status menjadi `MENUNGGU_PERSETUJUAN_TIM`.

## Perubahan

- Tombol `Tampilkan Antrian` dan `Tampilkan Semua` selalu terlihat pada akun approver.
- Draft yang dilihat Manager menampilkan status penjelas `Menunggu diajukan Admin CRO`.
- Detail Draft menjelaskan bahwa tombol approval baru aktif setelah pengajuan.
- Admin CRO mendapat tombol `Simpan & Ajukan` agar pembuatan draft dan pengajuan dapat dilakukan dalam satu alur.
- Tombol `Setujui` dan `Tolak` tersedia pada tabel serta modal detail untuk work order yang benar-benar berstatus `MENUNGGU_PERSETUJUAN_TIM`.

## Alur status

`DRAFT` → `MENUNGGU_PERSETUJUAN_TIM` → `DISETUJUI` / `DITOLAK`
