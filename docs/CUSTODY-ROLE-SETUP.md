# Role Custody

Role aplikasi `CUSTODY` disiapkan khusus untuk operator Replenish Lapangan.
Role ini tidak sama dengan peran anggota tim yang disimpan pada Work Order,
tetapi akun Custody wajib terhubung ke pegawai aktif dengan `jabatan = Custody`.

## Permission bawaan

| Menu | Lihat | Buat | Ubah/operasikan | Hapus |
| --- | ---: | ---: | ---: | ---: |
| Replenish Lapangan (`/field_replenish`) | Ya | Tidak | Ya | Tidak |

Permission lain tidak diberikan otomatis dan permission yang sudah diatur manual
tidak dihapus oleh migration.

## Aktivasi

1. Jalankan `npm run db:migrate` agar migration `048-create-custody-role.sql`
   membentuk role dan permission bawaan.
2. Di **Master Data → Pegawai**, pastikan petugas aktif, mempunyai unit kerja,
   dan jabatannya **Custody**.
3. Di **Pengaturan → User & Role**, tambah user, pilih pegawai tersebut, lalu
   pilih role **Custody**.
4. Berikan password awal. Pada login pertama petugas wajib mengganti password.
5. Setelah password diganti, akun Custody diarahkan langsung ke
   `/field_replenish`.

Operasi scan tetap hanya diizinkan jika pegawai tersebut tercatat sebagai
anggota `CUSTODY` pada Work Order yang sedang dibuka.
