# Replenish Team Role and Approval Alignment

## Perubahan

1. Referensi Custody hanya mengambil pegawai aktif pada unit kerja work order dengan `jabatan = 'Custody'`.
2. Referensi Pengemudi hanya mengambil pegawai aktif pada unit kerja work order dengan `jabatan = 'Driver'`.
3. Validasi jabatan diulang pada backend saat create/update agar pilihan tidak dapat dipalsukan melalui request manual.
4. Manager Operasional, Asisten Manager CRO, Manager CRO, role Manager, dan Super Admin dikenali sebagai checker pembentukan tim.
5. Manager Operasional otomatis diarahkan ke filter `MENUNGGU_PERSETUJUAN_TIM` dan memperoleh tombol Setujui/Tolak.
6. Maker-checker tetap berlaku: pembuat work order tidak dapat menyetujui atau menolak work order miliknya sendiri.
7. Manager Operasional/Asisten Manager CRO tidak dapat membuat work order, kecuali Super Admin.

## Migration

Jalankan:

```bash
npm run db:migrate
```

Migration baru:

```text
scripts/migrations/029-replenish-team-role-and-operational-approval.sql
```

Migration menyelaraskan permission `view` dan `update` pada `/transactions` untuk role Manager Operasional/Asisten Manager CRO, termasuk role aplikasi yang terhubung ke pegawai dengan jabatan tersebut.

## Pemeriksaan data pegawai

Pastikan nilai jabatan menggunakan nilai master resmi:

```sql
SELECT id, nip, nama, jabatan, status
FROM dbo.pegawai
WHERE UPPER(LTRIM(RTRIM(ISNULL(jabatan, '')))) IN (
  'CUSTODY',
  'DRIVER',
  'MANAGER OPERASIONAL',
  'ASISTEN MANAGER CRO'
)
ORDER BY jabatan, nama;
```

Setelah migration, logout dan login kembali agar permission bootstrap diperbarui.
