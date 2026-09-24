import { connectDB, sql } from "@/lib/mssql"
import { insertAuditLog } from "@/lib/security/audit-log"
import { UploadError } from "./workbook.js"
import { MAX_PARAMETERS } from "./parameters.js"

const columns = "tid,location,branch,machine_type,denom,cluster_flm,cluster,sub_cluster_rpl"
const jsonSchema = "tid VARCHAR(50),location NVARCHAR(250),branch NVARCHAR(150),machine_type VARCHAR(3),denom VARCHAR(15),cluster_flm NVARCHAR(100),cluster NVARCHAR(100),sub_cluster_rpl NVARCHAR(100)"

export async function readParameterMaster(tx, ukerId, mode = "Shared") {
  // Acquire this lock before any batch lock, including when no master exists yet.
  const lock = await new sql.Request(tx).input("resource", sql.NVarChar(255), `rpl-tid-parameters:${ukerId}`)
    .input("mode", sql.VarChar(32), mode).query(`DECLARE @result INT;
      EXEC @result=sys.sp_getapplock @Resource=@resource,@LockMode=@mode,@LockOwner='Transaction',@LockTimeout=10000;
      SELECT @result AS lock_result;`)
  if (lock.recordset[0].lock_result < 0) throw new UploadError("Parameter sedang diperbarui. Coba lagi.", 409)
  const result = await new sql.Request(tx).input("uker", sql.BigInt, ukerId).query(`
    SELECT revision FROM dbo.rpl_tid_parameter_sets WHERE uker_id=@uker;
    SELECT ${columns},CONVERT(VARCHAR(19),updated_at,126) AS updated_at
    FROM dbo.rpl_tid_parameter_master WHERE uker_id=@uker ORDER BY tid;`)
  return { revision: result.recordsets[0][0]?.revision ?? 0, items: result.recordsets[1] }
}

export async function getParameterMaster(ukerId) {
  const tx = new sql.Transaction(await connectDB())
  await tx.begin()
  try {
    const data = await readParameterMaster(tx, ukerId)
    await tx.commit()
    return data
  } catch (error) { try { await tx.rollback() } catch { /* Transaction may be aborted. */ } throw error }
}

export async function saveParameterMaster(rows, { ukerId, revision, fileName, fileHash, user, request, editOnly = false }) {
  const tx = new sql.Transaction(await connectDB())
  await tx.begin()
  try {
    const current = await readParameterMaster(tx, ukerId, "Exclusive")
    if (current.revision !== revision) throw new UploadError("Parameter sudah berubah. Muat ulang atau preview kembali sebelum menyimpan.", 409)
    const tids = new Set(current.items.map(p => p.tid.toUpperCase()))
    const inserted = rows.filter(p => !tids.has(p.tid.toUpperCase())).length
    if (editOnly && inserted) throw new UploadError("TID tidak ditemukan pada unit ini. Muat ulang daftar parameter.", 404)
    if (current.items.length + inserted > MAX_PARAMETERS) throw new UploadError("Maksimal 20.000 parameter TID per unit.")
    await new sql.Request(tx).input("uker", sql.BigInt, ukerId).query(`
      IF NOT EXISTS(SELECT 1 FROM dbo.rpl_tid_parameter_sets WHERE uker_id=@uker)
        INSERT INTO dbo.rpl_tid_parameter_sets(uker_id) VALUES(@uker);`)
    for (let start = 0; start < rows.length; start += 500) {
      await new sql.Request(tx).input("uker", sql.BigInt, ukerId).input("user", sql.Int, user.id)
        .input("rows", sql.NVarChar(sql.MAX), JSON.stringify(rows.slice(start, start + 500))).query(`
          UPDATE p SET location=j.location,branch=j.branch,machine_type=j.machine_type,denom=j.denom,
            cluster_flm=j.cluster_flm,cluster=j.cluster,sub_cluster_rpl=j.sub_cluster_rpl,updated_by=@user,updated_at=SYSDATETIME()
          FROM dbo.rpl_tid_parameter_master p JOIN OPENJSON(@rows) WITH(${jsonSchema}) j ON j.tid=p.tid
          WHERE p.uker_id=@uker;
          INSERT INTO dbo.rpl_tid_parameter_master(uker_id,${columns},updated_by)
          SELECT @uker,j.tid,j.location,j.branch,j.machine_type,j.denom,j.cluster_flm,j.cluster,j.sub_cluster_rpl,@user
          FROM OPENJSON(@rows) WITH(${jsonSchema}) j
          WHERE NOT EXISTS(SELECT 1 FROM dbo.rpl_tid_parameter_master p WHERE p.uker_id=@uker AND p.tid=j.tid);`)
    }
    await new sql.Request(tx).input("uker", sql.BigInt, ukerId).input("user", sql.Int, user.id)
      .query("UPDATE dbo.rpl_tid_parameter_sets SET revision=revision+1,updated_by=@user,updated_at=SYSDATETIME() WHERE uker_id=@uker;")
    await insertAuditLog(tx, { request, userId: user.id, action: "UPDATE", module: "rpl_terjadwal", entityType: "rpl_tid_parameter_master", entityId: String(ukerId),
      metadata: { file_name: fileName || null, file_hash: fileHash || null, previous_revision: revision, inserted, updated: rows.length - inserted,
        ...(editOnly ? { before: current.items.find(p => p.tid.toUpperCase() === rows[0].tid), after: rows[0] } : {}) } })
    await tx.commit()
    return { revision: revision + 1, inserted, updated: rows.length - inserted, total: current.items.length + inserted }
  } catch (error) { try { await tx.rollback() } catch { /* Transaction may be aborted. */ } throw error }
}

export async function applyMasterToBatch({ batch, revision, ukerId, parameterRevision }, { user, request }) {
  const tx = new sql.Transaction(await connectDB())
  await tx.begin()
  try {
    const master = await readParameterMaster(tx, ukerId)
    if (master.revision !== parameterRevision) throw new UploadError("Parameter sudah berubah. Muat ulang parameter sebelum menerapkan.", 409)
    const result = await new sql.Request(tx).input("batch", sql.Int, batch).query(`
      SELECT report_revision,reporting_uker_id FROM dbo.rpl_upload_batches WITH(UPDLOCK,HOLDLOCK) WHERE id=@batch;
      SELECT tid FROM dbo.rpl_planning_uploads WHERE batch_id=@batch UNION SELECT tid FROM dbo.rpl_dsr_uploads WHERE batch_id=@batch;`)
    const current = result.recordsets[0][0]
    if (!current) throw new UploadError("Versi upload tidak ditemukan.", 404)
    if (Number(current.reporting_uker_id) !== ukerId) throw new UploadError("Unit parameter harus sama dengan unit pada versi laporan.")
    if (current.report_revision !== revision) throw new UploadError("Laporan sudah berubah. Muat ulang laporan sebelum menerapkan parameter.", 409)
    const tids = new Set(result.recordsets[1].map(p => p.tid.toUpperCase()))
    const rows = master.items.filter(p => tids.has(p.tid.toUpperCase()))
    if (!rows.length) throw new UploadError("Tidak ada parameter TID yang cocok dengan versi laporan ini.")
    for (let start = 0; start < rows.length; start += 500) {
      await new sql.Request(tx).input("batch", sql.Int, batch).input("rows", sql.NVarChar(sql.MAX), JSON.stringify(rows.slice(start, start + 500))).query(`
        UPDATE p SET location=j.location,branch=j.branch,machine_type=j.machine_type,denom=j.denom,
          cluster_flm=j.cluster_flm,cluster=j.cluster,sub_cluster_rpl=j.sub_cluster_rpl,metadata_source=N'Master Parameter TID'
        FROM dbo.rpl_tid_parameters p JOIN OPENJSON(@rows) WITH(${jsonSchema}) j ON j.tid=p.tid WHERE p.batch_id=@batch;
        INSERT INTO dbo.rpl_tid_parameters(batch_id,${columns},metadata_source)
        SELECT @batch,j.tid,j.location,j.branch,j.machine_type,j.denom,j.cluster_flm,j.cluster,j.sub_cluster_rpl,N'Master Parameter TID'
        FROM OPENJSON(@rows) WITH(${jsonSchema}) j
        WHERE NOT EXISTS(SELECT 1 FROM dbo.rpl_tid_parameters p WHERE p.batch_id=@batch AND p.tid=j.tid);`)
    }
    await new sql.Request(tx).input("batch", sql.Int, batch).input("revision", sql.Int, master.revision)
      .query("UPDATE dbo.rpl_upload_batches SET report_revision=report_revision+1,parameter_revision=@revision WHERE id=@batch;")
    await insertAuditLog(tx, { request, userId: user.id, action: "UPDATE", module: "rpl_terjadwal", entityType: "rpl_upload_batches", entityId: batch,
      metadata: { type: "apply_master_parameters", uker_id: ukerId, parameter_revision: master.revision, previous_revision: revision, matched: rows.length } })
    await tx.commit()
    return { revision: revision + 1, matched: rows.length, unmatched: tids.size - rows.length }
  } catch (error) { try { await tx.rollback() } catch { /* Transaction may be aborted. */ } throw error }
}
