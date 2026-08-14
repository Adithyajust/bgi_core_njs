import sql from "mssql"

function readInteger(name, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback
}
function readBoolean(name, fallback) {
  const value = process.env[name]
  if (value === undefined) return fallback
  return String(value).toLowerCase() === "true"
}
const isProduction = process.env.NODE_ENV === "production"
function validateProductionEnvironment() {
  if (!isProduction) return
  const required = ["MSSQL_USER", "MSSQL_PASSWORD", "MSSQL_SERVER", "MSSQL_DATABASE"]
  const missing = required.filter((name) => !String(process.env[name] || "").trim())
  if (missing.length) throw new Error(`Konfigurasi SQL Server production belum lengkap: ${missing.join(", ")}`)
  if (readBoolean("MSSQL_TRUST_SERVER_CERTIFICATE", false)) {
    throw new Error("MSSQL_TRUST_SERVER_CERTIFICATE tidak boleh true pada production.")
  }
}
const config = {
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  server: process.env.MSSQL_SERVER || "localhost",
  database: process.env.MSSQL_DATABASE || "BGI_CORE",
  connectionTimeout: readInteger("MSSQL_CONNECTION_TIMEOUT_MS", 15000, 1000, 120000),
  requestTimeout: readInteger("MSSQL_REQUEST_TIMEOUT_MS", 30000, 1000, 300000),
  options: {
    encrypt: readBoolean("MSSQL_ENCRYPT", isProduction),
    trustServerCertificate: readBoolean("MSSQL_TRUST_SERVER_CERTIFICATE", !isProduction),
    enableArithAbort: true,
    abortTransactionOnError: true,
    appName: process.env.MSSQL_APP_NAME || "BGI_CORE_WEB",
    useUTC: true,
  },
  pool: {
    max: readInteger("MSSQL_POOL_MAX", 20, 1, 200),
    min: readInteger("MSSQL_POOL_MIN", 2, 0, 50),
    idleTimeoutMillis: readInteger("MSSQL_POOL_IDLE_MS", 30000, 1000, 600000),
    acquireTimeoutMillis: readInteger("MSSQL_POOL_ACQUIRE_TIMEOUT_MS", 15000, 1000, 120000),
  },
}
if (config.pool.min > config.pool.max) throw new Error("MSSQL_POOL_MIN tidak boleh lebih besar dari MSSQL_POOL_MAX.")
if (process.env.MSSQL_PORT) config.port = readInteger("MSSQL_PORT", 1433, 1, 65535)
let poolPromise = null
let poolInstance = null
export async function connectDB() {
  validateProductionEnvironment()
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(config)
    pool.on("error", (error) => {
      console.error("SQL Server pool error:", error)
      if (poolInstance === pool) poolInstance = null
      poolPromise = null
    })
    poolPromise = pool.connect().then((connected) => {
      poolInstance = connected
      return connected
    }).catch((error) => {
      poolInstance = null
      poolPromise = null
      throw error
    })
  }
  return poolPromise
}
export function getPoolHealth() {
  const pool = poolInstance?.pool
  return {
    connected: Boolean(poolInstance?.connected), healthy: Boolean(poolInstance?.healthy),
    size: Number(pool?.size || 0), available: Number(pool?.available || 0),
    pending: Number(pool?.pending || 0), borrowed: Number(pool?.borrowed || 0), max: config.pool.max,
  }
}
export async function closeDB() {
  if (!poolPromise) return
  const pool = await poolPromise
  poolPromise = null
  poolInstance = null
  await pool.close()
}
export { config as mssqlConfig, sql }
