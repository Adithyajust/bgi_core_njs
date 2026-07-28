import dotenv from "dotenv"
import bcrypt from "bcryptjs"
import sql from "mssql"
import process from "node:process"
import { createInterface } from "node:readline/promises"
import { Writable } from "node:stream"

dotenv.config({
  path: ".env.local",
})

const databaseConfig = {
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  server: process.env.MSSQL_SERVER || "localhost",
  database: process.env.MSSQL_DATABASE,
  port: Number(
    process.env.MSSQL_PORT || 1433
  ),

  options: {
    encrypt:
      process.env.MSSQL_ENCRYPT ===
      "true",

    trustServerCertificate:
      process.env
        .MSSQL_TRUST_SERVER_CERTIFICATE !==
      "false",
  },

  pool: {
    max: 5,
    min: 0,
    idleTimeoutMillis: 30000,
  },

  connectionTimeout: 15000,
  requestTimeout: 15000,
}

/*
|--------------------------------------------------------------------------
| Terminal dengan password tersembunyi
|--------------------------------------------------------------------------
*/

const hiddenOutput = new Writable({
  write(chunk, encoding, callback) {
    if (!hiddenOutput.muted) {
      process.stdout.write(
        chunk,
        encoding
      )
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
    const value =
      await terminal.question("")

    process.stdout.write("\n")

    return value
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

  const missingVariables =
    requiredVariables.filter(
      (variableName) => {
        const value =
          process.env[variableName]

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

  if (
    !Number.isInteger(
      databaseConfig.port
    ) ||
    databaseConfig.port <= 0
  ) {
    throw new Error(
      "MSSQL_PORT tidak valid."
    )
  }
}

/*
|--------------------------------------------------------------------------
| Validasi input
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

  if (
    !/^[a-z0-9._-]+$/.test(
      username
    )
  ) {
    return [
      "Username hanya boleh berisi",
      "huruf kecil, angka, titik,",
      "garis bawah, dan tanda minus.",
    ].join(" ")
  }

  return null
}

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

  if (
    !/[^A-Za-z0-9]/.test(password)
  ) {
    return "Password harus memiliki karakter khusus."
  }

  return null
}

/*
|--------------------------------------------------------------------------
| Mengambil daftar role aktif
|--------------------------------------------------------------------------
*/

async function getActiveRoles(pool) {
  const result = await pool
    .request()
    .query(`
      SELECT
        id,
        role_code,
        role_name
      FROM dbo.roles
      WHERE is_active = 1
      ORDER BY id;
    `)

  return result.recordset
}

async function getActiveUkers(pool) {
  const result = await pool
    .request()
    .query(`
      SELECT
        id,
        codeuker,
        nama_uker
      FROM dbo.master_uker
      ORDER BY codeuker ASC, nama_uker ASC;
    `)

  return result.recordset
}

function showRoleOptions(roles) {
  console.log("")
  console.log("Daftar role aktif:")
  console.log(
    "--------------------------------"
  )

  roles.forEach((role, index) => {
    console.log(
      `${index + 1}. ${
        role.role_name
      } (${role.role_code})`
    )
  })

  console.log(
    "--------------------------------"
  )
}

async function selectRole(roles) {
  showRoleOptions(roles)

  const selectedValue = (
    await ask(
      "Pilih nomor role: "
    )
  ).trim()

  const selectedIndex =
    Number(selectedValue) - 1

  if (
    !Number.isInteger(
      selectedIndex
    ) ||
    selectedIndex < 0 ||
    selectedIndex >= roles.length
  ) {
    throw new Error(
      "Pilihan role tidak valid."
    )
  }

  return roles[selectedIndex]
}

function showUkerOptions(ukers) {
  console.log("")
  console.log("Daftar unit kerja:")
  console.log("--------------------------------")

  ukers.forEach((uker, index) => {
    console.log(
      `${index + 1}. ${uker.codeuker} - ${uker.nama_uker}`
    )
  })

  console.log("--------------------------------")
}

async function selectUker(ukers) {
  if (ukers.length === 0) {
    throw new Error(
      "Belum ada data unit kerja. Tambahkan master uker terlebih dahulu."
    )
  }

  showUkerOptions(ukers)

  const selectedValue = (
    await ask("Pilih nomor unit kerja: ")
  ).trim()

  const selectedIndex = Number(selectedValue) - 1

  if (
    !Number.isInteger(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= ukers.length
  ) {
    throw new Error("Pilihan unit kerja tidak valid.")
  }

  return ukers[selectedIndex]
}

/*
|--------------------------------------------------------------------------
| Mengambil data user dari terminal
|--------------------------------------------------------------------------
*/

async function collectUserInput(
  roles,
  ukers
) {
  console.log("")
  console.log(
    "================================"
  )
  console.log(
    " PEMBUATAN AKUN PENGGUNA"
  )
  console.log(
    "================================"
  )

  const selectedRole =
    await selectRole(roles)

  const selectedUker =
    selectedRole.role_code === "SUPER_ADMIN"
      ? null
      : await selectUker(ukers)

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
    await ask(
      "Email, boleh dikosongkan: "
    )
  )
    .trim()
    .toLowerCase()

  const emailError =
    validateEmail(email)

  if (emailError) {
    throw new Error(emailError)
  }

  const password =
    await askHidden("Password: ")

  const passwordError =
    validatePassword(password)

  if (passwordError) {
    throw new Error(passwordError)
  }

  const passwordConfirmation =
    await askHidden(
      "Konfirmasi password: "
    )

  if (
    password !==
    passwordConfirmation
  ) {
    throw new Error(
      "Konfirmasi password tidak sama."
    )
  }

  return {
    username,
    fullName,
    email: email || null,
    password,
    role: selectedRole,
    codeUker: selectedUker?.codeuker || null,
  }
}

/*
|--------------------------------------------------------------------------
| Membuat user
|--------------------------------------------------------------------------
*/

async function createUser(
  pool,
  userInput
) {
  const transaction =
    new sql.Transaction(pool)

  await transaction.begin(
    sql.ISOLATION_LEVEL.SERIALIZABLE
  )

  try {
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
        WHERE
          username = @username
          OR
          (
            @email IS NOT NULL
            AND email = @email
          );
      `)

    if (
      duplicateResult.recordset
        .length > 0
    ) {
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

    const roleRequest =
      new sql.Request(transaction)

    roleRequest.input(
      "roleId",
      sql.Int,
      userInput.role.id
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
        WHERE id = @roleId
          AND is_active = 1;
      `)

    if (
      roleResult.recordset.length === 0
    ) {
      throw new Error(
        "Role tidak ditemukan atau tidak aktif."
      )
    }

    const activeRole =
      roleResult.recordset[0]

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
      activeRole.id
    )

    insertRequest.input(
      "codeUker",
      sql.NVarChar(4),
      activeRole.role_code === "SUPER_ADMIN"
        ? null
        : userInput.codeUker
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
          codeuker,
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
          inserted.codeuker,
          inserted.is_active,
          inserted.created_at
        VALUES
        (
          @username,
          @fullName,
          @email,
          @passwordHash,
          @roleId,
          @codeUker,
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
      roleCode:
        activeRole.role_code,
      roleName:
        activeRole.role_name,
    }
  } catch (error) {
    try {
      await transaction.rollback()
    } catch {
      // Transaksi mungkin telah dibatalkan.
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

    pool =
      await new sql.ConnectionPool(
        databaseConfig
      ).connect()

    const [roles, ukers] = await Promise.all([
      getActiveRoles(pool),
      getActiveUkers(pool),
    ])

    if (roles.length === 0) {
      throw new Error(
        "Tidak ada role aktif."
      )
    }

    const userInput =
      await collectUserInput(roles, ukers)

    const user = await createUser(
      pool,
      userInput
    )

    console.log("")
    console.log(
      "Akun pengguna berhasil dibuat."
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
      `Kode     : ${user.roleCode}`
    )
    console.log(
      `Uker     : ${user.codeuker || "Semua unit kerja"}`
    )
    console.log(
      `Aktif    : ${
        user.is_active ? "Ya" : "Tidak"
      }`
    )
  } catch (error) {
    console.error("")
    console.error(
      "Gagal membuat akun:"
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