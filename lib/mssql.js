import sql from "mssql"

function readInteger(name, fallback, minimum = 0) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value >= minimum ? value : fallback
}

function readBoolean(name, fallback) {
  const value = process.env[name]
  if (value === undefined) return fallback
  return String(value).toLowerCase() === "true"
}

const isProduction = process.env.NODE_ENV === "production"

const config = {
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  server: process.env.MSSQL_SERVER || "localhost",
  database: process.env.MSSQL_DATABASE || "BGI_CORE",
  connectionTimeout: readInteger("MSSQL_CONNECTION_TIMEOUT_MS", 15000, 1000),
  requestTimeout: readInteger("MSSQL_REQUEST_TIMEOUT_MS", 30000, 1000),
  options: {
    encrypt: readBoolean("MSSQL_ENCRYPT", isProduction),
    trustServerCertificate: readBoolean(
      "MSSQL_TRUST_SERVER_CERTIFICATE",
      !isProduction
    ),
    enableArithAbort: true,
  },
  pool: {
    max: readInteger("MSSQL_POOL_MAX", 20, 1),
    min: readInteger("MSSQL_POOL_MIN", 2, 0),
    idleTimeoutMillis: readInteger("MSSQL_POOL_IDLE_MS", 30000, 1000),
  },
}

if (process.env.MSSQL_PORT) {
  config.port = readInteger("MSSQL_PORT", 1433, 1)
}

let poolPromise = null

export async function connectDB() {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(config)
    pool.on("error", (error) => {
      console.error("SQL Server pool error:", error)
      poolPromise = null
    })

    poolPromise = pool.connect().catch((error) => {
      poolPromise = null
      throw error
    })
  }

  return poolPromise
}

export async function closeDB() {
  if (!poolPromise) return
  const pool = await poolPromise
  poolPromise = null
  await pool.close()
}

export { config as mssqlConfig, sql }
