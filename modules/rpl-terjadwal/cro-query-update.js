// Tambahkan transaction identifier dari CRO.
// Gunakan id_order sebagai identitas transaksi.

SELECT
    a.id_order AS cro_transaction_id,
    DATE_FORMAT(g.tglstart,'%Y-%m-%d') AS event_date,
    c.tid,
    c.locate AS location,
    c.jenis_mesin AS machine_type,
    CASE
        WHEN c.jenis_mesin='ATM'
            THEN IFNULL(a.jml_lbr,0)
        WHEN c.jenis_mesin='CRM'
            THEN IFNULL(a.jml_lbr,0)+IFNULL(a.jml_lbr_1,0)
        ELSE 0
    END AS sheets,
    1 AS realized
FROM ...
