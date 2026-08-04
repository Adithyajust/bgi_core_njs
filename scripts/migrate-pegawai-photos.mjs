import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"

import dotenv from "dotenv"

dotenv.config({ path: ".env.local" })

const { connectDB, closeDB, sql } = await import("../lib/mssql.js")
const {
  getPegawaiPhotoPath,
  isSafePegawaiPhotoFileName,
  PEGAWAI_PHOTO_PRIVATE_PREFIX,
} = await import("../lib/pegawai-photo.js")

const legacyPrefix = "/uploads/pegawai/"
const legacyDirectory = path.join(process.cwd(), "public", "uploads", "pegawai")

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function main() {
  const db = await connectDB()
  const result = await db.request().query(`
    SELECT id, foto
    FROM dbo.pegawai
    WHERE foto LIKE '/uploads/pegawai/%';
  `)

  let migrated = 0
  let skipped = 0

  for (const row of result.recordset) {
    const fileName = String(row.foto || "").slice(legacyPrefix.length)
    if (!isSafePegawaiPhotoFileName(fileName)) {
      console.warn(`SKIP pegawai ${row.id}: nama file tidak aman.`)
      skipped += 1
      continue
    }

    const sourcePath = path.join(legacyDirectory, fileName)
    const targetPath = getPegawaiPhotoPath(fileName)
    await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o750 })

    if (!(await fileExists(targetPath))) {
      if (!(await fileExists(sourcePath))) {
        console.warn(`SKIP pegawai ${row.id}: file tidak ditemukan.`)
        skipped += 1
        continue
      }
      await fs.copyFile(sourcePath, targetPath)
      await fs.chmod(targetPath, 0o640)
    }

    await db
      .request()
      .input("id", sql.Int, row.id)
      .input("foto", sql.VarChar(255), `${PEGAWAI_PHOTO_PRIVATE_PREFIX}${fileName}`)
      .query(`UPDATE dbo.pegawai SET foto = @foto, updated_at = SYSDATETIME() WHERE id = @id;`)

    if (await fileExists(sourcePath)) await fs.unlink(sourcePath)
    migrated += 1
  }

  console.log(`Foto dimigrasikan: ${migrated}. Dilewati: ${skipped}.`)
}

main()
  .catch((error) => {
    console.error("Migrasi foto pegawai gagal:", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDB().catch(() => {})
  })
