import { getCROConnection } from "./cro-database.js"

export async function getDSRFromCRO({ startDate, endDate, branch }) {
  console.log("CRO QUERY PARAM:", {
      startDate,
      endDate,
      branch
  });
  const db = getCROConnection()
  const [rows] = await db.query(`
SELECT
 DATE_FORMAT(g.tglstart,'%Y-%m-%d') AS event_date,
 c.tid,
 c.locate AS location,
 c.denom,
 c.jenis_mesin AS machine_type,
 CASE
  WHEN c.jenis_mesin='ATM' THEN IFNULL(a.jml_lbr,0)
  WHEN c.jenis_mesin='CRM' THEN IFNULL(a.jml_lbr,0)+IFNULL(a.jml_lbr_1,0)
  ELSE 0
 END AS sheets,
 1 AS realized
FROM backup_rpl_order a
JOIN atm c ON a.tid_atm=c.tid
JOIN start g ON a.id_laporan=g.idstart
JOIN branch br ON a.codeuker=br.codeuker
JOIN backup_rpl_confirm f ON f.id_order=a.id_order
WHERE g.idstart IN (
 SELECT s.idstart FROM start s JOIN branch b ON s.codeuker=b.codeuker
 WHERE s.closestart LIKE '%1%'
 AND s.tglstart BETWEEN ? AND ?
 AND b.nmb LIKE CONCAT('%',?,'%')
)
AND c.jenis_mesin IN ('ATM','CRM')
AND f.ketconfirm NOT LIKE '%pembatalan%'
AND c.atmbank=1`, [startDate, endDate, branch])
 return rows
}
