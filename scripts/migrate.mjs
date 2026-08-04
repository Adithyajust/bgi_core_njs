import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import dotenv from "dotenv"
import sql from "mssql"

dotenv.config({ path: ".env.local" })

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const migrationsDirectory = path.join(currentDirectory, "migrations")
const databaseName = process.env.MSSQL_DATABASE || "BGI_CORE"

if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
  throw new Error("MSSQL_DATABASE hanya boleh berisi huruf, angka, dan underscore.")
}

function readBoolean(name, fallback) {
  const value = process.env[name]
  return value === undefined ? fallback : String(value).toLowerCase() === "true"
}

function readInteger(name, fallback, minimum = 0) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value >= minimum ? value : fallback
}

function createConfig(database) {
  const config = {
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    server: process.env.MSSQL_SERVER || "localhost",
    database,
    connectionTimeout: readInteger("MSSQL_CONNECTION_TIMEOUT_MS", 15000, 1000),
    requestTimeout: readInteger("MSSQL_MIGRATION_TIMEOUT_MS", 120000, 1000),
    options: {
      encrypt: readBoolean("MSSQL_ENCRYPT", process.env.NODE_ENV === "production"),
      trustServerCertificate: readBoolean(
        "MSSQL_TRUST_SERVER_CERTIFICATE",
        process.env.NODE_ENV !== "production"
      ),
      enableArithAbort: true,
    },
    pool: {
      max: 2,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  }

  if (process.env.MSSQL_PORT) {
    const port = Number(process.env.MSSQL_PORT)
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error("MSSQL_PORT harus berada pada rentang 1 sampai 65535.")
    }
    config.port = port
  }

  return config
}

function validateEnvironment() {
  const required = ["MSSQL_USER", "MSSQL_PASSWORD", "MSSQL_SERVER"]
  const missing = required.filter((name) => !String(process.env[name] || "").trim())

  if (missing.length > 0) {
    throw new Error(`Environment database belum lengkap: ${missing.join(", ")}`)
  }
}

async function ensureDatabase() {
  const pool = await new sql.ConnectionPool(createConfig("master")).connect()
  try {
    await pool.request().query(`
      IF DB_ID(N'${databaseName}') IS NULL
        CREATE DATABASE [${databaseName}];
    `)
  } finally {
    await pool.close()
  }
}

async function ensureMigrationTable(pool) {
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.schema_migrations', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.schema_migrations (
        version VARCHAR(255) NOT NULL,
        checksum CHAR(64) NOT NULL,
        applied_at DATETIME2(0) NOT NULL
          CONSTRAINT DF_schema_migrations_applied_at DEFAULT (SYSDATETIME()),
        CONSTRAINT PK_schema_migrations PRIMARY KEY CLUSTERED (version)
      );
    END;
  `)
}

async function applyMigration(pool, file, sqlText, checksum) {
  const transaction = new sql.Transaction(pool)
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)

  try {
    const lockResult = await new sql.Request(transaction)
      .input("resource", sql.NVarChar(255), "cro-njs-schema-migrations")
      .query(`
        DECLARE @result INT;
        EXEC @result = sys.sp_getapplock
          @Resource = @resource,
          @LockMode = 'Exclusive',
          @LockOwner = 'Transaction',
          @LockTimeout = 60000;
        SELECT @result AS lock_result;
      `)

    if (Number(lockResult.recordset[0]?.lock_result) < 0) {
      throw new Error("Tidak dapat memperoleh migration lock dalam 60 detik.")
    }

    const existing = await new sql.Request(transaction)
      .input("version", sql.VarChar(255), file)
      .query(`
        SELECT checksum
        FROM dbo.schema_migrations WITH (UPDLOCK, HOLDLOCK)
        WHERE version = @version;
      `)

    if (existing.recordset.length > 0) {
      if (existing.recordset[0].checksum !== checksum) {
        throw new Error(`Migration ${file} berubah setelah diterapkan. Buat migration baru.`)
      }

      await transaction.commit()
      console.log(`SKIP ${file}`)
      return
    }

    console.log(`APPLY ${file}`)
    await new sql.Request(transaction).batch(sqlText)
    await new sql.Request(transaction)
      .input("version", sql.VarChar(255), file)
      .input("checksum", sql.Char(64), checksum)
      .query(`
        INSERT INTO dbo.schema_migrations(version, checksum)
        VALUES (@version, @checksum);
      `)

    await transaction.commit()
  } catch (error) {
    try {
      await transaction.rollback()
    } catch {
      // Migration SQL dapat lebih dahulu melakukan rollback pada transaction luar.
    }
    throw error
  }
}

async function main() {
  validateEnvironment()
  await ensureDatabase()
  const pool = await new sql.ConnectionPool(createConfig(databaseName)).connect()

  try {
    const identityResult = await pool.request().query(`
      SELECT
        CONVERT(NVARCHAR(128), SERVERPROPERTY('ServerName')) AS server_name,
        DB_NAME() AS database_name,
        ORIGINAL_LOGIN() AS login_name;
    `)
    const identity = identityResult.recordset[0] || {}
    console.log(
      `Target migration: ${identity.server_name || process.env.MSSQL_SERVER || "unknown"} / ${identity.database_name || databaseName} (login: ${identity.login_name || "unknown"})`
    )

    await ensureMigrationTable(pool)

    const files = (await fs.readdir(migrationsDirectory))
      .filter((file) => /^\d+.*\.sql$/i.test(file))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))

    for (const file of files) {
      const sqlText = await fs.readFile(path.join(migrationsDirectory, file), "utf8")
      const checksum = createHash("sha256").update(sqlText).digest("hex")
      await applyMigration(pool, file, sqlText, checksum)
    }

    console.log("Seluruh migration berhasil diterapkan.")
  } finally {
    await pool.close()
  }
}

main().catch((error) => {
  console.error("Migration gagal:", error)
  process.exitCode = 1
})
