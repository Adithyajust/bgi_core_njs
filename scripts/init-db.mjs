import sql from "mssql";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const dbName = process.env.MSSQL_DATABASE || "BGI_CORE";

if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
  throw new Error("Nama database hanya boleh huruf, angka, dan underscore.");
}

const baseConfig = {
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  server: process.env.MSSQL_SERVER || "localhost",
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

if (process.env.MSSQL_PORT) {
  baseConfig.port = Number(process.env.MSSQL_PORT);
}

async function ensureDatabase() {
  const pool = await sql.connect({
    ...baseConfig,
    database: "master",
  });

  await pool.request().query(`
    IF DB_ID(N'${dbName}') IS NULL
    BEGIN
      CREATE DATABASE [${dbName}]
    END
  `);

  await pool.close();
}

async function ensureTables() {
  const pool = await sql.connect({
    ...baseConfig,
    database: dbName,
  });

  await pool.request().query(`
    IF OBJECT_ID('dbo.roles', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.roles (
        id INT IDENTITY(1,1) PRIMARY KEY,
        name VARCHAR(50) NOT NULL UNIQUE,
        description VARCHAR(200),
        is_active BIT DEFAULT 1,
        created_at DATETIME DEFAULT GETDATE()
      )
    END

    IF OBJECT_ID('dbo.users', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.users (
        id INT IDENTITY(1,1) PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        role_id INT NOT NULL,
        is_active BIT DEFAULT 1,
        created_at DATETIME DEFAULT GETDATE(),

        CONSTRAINT FK_users_roles
        FOREIGN KEY (role_id)
        REFERENCES dbo.roles(id)
      )
    END

    IF OBJECT_ID('dbo.menus', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.menus (
        id INT IDENTITY(1,1) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        icon VARCHAR(50),
        url VARCHAR(200) NOT NULL,
        badge VARCHAR(20),
        sort_order INT DEFAULT 0,
        is_active BIT DEFAULT 1,
        created_at DATETIME DEFAULT GETDATE()
      )
    END

    IF OBJECT_ID('dbo.role_menus', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.role_menus (
        role_id INT NOT NULL,
        menu_id INT NOT NULL,

        CONSTRAINT PK_role_menus
        PRIMARY KEY (role_id, menu_id),

        CONSTRAINT FK_role_menus_roles
        FOREIGN KEY (role_id)
        REFERENCES dbo.roles(id),

        CONSTRAINT FK_role_menus_menus
        FOREIGN KEY (menu_id)
        REFERENCES dbo.menus(id)
      )
    END
  `);

  await pool.close();
}

async function seedRoles() {
  const pool = await sql.connect({
    ...baseConfig,
    database: dbName,
  });

  const roles = [
    ["SUPER ADMIN", "Full access semua menu dan fitur"],
    ["MANAGER", "Akses monitoring, approval, analytics, dan laporan"],
    ["OPERATOR", "Akses input nasabah dan transaksi"],
  ];

  for (const role of roles) {
    await pool
      .request()
      .input("name", sql.VarChar(50), role[0])
      .input("description", sql.VarChar(200), role[1])
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.roles WHERE name = @name)
        BEGIN
          INSERT INTO dbo.roles (name, description)
          VALUES (@name, @description)
        END
      `);
  }

  await pool.close();
}

async function seedMenus() {
  const pool = await sql.connect({
    ...baseConfig,
    database: dbName,
  });

  const menus = [
    ["Dashboard", "LayoutDashboard", "/dashboard", "Live", 1],
    ["Nasabah Corporate", "Users", "/customers", null, 2],
    ["Transaksi", "ArrowLeftRight", "/transactions", null, 3],
    ["Approval Center", "ShieldCheck", "/approval", "12", 4],
    ["Cabang & Area", "Building2", "/branches", null, 5],
    ["Analytics", "BarChart3", "/analytics", null, 6],
    ["Risk Monitor", "Shield", "/risk", null, 7],
    ["Laporan", "FileText", "/reports", null, 8],
    ["Pengaturan", "Settings", "/settings", null, 9],
  ];

  for (const menu of menus) {
    await pool
      .request()
      .input("name", sql.VarChar(100), menu[0])
      .input("icon", sql.VarChar(50), menu[1])
      .input("url", sql.VarChar(200), menu[2])
      .input("badge", sql.VarChar(20), menu[3])
      .input("sort_order", sql.Int, menu[4])
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.menus WHERE name = @name)
        BEGIN
          INSERT INTO dbo.menus (name, icon, url, badge, sort_order, is_active)
          VALUES (@name, @icon, @url, @badge, @sort_order, 1)
        END
      `);
  }

  await pool.close();
}

async function seedUsers() {
  const pool = await sql.connect({
    ...baseConfig,
    database: dbName,
  });

  const passwordHash = await bcrypt.hash("123456", 10);

  const users = [
    ["admin", "Admin Demo", "SUPER ADMIN"],
    ["manager", "Manager Corporate", "MANAGER"],
    ["operator", "Operator Cabang", "OPERATOR"],
  ];

  for (const user of users) {
    await pool
      .request()
      .input("username", sql.VarChar(50), user[0])
      .input("full_name", sql.VarChar(100), user[1])
      .input("role_name", sql.VarChar(50), user[2])
      .input("password_hash", sql.VarChar(255), passwordHash)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE username = @username)
        BEGIN
          INSERT INTO dbo.users (username, password_hash, full_name, role_id, is_active)
          SELECT @username, @password_hash, @full_name, id, 1
          FROM dbo.roles
          WHERE name = @role_name
        END
      `);
  }

  await pool.close();
}

async function seedRoleMenus() {
  const pool = await sql.connect({
    ...baseConfig,
    database: dbName,
  });

  await pool.request().query(`
    INSERT INTO dbo.role_menus (role_id, menu_id)
    SELECT r.id, m.id
    FROM dbo.roles r
    CROSS JOIN dbo.menus m
    WHERE r.name = 'SUPER ADMIN'
    AND NOT EXISTS (
      SELECT 1 FROM dbo.role_menus rm
      WHERE rm.role_id = r.id AND rm.menu_id = m.id
    )
  `);

  await pool.request().query(`
    INSERT INTO dbo.role_menus (role_id, menu_id)
    SELECT r.id, m.id
    FROM dbo.roles r
    JOIN dbo.menus m
      ON m.name IN ('Dashboard', 'Approval Center', 'Analytics', 'Laporan')
    WHERE r.name = 'MANAGER'
    AND NOT EXISTS (
      SELECT 1 FROM dbo.role_menus rm
      WHERE rm.role_id = r.id AND rm.menu_id = m.id
    )
  `);

  await pool.request().query(`
    INSERT INTO dbo.role_menus (role_id, menu_id)
    SELECT r.id, m.id
    FROM dbo.roles r
    JOIN dbo.menus m
      ON m.name IN ('Dashboard', 'Nasabah Corporate', 'Transaksi')
    WHERE r.name = 'OPERATOR'
    AND NOT EXISTS (
      SELECT 1 FROM dbo.role_menus rm
      WHERE rm.role_id = r.id AND rm.menu_id = m.id
    )
  `);

  await pool.close();
}

async function main() {
  try {
    await ensureDatabase();
    await ensureTables();
    await seedRoles();
    await seedMenus();
    await seedUsers();
    await seedRoleMenus();

    console.log("Database BGI_CORE berhasil dibuat.");
    console.log("User login:");
    console.log("admin / 123456");
    console.log("manager / 123456");
    console.log("operator / 123456");
  } catch (error) {
    console.error("Gagal setup database:", error);
  } finally {
    await sql.close();
  }
}

main();