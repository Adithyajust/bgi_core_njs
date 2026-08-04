# Sinkronisasi Waktu Operasional Master Mesin

Daftar resmi Waktu Operasional ditetapkan menjadi tujuh nilai:

1. `00:00 - 23:59`
2. `06:00 - 15:00`
3. `06:00 - 18:00`
4. `06:00 - 21:00`
5. `09:00 - 15:00`
6. `09:00 - 18:00`
7. `09:00 - 21:00`

Perubahan mencakup form tambah/edit, metadata API, validasi import, template Excel, migration database baru, dan migration awal untuk instalasi baru.

Jalankan:

```powershell
npm run db:migrate
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run dev
```

Migration yang harus muncul: `021-sync-master-mesin-operation-times.sql`.
