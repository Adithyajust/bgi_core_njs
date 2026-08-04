# Replenish Cancellation Workflow Fix

## Aturan bisnis

Admin CRO dapat membatalkan work order hanya pada status:

- `DRAFT`
- `DITOLAK`

Setelah work order diajukan dan berstatus `MENUNGGU_PERSETUJUAN_TIM`, Admin CRO tidak dapat membatalkan atau menarik kembali work order tersebut. Admin harus menunggu keputusan Manager Operasional atau Asisten Manager CRO.

Jika checker menolak work order, status berubah menjadi `DITOLAK`. Pada status ini Admin CRO dapat memperbaiki dan mengajukan ulang, atau membatalkan work order.

## Kontrol teknis

Aturan diterapkan pada:

1. Tombol aksi pada daftar work order.
2. Tombol aksi pada modal detail.
3. Endpoint `PATCH /api/transactions/replenish/{id}`.
4. Pengujian otomatis untuk mencegah regresi.

Tidak ada perubahan skema database dan tidak diperlukan migration baru.
