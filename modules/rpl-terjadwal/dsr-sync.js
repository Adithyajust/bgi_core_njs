// import sql from "mssql";
// import { connectDB } from "./database.js";
import { connectDB, sql } from "@/lib/mssql";

export async function getLastSync({reportingUkerId,period,branch}) {

 const db = await connectDB();

 const result = await db.request()
 .input("uker",sql.BigInt,reportingUkerId)
 .input("period",sql.Char(7),period)
 .input("branch",sql.NVarChar(150),branch)
 .query(`
 SELECT TOP 1 last_sync_date,last_batch_id
 FROM dbo.rpl_dsr_sync_control
 WHERE reporting_uker_id=@uker
 AND period=@period
 AND branch=@branch;
 `);

 return result.recordset[0] || null;
}


export function getNextSyncRange(lastSyncDate,today){

 if(!lastSyncDate){
   return {
    startDate: today.substring(0,8)+"01",
    endDate: today
   };
 }

 const d = new Date(lastSyncDate);
 d.setDate(d.getDate()+1);

 return {
   startDate:d.toISOString().substring(0,10),
   endDate:today
 };
}


export async function saveSyncCheckpoint({
 reportingUkerId,
 period,
 branch,
 lastSyncDate,
 batchId
}){

 const db=await connectDB();

 await db.request()
 .input("uker",sql.BigInt,reportingUkerId)
 .input("period",sql.Char(7),period)
 .input("branch",sql.NVarChar(150),branch)
 .input("date",sql.Date,lastSyncDate)
 .input("batch",sql.Int,batchId)
 .query(`
 MERGE dbo.rpl_dsr_sync_control AS target
 USING (
   SELECT @uker reporting_uker_id,
          @period period,
          @branch branch
 ) source
 ON target.reporting_uker_id=source.reporting_uker_id
 AND target.period=source.period
 AND target.branch=source.branch

 WHEN MATCHED THEN
 UPDATE SET
 last_sync_date=@date,
 last_batch_id=@batch,
 updated_at=GETDATE()

 WHEN NOT MATCHED THEN
 INSERT(reporting_uker_id,period,branch,last_sync_date,last_batch_id)
 VALUES(@uker,@period,@branch,@date,@batch);
 `);
}
