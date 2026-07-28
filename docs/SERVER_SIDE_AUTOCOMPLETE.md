# Server-Side Autocomplete Master Mesin

Autocomplete Cabang, Project, dan Tipe Mesin tidak lagi mengambil seluruh data saat halaman dibuka.

## Endpoint

```http
GET /api/masters/mesin?mode=autocomplete&source=project&q=atm&limit=20&after_id=100
```

Parameter:

- `source`: `cabang`, `project`, atau `tipe_mesin`.
- `q`: kata kunci pencarian, maksimal 100 karakter.
- `limit`: jumlah data, default 20 dan maksimal 50.
- `after_id`: cursor ID terakhir untuk memuat halaman berikutnya.
- `selected_id`: mengambil label item terpilih saat membuka form edit.

Response memuat `items`, `selected`, serta `pagination.has_more` dan `pagination.next_cursor`.

## Perubahan UI

- Pencarian ditunda 300 ms untuk mengurangi request saat pengguna mengetik.
- Dropdown memuat maksimal 20 item per request.
- Tombol `Muat lainnya` menggunakan cursor `after_id`.
- Pilihan pada form edit tetap tampil melalui `selected_id` atau data awal tabel.
- Project tetap dibatasi sesuai scope unit kerja pengguna.

## Bootstrap

```http
GET /api/masters/mesin?mode=bootstrap
```

Endpoint bootstrap hanya mengirim schema dan konstanta form. Endpoint ini tidak mengirim seluruh Cabang, Project, atau Tipe Mesin.
