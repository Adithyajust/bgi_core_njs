import sql from "mssql";

const config = {
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  server: process.env.MSSQL_SERVER || "localhost",
  database: process.env.MSSQL_DATABASE || "BGI_CORE",
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

if (process.env.MSSQL_PORT) {
  config.port = Number(process.env.MSSQL_PORT);
}

let pool;

export async function connectDB() {
  if (pool && pool.connected) {
    return pool;
  }

  pool = await new sql.ConnectionPool(config).connect();

  return pool;
}

export { sql };