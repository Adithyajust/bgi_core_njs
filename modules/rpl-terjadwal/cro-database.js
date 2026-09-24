import mysql from "mysql2/promise"

let pool

export function getCROConnection() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.CRO_DB_HOST,
      port: Number(process.env.CRO_DB_PORT || 3306),
      user: process.env.CRO_DB_USER,
      password: process.env.CRO_DB_PASSWORD,
      database: process.env.CRO_DB_NAME,
      waitForConnections: true,
      connectionLimit: 5
    })
  }
  return pool
}
