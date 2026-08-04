import process from "node:process"

import dotenv from "dotenv"
import sql from "mssql"

dotenv.config({ path: ".env.local" })

function readBoolean(name, fallback) {
  const value = process.env[name]
  return value === undefined ? fallback : String(value).toLowerCase() === "true"
}

function readInteger(name, fallback, minimum = 0) {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value >= minimum ? value : fallback
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
}

if (process.env.MSSQL_PORT) {
  config.port = readInteger("MSSQL_PORT", 1433, 1)
}

const pool = await new sql.ConnectionPool(config).connect()

try {
  const objectResult = await pool.request().query(`
    SELECT
      DB_NAME() AS database_name,
      OBJECT_ID(N'dbo.audit_logs', N'U') AS audit_logs_table_id,
      OBJECT_ID(N'dbo.audit_log', N'U') AS audit_log_table_id,
      OBJECT_ID(N'dbo.audit_log', N'V') AS audit_log_view_id;
  `)

  const objects = objectResult.recordset[0]
  console.log(`Database aktif : ${objects.database_name}`)
  console.log(
    `dbo.audit_logs : ${objects.audit_logs_table_id ? "tersedia" : "TIDAK ADA"}`
  )
  console.log(
    `dbo.audit_log  : ${
      objects.audit_log_table_id
        ? "tersedia sebagai tabel lain"
        : objects.audit_log_view_id
          ? "tersedia sebagai view"
          : "tidak ada"
    }`
  )

  if (!objects.audit_logs_table_id) {
    console.error(
      "\nTabel kanonis dbo.audit_logs tidak tersedia. Jalankan: npm run db:migrate"
    )
    process.exitCode = 1
  } else {
    const auditResult = await pool.request().query(`
      SELECT COUNT_BIG(1) AS total_audit
      FROM dbo.audit_logs;

      SELECT TOP (20)
        al.id,
        al.created_at,
        al.user_id,
        u.username,
        al.action,
        al.module,
        al.entity_type,
        al.entity_id,
        al.ip_address,
        al.request_id,
        al.metadata_json
      FROM dbo.audit_logs al
      LEFT JOIN dbo.users u ON u.id = al.user_id
      ORDER BY al.id DESC;

      SELECT
        module,
        action,
        COUNT_BIG(1) AS total
      FROM dbo.audit_logs
      GROUP BY module, action
      ORDER BY module ASC, action ASC;
    `)

    const total = Number(auditResult.recordsets[0][0]?.total_audit || 0)
    console.log(`Jumlah audit    : ${total}`)

    if (total === 0) {
      console.warn(
        "\nTabel tersedia tetapi masih kosong. Pastikan route mutasi memanggil writeAuditLog dan periksa terminal server untuk pesan 'Audit log write failed'."
      )
    } else {
      console.log("\n20 aktivitas terbaru:")
      console.table(auditResult.recordsets[1])
      console.log("\nRekap audit per modul dan aksi:")
      console.table(auditResult.recordsets[2])
    }
  }

  const migrationResult = await pool.request().query(`
    IF OBJECT_ID(N'dbo.schema_migrations', N'U') IS NOT NULL
      SELECT version, applied_at
      FROM dbo.schema_migrations
      WHERE version IN (
        '012-production-hardening.sql',
        '013-master-kendaraan.sql',
        '014-audit-log-all-menus.sql'
      )
      ORDER BY version;
  `)

  if (migrationResult.recordset.length > 0) {
    console.log("\nMigration terkait:")
    console.table(migrationResult.recordset)
  }
} finally {
  await pool.close()
}
