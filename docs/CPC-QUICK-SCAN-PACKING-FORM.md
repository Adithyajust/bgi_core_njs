# CPC Quick Scan Packing Form

## Tujuan
Form ini membuat proses packing CPC berbasis barcode scanner berjalan berurutan per TID dan tetap dikunci oleh backend.

## Alur operator per TID
1. Operator menerima Work Order CPC sehingga Work Order terkunci ke satu user CPC.
2. Pada detail Work Order, pilih satu TID pada **Form Scan Packing CPC**.
3. Scan **Serial Kaset Uang 1**, lalu **Segel Kaset Uang 1**.
4. Lanjutkan pasangan kaset berikutnya dengan pola yang sama: **Serial Kaset → Segel Kaset** sampai seluruh kaset uang pada TID selesai.
5. Setelah seluruh kaset uang lengkap, scan **Kaset Reject**, lalu **Segel Kaset Reject**.
6. Scan **Segel BAG Berangkat**.
7. Terakhir scan **Segel BAG Kembali**.
8. Scanner tidak memerlukan Enter; fokus berpindah otomatis sekitar 220 ms setelah kode selesai terbaca.
9. Gunakan **Simpan Hasil Scan** untuk menyimpan progres.
10. Setelah seluruh TID lengkap, gunakan **Selesaikan Packing & Ajukan** untuk mengirim job ke Asisten Manager CPC.

## Penguncian urutan
- Segel kaset tidak aktif sebelum serial kaset pasangannya terisi.
- Kaset berikutnya tidak aktif sebelum pasangan kaset + segel sebelumnya lengkap.
- Kaset Reject tidak aktif sebelum seluruh kaset uang pada TID lengkap.
- Segel Kaset Reject tidak aktif sebelum Kaset Reject terisi.
- Segel BAG Berangkat tidak aktif sebelum Kaset Reject + Segel Kaset Reject lengkap.
- Segel BAG Kembali tidak aktif sebelum Segel BAG Berangkat terisi.
- Backend mengulang validasi urutan yang sama sehingga urutan tidak dapat dilewati dengan request API langsung.

## Validasi yang dipertahankan
- Exclusive Work Order lock per operator CPC.
- Satu operator CPC hanya dapat memiliki satu Work Order packing aktif.
- Serial kaset tidak boleh terduplikasi dalam packing yang sama.
- Nomor segel kaset uang, segel kaset reject, dan segel BAG diperiksa duplikasi.
- Operator hanya dapat menyimpan Work Order yang sedang dikunci ke akunnya.
- Approval tetap maker-checker oleh Asisten Manager CPC.

## Database
Perubahan ini menambahkan migration `044-cpc-reject-cassette-seal.sql` untuk menyimpan `reject_cassette_seal_no` secara terpisah dan auditable.
