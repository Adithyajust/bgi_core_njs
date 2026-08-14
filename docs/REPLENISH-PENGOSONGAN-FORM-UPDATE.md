# Perubahan Form Work Order Replenish: Pengosongan Tanpa Nilai Kas

## Aturan baru

- **Replenish Normal** dan **Pengisian Perdana** wajib memilih pagu: 2.000, 4.000, 6.000, atau 8.000 lembar.
- **Pengosongan ATM/CRM** tidak menggunakan pagu, denomination value, nominal kebutuhan, atau kebutuhan kaset.
- Untuk Pengosongan, form point hanya menampilkan kolom **Keterangan** setelah jenis aktivitas dipilih.
- Server tetap menormalkan seluruh nilai kas Pengosongan menjadi `NULL`, termasuk ketika payload lama masih mengirim pagu.

## File yang diubah

- `app/transactions/replenish/page.jsx`
- `app/globals.css`
- `modules/replenish/validation.js`
- `modules/replenish/calculation.js`
- `tests/replenish-validation.test.mjs`
- `tests/replenish-point-calculation.test.mjs`

Tidak diperlukan perubahan schema karena kolom `pagu`, `denomination_value`, dan `requested_amount` sudah nullable, sedangkan `required_cassettes` otomatis menjadi `NULL` ketika pagu `NULL`.
