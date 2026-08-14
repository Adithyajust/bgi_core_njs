# Replenish Point Autocomplete Clear Fix

## Masalah

Autocomplete ATM/CRM masih menampilkan label point terakhir setelah point tersebut berhasil dimasukkan ke daftar urutan rute. Penyebabnya adalah state pilihan pada parent kembali ke `null` dalam render yang sama, sedangkan komponen autocomplete tetap menjalankan `setQuery(option.label)` setelah callback `onSelect`.

## Perbaikan

Komponen `ReplenishAutocomplete` sekarang mendukung properti `clearOnSelect`. Khusus autocomplete ATM/CRM pada Work Order Replenish, properti ini diaktifkan sehingga setelah pilihan diproses:

- nilai input pencarian dikosongkan;
- hasil opsi lama dibersihkan;
- menu autocomplete ditutup;
- input siap digunakan untuk mencari point berikutnya.

Halaman Work Order tidak lagi menyimpan state `machineCandidate`. ATM/CRM terpilih langsung dimasukkan ke `form.points`.

## Guard tambahan

- ATM/CRM yang sudah dipilih tidak ditampilkan kembali pada hasil autocomplete.
- Penambahan point duplikat ditolak di sisi UI.
- Jumlah point tetap dibatasi maksimal 50 dalam satu Work Order.
- Validasi backend yang sudah ada tetap menjadi kontrol akhir.

## Deployment

Tidak ada perubahan database dan tidak diperlukan migration baru. Hapus cache `.next`, restart aplikasi, kemudian lakukan hard refresh browser.
