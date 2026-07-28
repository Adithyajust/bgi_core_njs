import { NextResponse } from "next/server"

import {
  authorizeApiRequest,
  getUserDataScope,
} from "@/lib/access-control"
import { connectDB, sql } from "@/lib/mssql"
import {
  deleteManagedPegawaiPhoto,
  preparePegawaiPhoto,
  savePreparedPegawaiPhoto,
} from "@/lib/pegawai-photo"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function createErrorResponse(message, status = 400, extra = {}) {
  return NextResponse.json(
    { success: false, message, ...extra },
    { status }
  )
}

function getServerErrorMessage(error) {
  return (
    error?.originalError?.info?.message ||
    error?.precedingErrors?.[0]?.message ||
    error?.message ||
    "Kesalahan server tidak diketahui."
  )
}

function createInternalErrorResponse(error, fallbackMessage) {
  const details = getServerErrorMessage(error)
  const isDevelopment = process.env.NODE_ENV !== "production"

  return createErrorResponse(
    isDevelopment
      ? `${fallbackMessage} Detail: ${details}`
      : fallbackMessage,
    500,
    isDevelopment
      ? {
          error_code: error?.code || null,
          sql_error_number: getSqlErrorNumber(error),
        }
      : {}
  )
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value)
  return normalized || null
}

function normalizeEmail(value) {
  const normalized = normalizeText(value).toLowerCase()
  return normalized || null
}

function normalizeBoolean(value, defaultValue = true) {
  if (value === undefined || value === null || value === "") {
    return defaultValue
  }

  return value === true || value === 1 || value === "1" || value === "true"
}

function normalizeId(value) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

async function parsePegawaiRequest(request) {
  const contentType = request.headers.get("content-type") || ""

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData()

    return {
      body: {
        id: formData.get("id"),
        nip: formData.get("nip"),
        ktp: formData.get("ktp"),
        nama: formData.get("nama"),
        alamat: formData.get("alamat"),
        jabatan: formData.get("jabatan"),
        handphone: formData.get("handphone"),
        email: formData.get("email"),
        status: formData.get("status"),
        status_peg: formData.get("status_peg"),
        tgl_lahir: formData.get("tgl_lahir"),
        tgl_job: formData.get("tgl_job"),
        foto: formData.get("foto"),
        uker_id: formData.get("uker_id"),
      },
      photoFile: formData.get("foto_file"),
      removePhoto: normalizeBoolean(formData.get("remove_photo"), false),
      isMultipart: true,
    }
  }

  return {
    body: await request.json(),
    photoFile: null,
    removePhoto: false,
    isMultipart: false,
  }
}

function parseOptionalDate(value, label) {
  const normalized = normalizeText(value)

  if (!normalized) {
    return { value: null, error: null }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return { value: null, error: `${label} harus menggunakan format YYYY-MM-DD.` }
  }

  const [year, month, day] = normalized.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { value: null, error: `${label} tidak valid.` }
  }

  return { value: date, error: null }
}

function validateMaximumLength(label, value, maximumLength) {
  if (value && value.length > maximumLength) {
    return `${label} maksimal ${maximumLength} karakter.`
  }

  return null
}

function validatePegawaiPayload(body) {
  const nip = normalizeText(body.nip)
  const ktp = normalizeText(body.ktp)
  const nama = normalizeText(body.nama)
  const alamat = normalizeText(body.alamat)
  const jabatan = normalizeNullableText(body.jabatan)
  const handphone = normalizeNullableText(body.handphone)
  const email = normalizeEmail(body.email)
  const status = normalizeBoolean(body.status, true)
  const statusPeg = normalizeNullableText(body.status_peg)
  const foto = normalizeNullableText(body.foto)
  const ukerId = normalizeId(body.uker_id)
  const tanggalLahir = parseOptionalDate(body.tgl_lahir, "Tanggal lahir")
  const tanggalJob = parseOptionalDate(body.tgl_job, "Tanggal mulai bekerja")

  if (!nip) {
    return { error: "NIP wajib diisi.", data: null }
  }

  if (!ktp) {
    return { error: "Nomor KTP wajib diisi.", data: null }
  }

  if (!nama) {
    return { error: "Nama pegawai wajib diisi.", data: null }
  }

  if (!alamat) {
    return { error: "Alamat pegawai wajib diisi.", data: null }
  }

  if (!ukerId) {
    return { error: "Unit kerja wajib dipilih.", data: null }
  }

  const validationErrors = [
    validateMaximumLength("NIP", nip, 50),
    validateMaximumLength("Nomor KTP", ktp, 50),
    !/^\d+$/.test(ktp)
      ? "Nomor KTP hanya boleh berisi angka."
      : null,
    ktp.length !== 16
      ? "Nomor KTP harus terdiri dari 16 digit."
      : null,
    validateMaximumLength("Nama pegawai", nama, 100),
    validateMaximumLength("Alamat pegawai", alamat, 255),
    validateMaximumLength("Jabatan", jabatan, 100),
    validateMaximumLength("Nomor handphone", handphone, 30),
    validateMaximumLength("Email", email, 150),
    validateMaximumLength("Status kepegawaian", statusPeg, 50),
    validateMaximumLength("Foto", foto, 255),
    email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? "Format email tidak valid."
      : null,
    tanggalLahir.error,
    tanggalJob.error,
  ].filter(Boolean)

  if (validationErrors.length > 0) {
    return { error: validationErrors[0], data: null }
  }

  if (
    tanggalLahir.value &&
    tanggalJob.value &&
    tanggalJob.value < tanggalLahir.value
  ) {
    return {
      error: "Tanggal mulai bekerja tidak boleh lebih awal dari tanggal lahir.",
      data: null,
    }
  }

  return {
    error: null,
    data: {
      nip,
      ktp,
      nama,
      alamat,
      jabatan,
      handphone,
      email,
      status,
      statusPeg,
      tanggalLahir: tanggalLahir.value,
      tanggalJob: tanggalJob.value,
      foto,
      ukerId,
    },
  }
}

function getSqlErrorNumber(error) {
  return (
    error?.number ||
    error?.originalError?.info?.number ||
    error?.precedingErrors?.[0]?.number ||
    null
  )
}

async function authorizeMaster(request) {
  return authorizeApiRequest(request, "/masters")
}

function requireSuperAdmin(authorization) {
  if (authorization.user.role_code === "SUPER_ADMIN") {
    return null
  }

  return createErrorResponse(
    "Hanya Super Admin yang dapat mengubah master pegawai.",
    403
  )
}

async function getUkerById(db, ukerId) {
  const result = await db
    .request()
    .input("ukerId", sql.BigInt, ukerId)
    .query(`
      SELECT TOP 1 id, codeuker, nama_uker
      FROM dbo.master_uker
      WHERE id = @ukerId;
    `)

  return result.recordset[0] || null
}

async function getUnsupportedRequiredPegawaiColumns(db) {
  const result = await db.request().query(`
    SELECT c.name AS column_name
    FROM sys.columns c
    INNER JOIN sys.tables t ON t.object_id = c.object_id
    INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
    INNER JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    LEFT JOIN sys.default_constraints dc
      ON dc.parent_object_id = c.object_id
     AND dc.parent_column_id = c.column_id
    WHERE s.name = N'dbo'
      AND t.name = N'pegawai'
      AND c.is_nullable = 0
      AND c.is_identity = 0
      AND c.is_computed = 0
      AND dc.object_id IS NULL
      AND ty.name NOT IN (N'timestamp', N'rowversion')
      AND c.name NOT IN (
        N'nip', N'ktp', N'nama', N'alamat', N'jabatan', N'handphone',
        N'email', N'status', N'status_peg', N'tgl_lahir', N'tgl_job',
        N'foto', N'uker_id', N'created_at', N'updated_at'
      )
    ORDER BY c.column_id;
  `)

  return result.recordset.map((row) => row.column_name)
}

async function getPegawaiById(db, id) {
  const result = await db
    .request()
    .input("id", sql.Int, id)
    .query(`
      SELECT TOP 1
        p.id,
        p.nip,
        p.ktp,
        p.nama,
        p.alamat,
        p.jabatan,
        p.handphone,
        p.email,
        p.status,
        p.status_peg,
        CONVERT(CHAR(10), p.tgl_lahir, 23) AS tgl_lahir,
        CONVERT(CHAR(10), p.tgl_job, 23) AS tgl_job,
        p.foto,
        p.uker_id,
        mu.codeuker,
        mu.nama_uker,
        p.created_at,
        p.updated_at,
        linked_user.id AS user_id,
        linked_user.username,
        linked_user.role_code,
        linked_user.role_name,
        linked_user.is_active AS user_is_active
      FROM dbo.pegawai p
      INNER JOIN dbo.master_uker mu ON mu.id = p.uker_id
      OUTER APPLY (
        SELECT TOP 1
          u.id,
          u.username,
          r.role_code,
          r.role_name,
          u.is_active
        FROM dbo.users u
        INNER JOIN dbo.roles r ON r.id = u.role_id
        WHERE u.pegawai_id = p.id
        ORDER BY u.id
      ) linked_user
      WHERE p.id = @id;
    `)

  return result.recordset[0] || null
}

async function isNipAvailable(db, nip, ignoredId = null) {
  const dbRequest = db.request().input("nip", sql.VarChar(50), nip)
  let query = `SELECT TOP 1 id FROM dbo.pegawai WHERE nip = @nip`

  if (ignoredId) {
    dbRequest.input("ignoredId", sql.Int, ignoredId)
    query += " AND id <> @ignoredId"
  }

  const result = await dbRequest.query(`${query};`)
  return result.recordset.length === 0
}

async function isKtpAvailable(db, ktp, ignoredId = null) {
  const dbRequest = db.request().input("ktp", sql.VarChar(50), ktp)
  let query = `SELECT TOP 1 id FROM dbo.pegawai WHERE ktp = @ktp`

  if (ignoredId) {
    dbRequest.input("ignoredId", sql.Int, ignoredId)
    query += " AND id <> @ignoredId"
  }

  const result = await dbRequest.query(`${query};`)
  return result.recordset.length === 0
}

async function isEmailAvailable(db, email, ignoredPegawaiId = null) {
  if (!email) {
    return true
  }

  const result = await db
    .request()
    .input("email", sql.VarChar(150), email)
    .input("ignoredPegawaiId", sql.Int, ignoredPegawaiId)
    .query(`
      SELECT TOP 1 source_name
      FROM (
        SELECT 'pegawai' AS source_name
        FROM dbo.pegawai p
        WHERE LOWER(p.email) = @email
          AND (
            @ignoredPegawaiId IS NULL
            OR p.id <> @ignoredPegawaiId
          )

        UNION ALL

        SELECT 'users' AS source_name
        FROM dbo.users u
        WHERE LOWER(u.email) = @email
          AND (
            @ignoredPegawaiId IS NULL
            OR u.pegawai_id IS NULL
            OR u.pegawai_id <> @ignoredPegawaiId
          )
      ) duplicate_email;
    `)

  return result.recordset.length === 0
}

async function countOtherActiveSuperAdmins(db, ignoredUserId) {
  const result = await db
    .request()
    .input("ignoredUserId", sql.Int, ignoredUserId)
    .query(`
      SELECT COUNT_BIG(*) AS total
      FROM dbo.users u
      INNER JOIN dbo.roles r ON r.id = u.role_id
      WHERE r.role_code = 'SUPER_ADMIN'
        AND u.is_active = 1
        AND u.id <> @ignoredUserId;
    `)

  return Number(result.recordset[0]?.total || 0)
}

export async function GET(request) {
  const authorization = await authorizeMaster(request)

  if (!authorization.authorized) {
    return authorization.response
  }

  try {
    const db = await connectDB()
    const scope = getUserDataScope(authorization.user)

    if (!scope.isSuperAdmin && !scope.codeUker) {
      return createErrorResponse(
        "Akun Anda belum terhubung dengan unit kerja.",
        403
      )
    }

    const result = await db
      .request()
      .input("codeUker", sql.NVarChar(20), scope.codeUker)
      .query(`
        SELECT
          p.id,
          p.nip,
          p.ktp,
          p.nama,
          p.alamat,
          p.jabatan,
          p.handphone,
          p.email,
          p.status,
          p.status_peg,
          CONVERT(CHAR(10), p.tgl_lahir, 23) AS tgl_lahir,
          CONVERT(CHAR(10), p.tgl_job, 23) AS tgl_job,
          p.foto,
          p.uker_id,
          mu.codeuker,
          mu.nama_uker,
          p.created_at,
          p.updated_at,
          linked_user.id AS user_id,
          linked_user.username,
          linked_user.role_name,
          linked_user.is_active AS user_is_active
        FROM dbo.pegawai p
        INNER JOIN dbo.master_uker mu ON mu.id = p.uker_id
        OUTER APPLY (
          SELECT TOP 1
            u.id,
            u.username,
            r.role_name,
            u.is_active
          FROM dbo.users u
          INNER JOIN dbo.roles r ON r.id = u.role_id
          WHERE u.pegawai_id = p.id
          ORDER BY u.id
        ) linked_user
        WHERE @codeUker IS NULL OR mu.codeuker = @codeUker
        ORDER BY p.nama ASC, p.nip ASC, p.id ASC;
      `)

    return NextResponse.json({
      success: true,
      data: {
        pegawai: result.recordset,
        scope: {
          isSuperAdmin: scope.isSuperAdmin,
          codeuker: scope.codeUker,
        },
      },
    })
  } catch (error) {
    console.error("GET master pegawai error:", error)
    return createInternalErrorResponse(error, "Gagal mengambil data pegawai.")
  }
}

export async function POST(request) {
  const authorization = await authorizeMaster(request)

  if (!authorization.authorized) {
    return authorization.response
  }

  const forbiddenResponse = requireSuperAdmin(authorization)
  if (forbiddenResponse) return forbiddenResponse

  let savedPhotoPath = null
  let databaseWritten = false

  try {
    const parsedRequest = await parsePegawaiRequest(request)
    const validation = validatePegawaiPayload(parsedRequest.body)

    if (validation.error) {
      return createErrorResponse(validation.error)
    }

    const photoValidation = await preparePegawaiPhoto(parsedRequest.photoFile)

    if (photoValidation.error) {
      return createErrorResponse(photoValidation.error)
    }

    const db = await connectDB()
    const unsupportedRequiredColumns = await getUnsupportedRequiredPegawaiColumns(db)

    if (unsupportedRequiredColumns.length > 0) {
      return createErrorResponse(
        `Struktur tabel pegawai masih memiliki kolom wajib yang belum didukung form: ${unsupportedRequiredColumns.join(", ")}.`,
        409
      )
    }

    const uker = await getUkerById(db, validation.data.ukerId)

    if (!uker) {
      return createErrorResponse("Unit kerja tidak ditemukan.", 404)
    }

    if (!(await isNipAvailable(db, validation.data.nip))) {
      return createErrorResponse("NIP sudah digunakan.", 409)
    }

    if (!(await isKtpAvailable(db, validation.data.ktp))) {
      return createErrorResponse("Nomor KTP sudah digunakan.", 409)
    }

    if (!(await isEmailAvailable(db, validation.data.email))) {
      return createErrorResponse("Email sudah digunakan pegawai lain.", 409)
    }

    if (photoValidation.data) {
      savedPhotoPath = await savePreparedPegawaiPhoto(
        photoValidation.data,
        validation.data.nip
      )
    }

    const photoPath = savedPhotoPath ||
      (parsedRequest.isMultipart ? null : validation.data.foto)

    const result = await db
      .request()
      .input("nip", sql.VarChar(50), validation.data.nip)
      .input("ktp", sql.VarChar(50), validation.data.ktp)
      .input("nama", sql.VarChar(100), validation.data.nama)
      .input("alamat", sql.NVarChar(255), validation.data.alamat)
      .input("jabatan", sql.VarChar(100), validation.data.jabatan)
      .input("handphone", sql.VarChar(30), validation.data.handphone)
      .input("email", sql.VarChar(150), validation.data.email)
      .input("status", sql.Bit, validation.data.status)
      .input("statusPeg", sql.VarChar(50), validation.data.statusPeg)
      .input("tanggalLahir", sql.Date, validation.data.tanggalLahir)
      .input("tanggalJob", sql.Date, validation.data.tanggalJob)
      .input("foto", sql.VarChar(255), photoPath)
      .input("ukerId", sql.BigInt, validation.data.ukerId)
      .query(`
        DECLARE @pegawaiBaru TABLE (id INT NOT NULL);

        INSERT INTO dbo.pegawai
        (
          nip, ktp, nama, alamat, jabatan, handphone, email, status, status_peg,
          tgl_lahir, tgl_job, foto, uker_id, created_at, updated_at
        )
        OUTPUT inserted.id INTO @pegawaiBaru (id)
        VALUES
        (
          @nip, @ktp, @nama, @alamat, @jabatan, @handphone, @email, @status, @statusPeg,
          @tanggalLahir, @tanggalJob, @foto, @ukerId,
          SYSDATETIME(), SYSDATETIME()
        );

        SELECT TOP 1 id FROM @pegawaiBaru;
      `)

    const createdId = result.recordset?.[0]?.id

    if (!createdId) {
      throw new Error("Database tidak mengembalikan ID pegawai yang baru dibuat.")
    }

    databaseWritten = true
    const createdPegawai = await getPegawaiById(db, createdId)

    return NextResponse.json(
      {
        success: true,
        message: "Data pegawai berhasil ditambahkan.",
        data: createdPegawai,
      },
      { status: 201 }
    )
  } catch (error) {
    if (savedPhotoPath && !databaseWritten) {
      try {
        await deleteManagedPegawaiPhoto(savedPhotoPath)
      } catch (cleanupError) {
        console.warn("Gagal membersihkan foto pegawai baru:", cleanupError)
      }
    }

    console.error("POST master pegawai error:", error)

    if (error instanceof SyntaxError) {
      return createErrorResponse("Format data tidak valid.")
    }

    const sqlErrorNumber = getSqlErrorNumber(error)
    if (sqlErrorNumber === 2601 || sqlErrorNumber === 2627) {
      return createErrorResponse("NIP, nomor KTP, atau email sudah digunakan.", 409)
    }

    return createInternalErrorResponse(error, "Gagal menambahkan data pegawai.")
  }
}

export async function PUT(request) {
  const authorization = await authorizeMaster(request)

  if (!authorization.authorized) {
    return authorization.response
  }

  const forbiddenResponse = requireSuperAdmin(authorization)
  if (forbiddenResponse) return forbiddenResponse

  let savedPhotoPath = null
  let databaseCommitted = false

  try {
    const parsedRequest = await parsePegawaiRequest(request)
    const id = normalizeId(parsedRequest.body.id)

    if (!id) {
      return createErrorResponse("ID pegawai tidak valid.")
    }

    const validation = validatePegawaiPayload(parsedRequest.body)
    if (validation.error) return createErrorResponse(validation.error)

    const photoValidation = await preparePegawaiPhoto(parsedRequest.photoFile)

    if (photoValidation.error) {
      return createErrorResponse(photoValidation.error)
    }

    const db = await connectDB()
    const existingPegawai = await getPegawaiById(db, id)

    if (!existingPegawai) {
      return createErrorResponse("Data pegawai tidak ditemukan.", 404)
    }

    const uker = await getUkerById(db, validation.data.ukerId)
    if (!uker) return createErrorResponse("Unit kerja tidak ditemukan.", 404)

    if (!(await isNipAvailable(db, validation.data.nip, id))) {
      return createErrorResponse("NIP sudah digunakan.", 409)
    }

    if (!(await isKtpAvailable(db, validation.data.ktp, id))) {
      return createErrorResponse("Nomor KTP sudah digunakan.", 409)
    }

    if (!(await isEmailAvailable(db, validation.data.email, id))) {
      return createErrorResponse("Email sudah digunakan pegawai lain.", 409)
    }

    if (
      !validation.data.status &&
      existingPegawai.user_id &&
      Boolean(existingPegawai.user_is_active)
    ) {
      return createErrorResponse(
        `Nonaktifkan akun @${existingPegawai.username} terlebih dahulu sebelum menonaktifkan pegawai.`,
        409
      )
    }

    let photoPath = parsedRequest.isMultipart
      ? existingPegawai.foto
      : validation.data.foto

    if (parsedRequest.isMultipart && parsedRequest.removePhoto) {
      photoPath = null
    }

    if (photoValidation.data) {
      savedPhotoPath = await savePreparedPegawaiPhoto(
        photoValidation.data,
        validation.data.nip
      )
      photoPath = savedPhotoPath
    }

    const transaction = new sql.Transaction(db)
    await transaction.begin()

    try {
      await new sql.Request(transaction)
        .input("id", sql.Int, id)
        .input("nip", sql.VarChar(50), validation.data.nip)
        .input("ktp", sql.VarChar(50), validation.data.ktp)
        .input("nama", sql.VarChar(100), validation.data.nama)
        .input("alamat", sql.NVarChar(255), validation.data.alamat)
        .input("jabatan", sql.VarChar(100), validation.data.jabatan)
        .input("handphone", sql.VarChar(30), validation.data.handphone)
        .input("email", sql.VarChar(150), validation.data.email)
        .input("status", sql.Bit, validation.data.status)
        .input("statusPeg", sql.VarChar(50), validation.data.statusPeg)
        .input("tanggalLahir", sql.Date, validation.data.tanggalLahir)
        .input("tanggalJob", sql.Date, validation.data.tanggalJob)
        .input("foto", sql.VarChar(255), photoPath)
        .input("ukerId", sql.BigInt, validation.data.ukerId)
        .query(`
          UPDATE dbo.pegawai
          SET
            nip = @nip,
            ktp = @ktp,
            nama = @nama,
            alamat = @alamat,
            jabatan = @jabatan,
            handphone = @handphone,
            email = @email,
            status = @status,
            status_peg = @statusPeg,
            tgl_lahir = @tanggalLahir,
            tgl_job = @tanggalJob,
            foto = @foto,
            uker_id = @ukerId,
            updated_at = SYSDATETIME()
          WHERE id = @id;
        `)

      await new sql.Request(transaction)
        .input("pegawaiId", sql.Int, id)
        .input("nama", sql.VarChar(100), validation.data.nama)
        .input("email", sql.VarChar(150), validation.data.email)
        .input("codeUker", sql.NVarChar(20), uker.codeuker)
        .query(`
          UPDATE u
          SET
            u.full_name = @nama,
            u.email = @email,
            u.codeuker = CASE
              WHEN r.role_code = 'SUPER_ADMIN' THEN NULL
              ELSE @codeUker
            END,
            u.updated_at = SYSDATETIME()
          FROM dbo.users u
          INNER JOIN dbo.roles r ON r.id = u.role_id
          WHERE u.pegawai_id = @pegawaiId;
        `)

      if (Number(existingPegawai.uker_id) !== Number(validation.data.ukerId)) {
        await new sql.Request(transaction)
          .input("pegawaiId", sql.Int, id)
          .query(`
            UPDATE us
            SET revoked_at = SYSDATETIME()
            FROM dbo.user_sessions us
            INNER JOIN dbo.users u ON u.id = us.user_id
            WHERE u.pegawai_id = @pegawaiId
              AND us.revoked_at IS NULL;
          `)
      }

      await transaction.commit()
      databaseCommitted = true
    } catch (error) {
      await transaction.rollback()
      throw error
    }

    const updatedPegawai = await getPegawaiById(db, id)

    if (existingPegawai.foto && existingPegawai.foto !== photoPath) {
      try {
        await deleteManagedPegawaiPhoto(existingPegawai.foto)
      } catch (cleanupError) {
        console.warn("Gagal menghapus foto pegawai lama:", cleanupError)
      }
    }

    return NextResponse.json({
      success: true,
      message: "Data pegawai dan akun terkait berhasil diperbarui.",
      data: updatedPegawai,
    })
  } catch (error) {
    if (savedPhotoPath && !databaseCommitted) {
      try {
        await deleteManagedPegawaiPhoto(savedPhotoPath)
      } catch (cleanupError) {
        console.warn("Gagal membersihkan foto pegawai pengganti:", cleanupError)
      }
    }

    console.error("PUT master pegawai error:", error)

    if (error instanceof SyntaxError) {
      return createErrorResponse("Format data tidak valid.")
    }

    const sqlErrorNumber = getSqlErrorNumber(error)
    if (sqlErrorNumber === 2601 || sqlErrorNumber === 2627) {
      return createErrorResponse("NIP, nomor KTP, atau email sudah digunakan.", 409)
    }

    return createInternalErrorResponse(error, "Gagal memperbarui data pegawai.")
  }
}

export async function DELETE(request) {
  const authorization = await authorizeMaster(request)

  if (!authorization.authorized) {
    return authorization.response
  }

  const forbiddenResponse = requireSuperAdmin(authorization)
  if (forbiddenResponse) return forbiddenResponse

  try {
    const body = await request.json()
    const id = normalizeId(body.id)
    const deleteLinkedUser = normalizeBoolean(body.delete_linked_user, false)

    if (!id) {
      return createErrorResponse("ID pegawai tidak valid.")
    }

    const db = await connectDB()
    const existingPegawai = await getPegawaiById(db, id)

    if (!existingPegawai) {
      return createErrorResponse("Data pegawai tidak ditemukan.", 404)
    }

    if (existingPegawai.user_id && !deleteLinkedUser) {
      return createErrorResponse(
        `Pegawai masih terhubung dengan akun @${existingPegawai.username}. Centang opsi hapus akun terkait atau hapus akun melalui halaman User Role terlebih dahulu.`,
        409
      )
    }

    if (existingPegawai.user_id) {
      const linkedUserId = Number(existingPegawai.user_id)
      const currentUserId = Number(authorization.user.id)

      if (linkedUserId === currentUserId) {
        return createErrorResponse(
          "Pegawai yang terhubung dengan akun yang sedang digunakan tidak dapat dihapus.",
          409
        )
      }

      if (
        existingPegawai.role_code === "SUPER_ADMIN" &&
        Boolean(existingPegawai.user_is_active)
      ) {
        const otherSuperAdmins = await countOtherActiveSuperAdmins(
          db,
          linkedUserId
        )

        if (otherSuperAdmins === 0) {
          return createErrorResponse(
            "Minimal satu akun Super Admin harus tetap aktif.",
            409
          )
        }
      }
    }

    const transaction = new sql.Transaction(db)
    await transaction.begin()

    try {
      if (existingPegawai.user_id) {
        const linkedUserId = Number(existingPegawai.user_id)

        await new sql.Request(transaction)
          .input("linkedUserId", sql.Int, linkedUserId)
          .query(`
            DELETE FROM dbo.user_sessions
            WHERE user_id = @linkedUserId;

            DELETE FROM dbo.users
            WHERE id = @linkedUserId;
          `)
      }

      await new sql.Request(transaction)
        .input("id", sql.Int, id)
        .query(`DELETE FROM dbo.pegawai WHERE id = @id;`)

      await transaction.commit()
    } catch (error) {
      await transaction.rollback()
      throw error
    }

    if (existingPegawai.foto) {
      try {
        await deleteManagedPegawaiPhoto(existingPegawai.foto)
      } catch (cleanupError) {
        console.warn("Gagal menghapus file foto pegawai:", cleanupError)
      }
    }

    return NextResponse.json({
      success: true,
      message: existingPegawai.user_id
        ? `Data pegawai dan akun @${existingPegawai.username} berhasil dihapus.`
        : "Data pegawai berhasil dihapus.",
    })
  } catch (error) {
    console.error("DELETE master pegawai error:", error)

    if (error instanceof SyntaxError) {
      return createErrorResponse("Format data tidak valid.")
    }

    if (getSqlErrorNumber(error) === 547) {
      return createErrorResponse(
        "Data pegawai atau akun user masih digunakan oleh data lain dan tidak dapat dihapus.",
        409
      )
    }

    return createInternalErrorResponse(error, "Gagal menghapus data pegawai.")
  }
}

