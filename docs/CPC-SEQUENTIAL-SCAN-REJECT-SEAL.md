# CPC Sequential Scan + Reject Cassette Seal

Perubahan ini mengunci urutan scan packing per TID:

1. Serial Kaset Uang 1
2. Segel Kaset Uang 1
3. Serial Kaset Uang berikutnya
4. Segel Kaset Uang berikutnya
5. Ulangi sampai seluruh kaset uang TID lengkap
6. Serial Kaset Reject
7. Segel Kaset Reject
8. Segel BAG Berangkat
9. Segel BAG Kembali

UI menonaktifkan field yang belum boleh discan. Backend melakukan validasi urutan yang sama agar tidak dapat dilewati melalui request langsung.

Migration 044 menambahkan `reject_cassette_seal_no` pada `dbo.cpc_packing_tid_assets` dan unique index untuk nilai tersebut.
