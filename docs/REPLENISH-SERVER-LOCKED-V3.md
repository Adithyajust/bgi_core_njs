# Replenish Server-Locked Mutation Protocol V3

## Masalah

Jalur edit Work Order sebelumnya mengirim `row_version` dari browser melalui body `PUT`. Representasi SQL Server `ROWVERSION` dapat berubah menjadi string hex, Buffer, typed array, atau object JSON tergantung query dan serialisasi. Jika token tidak terbaca, pengguna menerima pesan `Versi data work order tidak valid` meskipun record database valid.

## Perbaikan

Seluruh mutasi Work Order Replenish tidak lagi bergantung pada token versi dari browser:

- `POST` membuat work order dalam transaksi `SERIALIZABLE`.
- `PUT` mengunci work order dengan `UPDLOCK, HOLDLOCK`, membaca `row_version` binary langsung dari SQL Server, lalu memakai token tersebut pada kondisi `UPDATE`.
- `PATCH` untuk `SUBMIT`, `APPROVE`, `REJECT`, dan `CANCEL` menggunakan mekanisme server-locked yang sama.

Frontend tidak lagi memiliki field `row_version`, tidak memasukkannya ke payload simpan, dan tidak mensyaratkan token tersebut saat `Simpan & Ajukan`.

## Kontrol yang tetap berlaku

- Hanya pembuat atau Super Admin yang dapat mengubah Draft/Ditolak.
- Work order yang menunggu persetujuan tidak dapat diubah atau dibatalkan Admin CRO.
- Maker tidak boleh menyetujui work order sendiri.
- Validasi unit kerja, referensi, benturan jadwal, jabatan tim, dan kendaraan tetap dijalankan.
- Setiap mutasi tetap menggunakan transaksi `SERIALIZABLE`, status history, dan audit trail.

## Protokol diagnostik

Respons edit berhasil memuat:

- Header `X-Replenish-Update-Protocol: SERVER_LOCKED_V3`
- JSON `data.update_protocol = "SERVER_LOCKED_V3"`

Respons aksi lifecycle tetap memuat:

- Header `X-Replenish-Action-Protocol: SERVER_LOCKED_V2`

## Deployment

Tidak ada migration database. Hentikan proses Node, ganti source, hapus direktori `.next`, build ulang, lalu restart proses aplikasi.
