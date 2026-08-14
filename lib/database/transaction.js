import "server-only"
import { sql } from "@/lib/mssql"

function sqlErrorNumber(error) {
  return Number(error?.number || error?.originalError?.info?.number || error?.precedingErrors?.[0]?.number || 0)
}
export function isRetryableSqlError(error) {
  const number = sqlErrorNumber(error)
  return number === 1205 || number === 1222 || error?.code === "ETIMEOUT"
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }
export async function runInTransaction(pool, callback, {
  isolationLevel = sql.ISOLATION_LEVEL.READ_COMMITTED,
  maxRetries = 2,
  baseDelayMs = 75,
} = {}) {
  let attempt = 0
  while (true) {
    const transaction = new sql.Transaction(pool)
    let committed = false
    try {
      await transaction.begin(isolationLevel)
      const value = await callback(transaction, attempt)
      await transaction.commit()
      committed = true
      return value
    } catch (error) {
      if (!committed) {
        try { await transaction.rollback() } catch {}
      }
      if (!isRetryableSqlError(error) || attempt >= maxRetries) throw error
      await delay(baseDelayMs * 2 ** attempt + Math.floor(Math.random() * baseDelayMs))
      attempt += 1
    }
  }
}
