import {
  getLastSync,
  getNextSyncRange,
  saveSyncCheckpoint
} from "./dsr-sync.js"

import { getDSRFromCRO } from "./cro-query.js"
import {
  createIncrementalBatch,
  insertIncrementalDSR
} from "./incremental-database.js"


export async function runIncrementalDSR({
  period,
  branch,
  ukerId,
  userId,
  today
}) {

  const last = await getLastSync({
    reportingUkerId: ukerId,
    period,
    branch
  })

  const range = getNextSyncRange(
    last?.last_sync_date,
    today
  )

  console.log("[RPL DSR SYNC]", {
    lastSync: last,
    range
  })


  const rows = await getDSRFromCRO({
    startDate: range.startDate,
    endDate: range.endDate,
    branch
  })


  if (!rows.length) {
    return {
      success: true,
      message: "Tidak ada DSR baru",
      count: 0
    }
  }


  const batchId = await createIncrementalBatch({
    period,
    unit: branch,
    ukerId,
    startDate: range.startDate,
    endDate: range.endDate,
    rowCount: rows.length,
    userId
  })


  await insertIncrementalDSR({
    batchId,
    rows
  })


  await saveSyncCheckpoint({
    reportingUkerId: ukerId,
    period,
    branch,
    lastSyncDate: range.endDate,
    batchId
  })


  return {
    success: true,
    batchId,
    count: rows.length,
    range
  }
}
