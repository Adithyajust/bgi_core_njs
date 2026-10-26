import { connectDB, sql } from "@/lib/mssql"

export async function createIncrementalBatch({
  period,
  unit,
  ukerId,
  startDate,
  endDate,
  rowCount,
  userId = 1
}) {

  const db = await connectDB()

  const result = await db.request()
    .input("period", sql.Char(7), period)
    .input("unit", sql.NVarChar(150), unit)
    .input("uker", sql.BigInt, ukerId)
    .input("summary", sql.NVarChar(sql.MAX), JSON.stringify({
      type: "DSR_INCREMENTAL",
      startDate,
      endDate,
      rowCount
    }))
    .input("userId", sql.Int, userId)
    .query(`
      INSERT INTO dbo.rpl_upload_batches
      (
        period,
        reporting_unit,
        period_label,
        summary_json,
        warnings_json,
        uploaded_by,
        uploaded_at,
        reporting_uker_id,
        parameter_revision
      )
      OUTPUT INSERTED.id
      VALUES
      (
        @period,
        @unit,
        @period,
        @summary,
        N'[]',
        @userId,
        GETDATE(),
        @uker,
        1
      );
    `)

  return result.recordset[0].id
}


export async function insertIncrementalDSR({ batchId, rows }) {

  const pool = await connectDB()

  for (let i = 0; i < rows.length; i += 500) {

    const chunk = rows.slice(i, i + 500)

    await pool.request()
      .input("batch", sql.Int, batchId)
      .input("rows", sql.NVarChar(sql.MAX), JSON.stringify(chunk))
      .query(`
        INSERT INTO dbo.rpl_dsr_uploads
        (
          batch_id,
          source_row,
          event_date,
          tid,
          location,
          machine_type,
          cluster,
          sheets,
          forecast,
          realized,
          status,
          cause,
          obstacle,
          note
        )
        SELECT
          @batch,
          source_row,
          event_date,
          tid,
          location,
          machine_type,
          cluster,
          sheets,
          forecast,
          realized,
          status,
          cause,
          obstacle,
          note
        FROM OPENJSON(@rows)
        WITH
        (
          source_row INT,
          event_date DATE,
          tid VARCHAR(50),
          location NVARCHAR(250),
          machine_type VARCHAR(3),
          cluster NVARCHAR(100),
          sheets INT,
          forecast BIT,
          realized BIT,
          status VARCHAR(30),
          cause NVARCHAR(4000),
          obstacle NVARCHAR(4000),
          note NVARCHAR(4000)
        );
      `)
  }
}
