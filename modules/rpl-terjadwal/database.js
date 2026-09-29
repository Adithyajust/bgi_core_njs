import { connectDB, sql } from "@/lib/mssql"
import { insertAuditLog } from "@/lib/security/audit-log"
import { UploadError } from "./workbook.js"
import { readParameterMaster } from "./parameter-database.js"

function escapeLike(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_").replaceAll("[", "\\[")
}

export async function listReportingUkerOptions(search = "", scope = {}) {
  const normalizedSearch = String(search || "").trim().slice(0, 100)
  const db = await connectDB()
  const result = await db.request()
    .input("search", sql.NVarChar(210), normalizedSearch ? `%${escapeLike(normalizedSearch)}%` : "%")
    .input("scopeCodeUker", sql.NVarChar(15), scope.isSuperAdmin ? null : (scope.codeUker || null))
    .query(`SELECT TOP (20) id, codeuker, nama_uker
      FROM dbo.master_uker
      WHERE (@search = '%' OR nama_uker LIKE @search ESCAPE '\\')
      AND (@scopeCodeUker IS NULL OR codeuker = @scopeCodeUker)
      ORDER BY nama_uker ASC, id ASC;`)
  return result.recordset.map(row => ({ value: String(row.id), label: row.nama_uker, data: row }))
}

export async function resolveReportingUker(id, scope) {
  const parsedId = Number(id)
  if (!Number.isSafeInteger(parsedId) || parsedId < 1) return null
  const db = await connectDB()
  const result = await db.request()
    .input("id", sql.BigInt, parsedId)
    .input("scopeCodeUker", sql.NVarChar(15), scope.isSuperAdmin ? null : (scope.codeUker || null))
    .query("SELECT TOP (1) id, codeuker, nama_uker FROM dbo.master_uker WHERE id = @id AND (@scopeCodeUker IS NULL OR codeuker = @scopeCodeUker);")
  const row = result.recordset[0]
  if (!row) return null

  // Validasi akses user terhadap unit kerja
  if (scope.codeUker && row.codeuker !== scope.codeUker) {
    throw new Error("User tidak memiliki akses terhadap unit kerja ini.");
  }

  return row
}

export async function saveUpload(data, { fileName, unit, ukerId, user, request }) {
  const pool = await connectDB()
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const master = await readParameterMaster(tx, ukerId)
    if (master.revision !== data.parameter_revision) throw new UploadError("Parameter berubah. Lakukan preview kembali.", 409)
    const result = await new sql.Request(tx)
      .input("period", sql.Char(7), data.period)
      .input("unit", sql.NVarChar(150), unit)
      .input("uker", sql.BigInt, ukerId)
      .input("parameterRevision", sql.Int, data.parameter_revision)
      .input("fileName", sql.NVarChar(255), fileName)
      .input("hash", sql.Char(64), data.file_hash)
      .input("label", sql.NVarChar(250), data.period_label.slice(0, 250))
      .input("summary", sql.NVarChar(sql.MAX), JSON.stringify(data.summary))
      .input("warnings", sql.NVarChar(sql.MAX), JSON.stringify(data.warnings))
      .input("settings", sql.NVarChar(sql.MAX), JSON.stringify(data.settings))
      .input("reference", sql.NVarChar(sql.MAX), JSON.stringify(data.reference_fc))
      .input("userId", sql.Int, user.id)
      .query(`INSERT INTO dbo.rpl_upload_batches
        (period, reporting_unit, file_name, file_hash, period_label, summary_json, warnings_json, uploaded_by, report_settings_json, reference_fc_json, reporting_uker_id, parameter_revision)
        OUTPUT INSERTED.id VALUES (@period, @unit, @fileName, @hash, @label, @summary, @warnings, @userId, @settings, @reference, @uker, @parameterRevision);`)
    const id = result.recordset[0].id
    const parameterClusterMap = new Map((data.parameters || []).map(item => [String(item.tid), item.cluster || "-"]))
    const normalizedPlanning = (data.planning || []).map(row => ({
      ...row,
      cluster: row.cluster || parameterClusterMap.get(String(row.tid)) || "-"
    }))
    const normalizedDsr = (data.dsr || []).map(row => ({
      ...row,
      cluster: row.cluster || parameterClusterMap.get(String(row.tid)) || "-"
    }))
    for (const [table, items] of [["rpl_planning_uploads", normalizedPlanning], ["rpl_dsr_uploads", normalizedDsr]]) {
      for (let start = 0; start < items.length; start += 500) {
        await new sql.Request(tx).input("batch", sql.Int, id)
          .input("rows", sql.NVarChar(sql.MAX), JSON.stringify(items.slice(start, start + 500)))
          .query(`INSERT INTO dbo.${table}
            (batch_id, source_row, event_date, tid, location, machine_type, cluster, sheets, forecast, realized, status, cause, obstacle, note)
            SELECT @batch, source_row, event_date, tid, location, machine_type, cluster, sheets, forecast, realized, status, cause, obstacle, note
            FROM OPENJSON(@rows) WITH (
              source_row INT, event_date DATE, tid VARCHAR(50), location NVARCHAR(250), machine_type VARCHAR(3),
              cluster NVARCHAR(100), sheets INT, forecast BIT, realized BIT, status VARCHAR(30),
              cause NVARCHAR(4000), obstacle NVARCHAR(4000), note NVARCHAR(4000)
            );`)
      }
    }
    for (let start = 0; start < data.parameters.length; start += 500) {
      await new sql.Request(tx).input("batch", sql.Int, id)
        .input("rows", sql.NVarChar(sql.MAX), JSON.stringify(data.parameters.slice(start, start + 500)))
        .query(`INSERT INTO dbo.rpl_tid_parameters(batch_id,tid,denom,branch,cluster_flm,sub_cluster_rpl,avg_daily_transaction,metadata_source,location,machine_type,cluster)
          SELECT @batch,tid,denom,branch,cluster_flm,sub_cluster_rpl,avg_daily_transaction,metadata_source,location,machine_type,cluster
          FROM OPENJSON(@rows) WITH(tid VARCHAR(50),denom VARCHAR(15),branch NVARCHAR(150),cluster_flm NVARCHAR(100),sub_cluster_rpl NVARCHAR(100),avg_daily_transaction DECIMAL(18,2),metadata_source NVARCHAR(50),location NVARCHAR(250),machine_type VARCHAR(3),cluster NVARCHAR(100));`)
    }
    await insertAuditLog(tx, { request, userId: user.id, action: "CREATE", module: "rpl_terjadwal", entityType: "rpl_upload_batches", entityId: id,
      metadata: { period: data.period, unit, uker_id: ukerId, parameter_revision: data.parameter_revision, fileName, fileHash: data.file_hash, ...data.summary } })
    await tx.commit()
    return id
  } catch (error) {
    try { await tx.rollback() } catch { /* SQL may already have aborted transaction. */ }
    throw error
  }
}

export async function listUploads(after = 2147483647) {
  const db = await connectDB()
  const result = await db.request().input("after", sql.Int, after).query(`
    SELECT TOP (21) b.id, b.period, b.reporting_unit, b.reporting_uker_id, b.file_name,
      CONVERT(VARCHAR(19), b.uploaded_at, 126) AS uploaded_at, u.username,
      b.summary_json, b.warnings_json
    FROM dbo.rpl_upload_batches b JOIN dbo.users u ON u.id = b.uploaded_by
    WHERE b.id < @after ORDER BY b.id DESC;`)
  return { items: result.recordset.slice(0, 20).map(({ summary_json, warnings_json, ...item }) => ({ ...item, summary: JSON.parse(summary_json), warnings: JSON.parse(warnings_json) })), has_more: result.recordset.length > 20 }
}

export async function getUploadRows({ batch, kind, after, search }) {
  const table = kind === "planning" ? "rpl_planning_uploads" : "rpl_dsr_uploads"
  const db = await connectDB()
  const result = await db.request().input("batch", sql.Int, batch).input("after", sql.Int, after)
    .input("search", sql.NVarChar(260), `%${search.replace(/[\\%_\[]/g, "\\$&")}%`)
    .query(`SELECT TOP (51) r.source_row, CONVERT(CHAR(10), r.event_date, 23) AS event_date,
      r.tid, COALESCE(p.location,r.location) AS location, COALESCE(p.machine_type,r.machine_type) AS machine_type,
      COALESCE(p.cluster,r.cluster) AS cluster, sheets, forecast, realized, status, cause, obstacle, note, p.denom
      FROM dbo.${table} r LEFT JOIN dbo.rpl_tid_parameters p ON p.batch_id=r.batch_id AND p.tid=r.tid
      WHERE r.batch_id = @batch AND source_row > @after
      AND (r.tid LIKE @search ESCAPE '\\' OR COALESCE(p.location,r.location) LIKE @search ESCAPE '\\' OR COALESCE(p.cluster,r.cluster) LIKE @search ESCAPE '\\')
      ORDER BY source_row;`)
  return { items: result.recordset.slice(0, 50), has_more: result.recordset.length > 50 }
}

export async function getReportData(batch) {
  const tx = new sql.Transaction(await connectDB())
  await tx.begin()
  try {
    // Edits lock this batch row first, so every sheet below uses one consistent revision.
    const result = await new sql.Request(tx).input("batch", sql.Int, batch).query(`
      SELECT id,period,reporting_unit,reporting_uker_id,parameter_revision,period_label,report_revision,report_settings_json,reference_fc_json,warnings_json
        FROM dbo.rpl_upload_batches WITH(HOLDLOCK) WHERE id=@batch;
      SELECT source_row,CONVERT(CHAR(10),event_date,23) AS event_date,tid,location,machine_type,cluster,sheets,forecast,realized,status,cause,obstacle,note
        FROM dbo.rpl_planning_uploads WHERE batch_id=@batch ORDER BY source_row;
      SELECT source_row,CONVERT(CHAR(10),event_date,23) AS event_date,tid,location,machine_type,cluster,sheets,forecast,realized,status,cause,obstacle,note
        FROM dbo.rpl_dsr_uploads WHERE batch_id=@batch ORDER BY source_row;
      SELECT tid,denom,branch,cluster_flm,sub_cluster_rpl,avg_daily_transaction,metadata_source,location,machine_type,cluster FROM dbo.rpl_tid_parameters WHERE batch_id=@batch;`)
    const row = result.recordsets[0][0]
    if (!row) throw new UploadError("Versi upload tidak ditemukan.", 404)
    await tx.commit()
    const { report_settings_json, reference_fc_json, warnings_json, report_revision, ...header } = row
    return { ...header, revision: report_revision, settings: JSON.parse(report_settings_json || "{}"), reference_fc: JSON.parse(reference_fc_json || "[]"), warnings: JSON.parse(warnings_json || "[]"), planning: result.recordsets[1], dsr: result.recordsets[2], parameters: result.recordsets[3] }
  } catch (error) { try { await tx.rollback() } catch { /* Already completed. */ } throw error }
}

export async function saveReportEdit(edit, { user, request }) {
  const tx = new sql.Transaction(await connectDB())
  await tx.begin()
  try {
    const locked = await new sql.Request(tx).input("batch", sql.Int, edit.batch)
      .query("SELECT report_revision,report_settings_json FROM dbo.rpl_upload_batches WITH(UPDLOCK,HOLDLOCK) WHERE id=@batch;")
    const batch = locked.recordset[0]
    if (!batch) throw new UploadError("Versi upload tidak ditemukan.", 404)
    if (batch.report_revision !== edit.revision) throw new UploadError("Data sudah berubah oleh pengguna lain. Muat ulang laporan sebelum menyimpan.", 409)
    const q = new sql.Request(tx).input("batch", sql.Int, edit.batch)
    if (edit.type === "settings") {
      await q.input("settings", sql.NVarChar(sql.MAX), JSON.stringify(edit.settings))
        .query("UPDATE dbo.rpl_upload_batches SET report_settings_json=@settings WHERE id=@batch;")
    } else if (edit.type === "tid") {
      q.input("tid", sql.VarChar(50), edit.tid).input("denom", sql.VarChar(15), edit.denom)
        .input("branch", sql.NVarChar(150), edit.branch).input("flm", sql.NVarChar(100), edit.cluster_flm)
        .input("sub", sql.NVarChar(100), edit.sub_cluster_rpl).input("avg", sql.Decimal(18, 2), edit.avg_daily_transaction)
        .input("location", sql.NVarChar(250), edit.location).input("machine", sql.VarChar(3), edit.machine_type).input("cluster", sql.NVarChar(100), edit.cluster)
      const result = await q.query(`
        IF NOT EXISTS(SELECT 1 FROM dbo.rpl_planning_uploads WHERE batch_id=@batch AND tid=@tid)
          AND NOT EXISTS(SELECT 1 FROM dbo.rpl_dsr_uploads WHERE batch_id=@batch AND tid=@tid)
          SELECT CAST(0 AS INT) AS changed;
        ELSE BEGIN
          UPDATE dbo.rpl_tid_parameters SET denom=@denom,branch=@branch,cluster_flm=@flm,sub_cluster_rpl=@sub,avg_daily_transaction=@avg,metadata_source=N'Input aplikasi',
            location=COALESCE(@location,location),machine_type=COALESCE(@machine,machine_type),cluster=COALESCE(@cluster,cluster) WHERE batch_id=@batch AND tid=@tid;
          IF @@ROWCOUNT=0 INSERT INTO dbo.rpl_tid_parameters(batch_id,tid,denom,branch,cluster_flm,sub_cluster_rpl,avg_daily_transaction,metadata_source,location,machine_type,cluster)
            VALUES(@batch,@tid,@denom,@branch,@flm,@sub,@avg,N'Input aplikasi',@location,@machine,@cluster);
          SELECT CAST(1 AS INT) AS changed;
        END;`)
      if (!result.recordset[0].changed) throw new UploadError("TID tidak terdapat pada versi upload ini.", 404)
    } else {
      const table = edit.kind === "planning" ? "rpl_planning_uploads" : "rpl_dsr_uploads"
      const result = await q.input("row", sql.Int, edit.source_row).input("cause", sql.NVarChar(4000), edit.cause)
        .input("obstacle", sql.NVarChar(4000), edit.obstacle).input("note", sql.NVarChar(4000), edit.note)
        .query(`UPDATE dbo.${table} SET cause=@cause,obstacle=@obstacle,note=@note WHERE batch_id=@batch AND source_row=@row; SELECT @@ROWCOUNT AS changed;`)
      if (!result.recordset[0].changed) throw new UploadError("Baris tidak ditemukan pada versi upload ini.", 404)
    }
    await new sql.Request(tx).input("batch", sql.Int, edit.batch).query("UPDATE dbo.rpl_upload_batches SET report_revision=report_revision+1 WHERE id=@batch;")
    await insertAuditLog(tx, { request, userId: user.id, action: "UPDATE", module: "rpl_terjadwal", entityType: "rpl_upload_batches", entityId: edit.batch, metadata: { ...edit, previous_revision: batch.report_revision } })
    await tx.commit()
    return { revision: batch.report_revision + 1 }
  } catch (error) { try { await tx.rollback() } catch { /* Already completed. */ } throw error }
}
