import dotenv from "dotenv"
import bcrypt from "bcryptjs"
import sql from "mssql"
import { createInterface } from "node:readline/promises"
import { Writable } from "node:stream"
import process from "node:process"

/*
|--------------------------------------------------------------------------
| Membaca konfigurasi database dari .env.local
|--------------------------------------------------------------------------
*/

dotenv.config({
  path: ".env.local",
})

const isProduction = process.env.NODE_ENV === "production"

/*
|--------------------------------------------------------------------------
| Konfigurasi SQL Server
|--------------------------------------------------------------------------
*/

const databaseConfig = {
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  server: process.env.MSSQL_SERVER || "localhost",
  database: process.env.MSSQL_DATABASE || "BGI_CORE",

  options: {
    encrypt:
      process.env.MSSQL_ENCRYPT === undefined
        ? isProduction
        : process.env.MSSQL_ENCRYPT === "true",
    trustServerCertificate:
      process.env.MSSQL_TRUST_SERVER_CERTIFICATE === undefined
        ? !isProduction
        : process.env.MSSQL_TRUST_SERVER_CERTIFICATE === "true",
  },

  pool: {
    max: 5,
    min: 0,
    idleTimeoutMillis: 30000,
  },

  connectionTimeout: 15000,
  requestTimeout: 15000,
}

if (process.env.MSSQL_PORT) {
  const port = Number(process.env.MSSQL_PORT)

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(
      "MSSQL_PORT harus berupa angka yang valid."
    )
  }

  databaseConfig.port = port
}

/*
|--------------------------------------------------------------------------
| Output terminal untuk menyembunyikan password
|--------------------------------------------------------------------------
*/

const hiddenOutput = new Writable({
  write(chunk, encoding, callback) {
    if (!hiddenOutput.muted) {
      process.stdout.write(chunk, encoding)
    }

    callback()
  },
})

hiddenOutput.muted = false

const terminal = createInterface({
  input: process.stdin,
  output: hiddenOutput,
  terminal: true,
})

async function ask(question) {
  return terminal.question(question)
}

async function askHidden(question) {
  process.stdout.write(question)

  hiddenOutput.muted = true

  try {
    const answer = await terminal.question("")

    process.stdout.write("\n")

    return answer
  } finally {
    hiddenOutput.muted = false
  }
}

/*
|--------------------------------------------------------------------------
| Validasi environment
|--------------------------------------------------------------------------
*/

function validateEnvironment() {
  const requiredVariables = [
    "MSSQL_USER",
    "MSSQL_PASSWORD",
    "MSSQL_SERVER",
    "MSSQL_DATABASE",
  ]

  const missingVariables = requiredVariables.filter(
    (variableName) => {
      const value = process.env[variableName]

      return !value || !value.trim()
    }
  )

  if (missingVariables.length > 0) {
    throw new Error(
      `Konfigurasi .env.local belum lengkap: ${missingVariables.join(
        ", "
      )}`
    )
  }
}

/*
|--------------------------------------------------------------------------
| Validasi username
|--------------------------------------------------------------------------
*/

function validateUsername(username) {
  if (!username) {
    return "Username wajib diisi."
  }

  if (username.length < 4) {
    return "Username minimal 4 karakter."
  }

  if (username.length > 50) {
    return "Username maksimal 50 karakter."
  }

  if (!/^[a-z0-9._-]+$/.test(username)) {
    return [
      "Username hanya boleh menggunakan",
      "huruf kecil, angka, titik, garis bawah,",
      "atau tanda minus.",
    ].join(" ")
  }

  return null
}

/*
|--------------------------------------------------------------------------
| Validasi nama lengkap
|--------------------------------------------------------------------------
*/

function validateFullName(fullName) {
  if (!fullName) {
    return "Nama lengkap wajib diisi."
  }

  if (fullName.length < 3) {
    return "Nama lengkap minimal 3 karakter."
  }

  if (fullName.length > 100) {
    return "Nama lengkap maksimal 100 karakter."
  }

  return null
}

/*
|--------------------------------------------------------------------------
| Validasi email
|--------------------------------------------------------------------------
*/

function validateEmail(email) {
  if (!email) {
    return null
  }

  if (email.length > 150) {
    return "Email maksimal 150 karakter."
  }

  const emailPattern =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (!emailPattern.test(email)) {
    return "Format email tidak valid."
  }

  return null
}

/*
|--------------------------------------------------------------------------
| Validasi password
|--------------------------------------------------------------------------
*/

function validatePassword(password) {
  if (!password) {
    return "Password wajib diisi."
  }

  if (password.length < 10) {
    return "Password minimal 10 karakter."
  }

  if (password.length > 72) {
    return "Password maksimal 72 karakter."
  }

  if (!/[a-z]/.test(password)) {
    return "Password harus memiliki huruf kecil."
  }

  if (!/[A-Z]/.test(password)) {
    return "Password harus memiliki huruf besar."
  }

  if (!/[0-9]/.test(password)) {
    return "Password harus memiliki angka."
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Password harus memiliki karakter khusus."
  }

  return null
}

/*
|--------------------------------------------------------------------------
| Mengambil input pengguna
|--------------------------------------------------------------------------
*/

async function collectUserInput() {
  console.log("")
  console.log("================================")
  console.log(" PEMBUATAN AKUN SUPER ADMIN")
  console.log("================================")
  console.log("")

  const username = (
    await ask("Username: ")
  )
    .trim()
    .toLowerCase()

  const usernameError =
    validateUsername(username)

  if (usernameError) {
    throw new Error(usernameError)
  }

  const fullName = (
    await ask("Nama lengkap: ")
  ).trim()

  const fullNameError =
    validateFullName(fullName)

  if (fullNameError) {
    throw new Error(fullNameError)
  }

  const email = (
    await ask("Email, boleh dikosongkan: ")
  )
    .trim()
    .toLowerCase()

  const emailError = validateEmail(email)

  if (emailError) {
    throw new Error(emailError)
  }

  const password = await askHidden(
    "Password: "
  )

  const passwordError =
    validatePassword(password)

  if (passwordError) {
    throw new Error(passwordError)
  }

  const passwordConfirmation =
    await askHidden(
      "Konfirmasi password: "
    )

  if (password !== passwordConfirmation) {
    throw new Error(
      "Konfirmasi password tidak sama."
    )
  }

  return {
    username,
    fullName,
    email: email || null,
    password,
  }
}

/*
|--------------------------------------------------------------------------
| Memeriksa struktur database
|--------------------------------------------------------------------------
*/

async function validateDatabaseStructure(pool) {
  const result = await pool.request().query(`
    SELECT
      OBJECT_ID('dbo.roles', 'U') AS roles_table,
      OBJECT_ID('dbo.users', 'U') AS users_table;
  `)

  const databaseTables = result.recordset[0]

  if (!databaseTables.roles_table) {
    throw new Error(
      "Tabel dbo.roles tidak ditemukan."
    )
  }

  if (!databaseTables.users_table) {
    throw new Error(
      "Tabel dbo.users tidak ditemukan."
    )
  }
}

/*
|--------------------------------------------------------------------------
| Membuat akun Super Admin
|--------------------------------------------------------------------------
*/

async function createSuperAdmin(
  pool,
  userInput
) {
  const transaction =
    new sql.Transaction(pool)

  await transaction.begin(
    sql.ISOLATION_LEVEL.SERIALIZABLE
  )

  try {
    const roleRequest =
      new sql.Request(transaction)

    roleRequest.input(
      "roleCode",
      sql.VarChar(50),
      "SUPER_ADMIN"
    )

    const roleResult =
      await roleRequest.query(`
        SELECT TOP 1
          id,
          role_code,
          role_name
        FROM dbo.roles WITH
        (
          UPDLOCK,
          HOLDLOCK
        )
        WHERE role_code = @roleCode
          AND is_active = 1;
      `)

    if (roleResult.recordset.length === 0) {
      throw new Error(
        "Role SUPER_ADMIN tidak ditemukan atau tidak aktif."
      )
    }

    const role = roleResult.recordset[0]

    const duplicateRequest =
      new sql.Request(transaction)

    duplicateRequest.input(
      "username",
      sql.VarChar(50),
      userInput.username
    )

    duplicateRequest.input(
      "email",
      sql.VarChar(150),
      userInput.email
    )

    const duplicateResult =
      await duplicateRequest.query(`
        SELECT TOP 1
          id,
          username,
          email
        FROM dbo.users WITH
        (
          UPDLOCK,
          HOLDLOCK
        )
        WHERE username = @username
           OR
           (
             @email IS NOT NULL
             AND email = @email
           );
      `)

    if (duplicateResult.recordset.length > 0) {
      const duplicateUser =
        duplicateResult.recordset[0]

      if (
        duplicateUser.username ===
        userInput.username
      ) {
        throw new Error(
          "Username sudah digunakan."
        )
      }

      throw new Error(
        "Email sudah digunakan."
      )
    }

    const passwordHash =
      await bcrypt.hash(
        userInput.password,
        12
      )

    const insertRequest =
      new sql.Request(transaction)

    insertRequest.input(
      "username",
      sql.VarChar(50),
      userInput.username
    )

    insertRequest.input(
      "fullName",
      sql.VarChar(100),
      userInput.fullName
    )

    insertRequest.input(
      "email",
      sql.VarChar(150),
      userInput.email
    )

    insertRequest.input(
      "passwordHash",
      sql.VarChar(255),
      passwordHash
    )

    insertRequest.input(
      "roleId",
      sql.Int,
      role.id
    )

    const insertResult =
      await insertRequest.query(`
        INSERT INTO dbo.users
        (
          username,
          full_name,
          email,
          password_hash,
          role_id,
          is_active,
          must_change_password,
          failed_login_count,
          locked_until,
          last_login_at,
          password_changed_at,
          created_at,
          updated_at
        )
        OUTPUT
          inserted.id,
          inserted.username,
          inserted.full_name,
          inserted.email,
          inserted.role_id,
          inserted.is_active,
          inserted.must_change_password,
          inserted.created_at
        VALUES
        (
          @username,
          @fullName,
          @email,
          @passwordHash,
          @roleId,
          1,
          0,
          0,
          NULL,
          NULL,
          SYSDATETIME(),
          SYSDATETIME(),
          NULL
        );
      `)

    await transaction.commit()

    return {
      ...insertResult.recordset[0],
      roleCode: role.role_code,
      roleName: role.role_name,
    }
  } catch (error) {
    if (
      transaction._aborted !== true
    ) {
      try {
        await transaction.rollback()
      } catch {
        // Transaksi mungkin sudah dibatalkan SQL Server.
      }
    }

    throw error
  }
}

/*
|--------------------------------------------------------------------------
| Fungsi utama
|--------------------------------------------------------------------------
*/

async function main() {
  let pool

  try {
    validateEnvironment()

    const userInput =
      await collectUserInput()

    console.log("")
    console.log(
      "Menghubungkan ke SQL Server..."
    )

    pool = await new sql.ConnectionPool(
      databaseConfig
    ).connect()

    await validateDatabaseStructure(pool)

    const user = await createSuperAdmin(
      pool,
      userInput
    )

    console.log("")
    console.log(
      "Super Admin berhasil dibuat."
    )
    console.log(
      "--------------------------------"
    )
    console.log(`ID       : ${user.id}`)
    console.log(
      `Username : ${user.username}`
    )
    console.log(
      `Nama     : ${user.full_name}`
    )
    console.log(
      `Email    : ${user.email || "-"}`
    )
    console.log(
      `Role     : ${user.roleName}`
    )
    console.log(
      `Aktif    : ${
        user.is_active ? "Ya" : "Tidak"
      }`
    )
    console.log("")
  } catch (error) {
    console.error("")
    console.error(
      "Gagal membuat Super Admin:"
    )

    console.error(
      error instanceof Error
        ? error.message
        : String(error)
    )

    process.exitCode = 1
  } finally {
    hiddenOutput.muted = false

    terminal.close()

    if (pool) {
      await pool.close()
    }
  }
}

await main()