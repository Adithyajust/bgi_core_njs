import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { connectDB, sql } from "@/lib/mssql"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function createErrorResponse(message, status = 400) {
  return NextResponse.json(
    {
      success: false,
      message,
    },
    {
      status,
    }
  )
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeNullableText(value) {
  const normalizedValue = normalizeText(value)

  return normalizedValue || null
}

function normalizeEmail(value) {
  const normalizedValue = normalizeText(value).toLowerCase()

  return normalizedValue || null
}

function normalizeCodeUker(value) {
  return normalizeText(value).toUpperCase()
}

function validateMaximumLength(label, value, maximumLength) {
  if (value && value.length > maximumLength) {
    return `${label} maksimal ${maximumLength} karakter.`
  }

  return null
}

function validateEmail(email) {
  if (!email) {
    return null
  }

  if (email.length > 255) {
    return "Email maksimal 255 karakter."
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Format email tidak valid."
  }

  return null
}

function parseOptionalDate(value) {
  const normalizedValue = normalizeText(value)

  if (!normalizedValue) {
    return {
      value: null,
      error: null,
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return {
      value: null,
      error: "Tanggal operasional harus menggunakan format YYYY-MM-DD.",
    }
  }

  const [year, month, day] = normalizedValue.split("-").map(Number)

  const date = new Date(Date.UTC(year, month - 1, day))

  const isValidDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day

  if (!isValidDate) {
    return {
      value: null,
      error: "Tanggal operasional tidak valid.",
    }
  }

  return {
    value: date,
    error: null,
  }
}

function normalizeId(value) {
  const id = Number(value)

  if (!Number.isSafeInteger(id) || id <= 0) {
    return null
  }

  return id
}

function validateUkerPayload(body) {
  const namaUker = normalizeText(body.nama_uker)
  const alamatUker = normalizeNullableText(body.alamat_uker)
  const kota = normalizeNullableText(body.kota)
  const kodePos = normalizeNullableText(body.kode_pos)
  const telpBranch = normalizeNullableText(body.telp_branch)
  const gedungBranch = normalizeNullableText(body.gedung_branch)
  const email = normalizeEmail(body.email)
  const codeUker = normalizeCodeUker(body.codeuker)

  const parsedTanggalOps = parseOptionalDate(body.tanggal_ops)

  if (!namaUker) {
    return {
      error: "Nama unit kerja wajib diisi.",
      data: null,
    }
  }

  if (!codeUker) {
    return {
      error: "Kode unit kerja wajib diisi.",
      data: null,
    }
  }

  const validationErrors = [
    validateMaximumLength("Nama unit kerja", namaUker, 100),
    validateMaximumLength("Alamat unit kerja", alamatUker, 255),
    validateMaximumLength("Kota", kota, 200),
    validateMaximumLength("Kode pos", kodePos, 50),
    validateMaximumLength("Nomor telepon", telpBranch, 255),
    validateMaximumLength("Gedung", gedungBranch, 255),
    validateMaximumLength("Kode unit kerja", codeUker, 4),
    validateEmail(email),
    parsedTanggalOps.error,
  ].filter(Boolean)

  if (validationErrors.length > 0) {
    return {
      error: validationErrors[0],
      data: null,
    }
  }

  return {
    error: null,
    data: {
      namaUker,
      alamatUker,
      kota,
      kodePos,
      telpBranch,
      gedungBranch,
      email,
      tanggalOps: parsedTanggalOps.value,
      codeUker,
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

async function getUkerById(db, id, codeUker = null) {
  const result = await db
    .request()
    .input("id", sql.BigInt, id)
    .input("codeUker", sql.NVarChar(4), codeUker)
    .query(`
      SELECT
        id,
        nama_uker,
        alamat_uker,
        kota,
        kode_pos,
        telp_branch,
        gedung_branch,
        email,
        CONVERT(CHAR(10), tanggal_ops, 23) AS tanggal_ops,
        codeuker,
        created_at,
        updated_at
      FROM dbo.master_uker
      WHERE id = @id
        AND (@codeUker IS NULL OR codeuker = @codeUker);
    `)

  return result.recordset[0] || null
}

async function isCodeUkerAvailable(db, codeUker, ignoredId = null) {
  const dbRequest = db
    .request()
    .input("codeUker", sql.NVarChar(4), codeUker)

  let query = `
    SELECT TOP 1
      id
    FROM dbo.master_uker
    WHERE UPPER(codeuker) = @codeUker
  `

  if (ignoredId !== null) {
    dbRequest.input("ignoredId", sql.BigInt, ignoredId)
    query += " AND id <> @ignoredId"
  }

  query += ";"

  const result = await dbRequest.query(query)

  return result.recordset.length === 0
}

/*
|--------------------------------------------------------------------------
| GET: mengambil semua data unit kerja
|--------------------------------------------------------------------------
*/

export async function GET(request) {
  const authorization = await authorizeMaster(request)

  if (!authorization.authorized) {
    return authorization.response
  }

  try {
    const scope = getUserDataScope(authorization.user)

    if (!scope.isSuperAdmin && !scope.codeUker) {
      return createErrorResponse(
        "Akun Anda belum terhubung dengan unit kerja.",
        403
      )
    }

    const db = await connectDB()
    const dbRequest = db.request()

    let whereClause = ""

    if (!scope.isSuperAdmin) {
      dbRequest.input("codeUker", sql.NVarChar(4), scope.codeUker)
      whereClause = "WHERE codeuker = @codeUker"
    }

    const result = await dbRequest.query(`
      SELECT
        id,
        nama_uker,
        alamat_uker,
        kota,
        kode_pos,
        telp_branch,
        gedung_branch,
        email,
        CONVERT(CHAR(10), tanggal_ops, 23) AS tanggal_ops,
        codeuker,
        created_at,
        updated_at
      FROM dbo.master_uker
      ${whereClause}
      ORDER BY
        codeuker ASC,
        nama_uker ASC,
        id ASC;
    `)

    return NextResponse.json({
      success: true,
      data: {
        ukers: result.recordset,
        scope: {
          isSuperAdmin: scope.isSuperAdmin,
          codeUker: scope.codeUker,
        },
      },
    })
  } catch (error) {
    console.error("GET master uker error:", error)

    return createErrorResponse(
      "Gagal mengambil data unit kerja.",
      500
    )
  }
}

/*
|--------------------------------------------------------------------------
| POST: menambahkan unit kerja
|--------------------------------------------------------------------------
*/

export async function POST(request) {
  const authorization = await authorizeMaster(request)

  if (!authorization.authorized) {
    return authorization.response
  }

  const scope = getUserDataScope(authorization.user)

  if (!scope.isSuperAdmin) {
    return createErrorResponse(
      "Hanya Super Admin yang dapat menambahkan unit kerja.",
      403
    )
  }

  try {
    const body = await request.json()
    const validation = validateUkerPayload(body)

    if (validation.error) {
      return createErrorResponse(validation.error)
    }

    const {
      namaUker,
      alamatUker,
      kota,
      kodePos,
      telpBranch,
      gedungBranch,
      email,
      tanggalOps,
      codeUker,
    } = validation.data

    const db = await connectDB()

    const codeIsAvailable = await isCodeUkerAvailable(db, codeUker)

    if (!codeIsAvailable) {
      return createErrorResponse(
        `Kode unit kerja ${codeUker} sudah digunakan.`,
        409
      )
    }

    const result = await db
      .request()
      .input("namaUker", sql.NVarChar(100), namaUker)
      .input("alamatUker", sql.NVarChar(255), alamatUker)
      .input("kota", sql.NVarChar(200), kota)
      .input("kodePos", sql.NVarChar(50), kodePos)
      .input("telpBranch", sql.NVarChar(255), telpBranch)
      .input("gedungBranch", sql.NVarChar(255), gedungBranch)
      .input("email", sql.NVarChar(255), email)
      .input("tanggalOps", sql.Date, tanggalOps)
      .input("codeUker", sql.NVarChar(4), codeUker)
      .query(`
        INSERT INTO dbo.master_uker
        (
          nama_uker,
          alamat_uker,
          kota,
          kode_pos,
          telp_branch,
          gedung_branch,
          email,
          tanggal_ops,
          codeuker,
          created_at,
          updated_at
        )
        OUTPUT inserted.id
        VALUES
        (
          @namaUker,
          @alamatUker,
          @kota,
          @kodePos,
          @telpBranch,
          @gedungBranch,
          @email,
          @tanggalOps,
          @codeUker,
          SYSDATETIME(),
          NULL
        );
      `)

    const createdId = result.recordset[0]?.id
    const createdUker = await getUkerById(db, createdId)

    return NextResponse.json(
      {
        success: true,
        message: "Data unit kerja berhasil ditambahkan.",
        data: createdUker,
      },
      {
        status: 201,
      }
    )
  } catch (error) {
    console.error("POST master uker error:", error)

    if (error instanceof SyntaxError) {
      return createErrorResponse("Format data tidak valid.")
    }

    const errorNumber = getSqlErrorNumber(error)

    if (errorNumber === 2601 || errorNumber === 2627) {
      return createErrorResponse(
        "Kode unit kerja sudah digunakan.",
        409
      )
    }

    return createErrorResponse(
      "Gagal menambahkan data unit kerja.",
      500
    )
  }
}

/*
|--------------------------------------------------------------------------
| PUT: memperbarui unit kerja
|--------------------------------------------------------------------------
*/

export async function PUT(request) {
  const authorization = await authorizeMaster(request)

  if (!authorization.authorized) {
    return authorization.response
  }

  const scope = getUserDataScope(authorization.user)

  if (!scope.isSuperAdmin && !scope.codeUker) {
    return createErrorResponse(
      "Akun Anda belum terhubung dengan unit kerja.",
      403
    )
  }

  try {
    const body = await request.json()
    const id = normalizeId(body.id)

    if (!id) {
      return createErrorResponse("ID unit kerja tidak valid.")
    }

    const validation = validateUkerPayload(body)

    if (validation.error) {
      return createErrorResponse(validation.error)
    }

    const {
      namaUker,
      alamatUker,
      kota,
      kodePos,
      telpBranch,
      gedungBranch,
      email,
      tanggalOps,
      codeUker,
    } = validation.data

    const db = await connectDB()
    const existingUker = await getUkerById(db, id, scope.codeUker)

    if (!existingUker) {
      return createErrorResponse(
        "Data unit kerja tidak ditemukan.",
        404
      )
    }

    if (!scope.isSuperAdmin && codeUker !== scope.codeUker) {
      return createErrorResponse(
        "Kode unit kerja tidak dapat diubah oleh user unit kerja.",
        403
      )
    }

    const codeIsAvailable = await isCodeUkerAvailable(
      db,
      codeUker,
      id
    )

    if (!codeIsAvailable) {
      return createErrorResponse(
        `Kode unit kerja ${codeUker} sudah digunakan.`,
        409
      )
    }

    await db
      .request()
      .input("id", sql.BigInt, id)
      .input("namaUker", sql.NVarChar(100), namaUker)
      .input("alamatUker", sql.NVarChar(255), alamatUker)
      .input("kota", sql.NVarChar(200), kota)
      .input("kodePos", sql.NVarChar(50), kodePos)
      .input("telpBranch", sql.NVarChar(255), telpBranch)
      .input("gedungBranch", sql.NVarChar(255), gedungBranch)
      .input("email", sql.NVarChar(255), email)
      .input("tanggalOps", sql.Date, tanggalOps)
      .input("codeUker", sql.NVarChar(4), codeUker)
      .input("scopeCodeUker", sql.NVarChar(4), scope.codeUker)
      .query(`
        UPDATE dbo.master_uker
        SET
          nama_uker = @namaUker,
          alamat_uker = @alamatUker,
          kota = @kota,
          kode_pos = @kodePos,
          telp_branch = @telpBranch,
          gedung_branch = @gedungBranch,
          email = @email,
          tanggal_ops = @tanggalOps,
          codeuker = @codeUker,
          updated_at = SYSDATETIME()
        WHERE id = @id
          AND (@scopeCodeUker IS NULL OR codeuker = @scopeCodeUker);
      `)

    const updatedUker = await getUkerById(db, id, scope.codeUker)

    return NextResponse.json({
      success: true,
      message: "Data unit kerja berhasil diperbarui.",
      data: updatedUker,
    })
  } catch (error) {
    console.error("PUT master uker error:", error)

    if (error instanceof SyntaxError) {
      return createErrorResponse("Format data tidak valid.")
    }

    const errorNumber = getSqlErrorNumber(error)

    if (errorNumber === 2601 || errorNumber === 2627) {
      return createErrorResponse(
        "Kode unit kerja sudah digunakan.",
        409
      )
    }

    return createErrorResponse(
      "Gagal memperbarui data unit kerja.",
      500
    )
  }
}

/*
|--------------------------------------------------------------------------
| DELETE: menghapus unit kerja
|--------------------------------------------------------------------------
*/

export async function DELETE(request) {
  const authorization = await authorizeMaster(request)

  if (!authorization.authorized) {
    return authorization.response
  }

  const scope = getUserDataScope(authorization.user)

  if (!scope.isSuperAdmin) {
    return createErrorResponse(
      "Hanya Super Admin yang dapat menghapus unit kerja.",
      403
    )
  }

  try {
    const body = await request.json()
    const id = normalizeId(body.id)

    if (!id) {
      return createErrorResponse("ID unit kerja tidak valid.")
    }

    const db = await connectDB()
    const existingUker = await getUkerById(db, id)

    if (!existingUker) {
      return createErrorResponse(
        "Data unit kerja tidak ditemukan.",
        404
      )
    }

    await db
      .request()
      .input("id", sql.BigInt, id)
      .query(`
        DELETE FROM dbo.master_uker
        WHERE id = @id;
      `)

    return NextResponse.json({
      success: true,
      message: "Data unit kerja berhasil dihapus.",
    })
  } catch (error) {
    console.error("DELETE master uker error:", error)

    if (error instanceof SyntaxError) {
      return createErrorResponse("Format data tidak valid.")
    }

    const errorNumber = getSqlErrorNumber(error)

    if (errorNumber === 547) {
      return createErrorResponse(
        "Data unit kerja masih digunakan oleh data lain sehingga tidak dapat dihapus.",
        409
      )
    }

    return createErrorResponse(
      "Gagal menghapus data unit kerja.",
      500
    )
  }
}