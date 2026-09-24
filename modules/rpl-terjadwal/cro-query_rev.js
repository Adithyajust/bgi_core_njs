import { getCROConnection } from "./cro-database.js"

export async function getDSRFromCRO({
  startDate,
  endDate,
  branch,
  tids = []
}) {
  const db = getCROConnection()

  if (!tids.length) {
    return []
  }

  const placeholders = tids.map(() => "?").join(",")

  const sql = `
SELECT
 g.tglstart AS event_date,
 c.tid,
 c.locate AS location,
 c.denom,
 c.jenis_mesin AS machine_type,

 CASE
  WHEN c.jenis_mesin='ATM'
   THEN IFNULL(a.jml_lbr,0)

  WHEN c.jenis_mesin='CRM'
   THEN IFNULL(a.jml_lbr,0)+IFNULL(a.jml_lbr_1,0)

  ELSE 0
 END AS sheets,

 1 AS realized

FROM backup_rpl_order a
JOIN atm c ON a.tid_atm=c.tid
JOIN start g ON a.id_laporan=g.idstart
JOIN branch br ON a.codeuker=br.codeuker
JOIN backup_rpl_confirm f ON f.id_order=a.id_order

WHERE g.tglstart BETWEEN ? AND ?
AND br.nmb LIKE ?
AND c.tid IN (${placeholders})
AND c.jenis_mesin IN ('ATM','CRM')
AND f.ketconfirm NOT LIKE '%pembatalan%'
AND c.atmbank=1
`

  const params = [
    startDate,
    endDate,
    branch,
    ...tids
  ]

  const [rows] = await db.query(sql, params)

  return rows
}
