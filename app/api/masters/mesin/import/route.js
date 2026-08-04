import { NextResponse } from "next/server"

import {
  authorizeApiRequest,
  getUserDataScope,
} from "@/lib/access-control"
import { connectDB, sql } from "@/lib/mssql"
import {
  InvalidJsonBodyError,
  readJsonBody,
  RequestBodyTooLargeError,
} from "@/lib/http/json-body"
import { writeAuditLog } from "@/lib/security/audit-log"
import {
  MAX_MACHINE_IMPORT_REQUEST_BYTES,
  MAX_MACHINE_IMPORT_ROWS,
  validateMachineImportRows,
} from "@/modules/master-mesin/import-validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_RETURNED_ERRORS = 150
const KEY_SEPARATOR = "\u001f"

function createErrorResponse(message, status = 400, extra = {}) {
  return NextResponse.json(
    {
      success: false,
      message,
      ...extra,
    },
    { status }
  )
}

function getSqlErrorNumber(error) {
  return (
    error?.number ||
    error?.originalError?.info?.number ||
    error?.precedingErrors?.[0]?.number ||
    null
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
  const isDevelopment = process.env.NODE_ENV !== "production"

  return createErrorResponse(
    isDevelopment
      ? `${fallbackMessage} Detail: ${getServerErrorMessage(error)}`
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

function normalizeUpper(value) {
  return String(value || "").trim().toUpperCase()
}

function createMachineTypeKey(kodeMerk, jenisMesin, namaModel) {
  return [kodeMerk, jenisMesin, namaModel]
    .map((value) => normalizeUpper(value))
    .join(KEY_SEPARATOR)
}

function resolveDataScope(authorization) {
  const scope = getUserDataScope(authorization.user)

  if (!scope.isSuperAdmin && !scope.codeUker) {
    return {
      scope: null,
      response: createErrorResponse(
        "Unit kerja pengguna belum terhubung. Hubungi Super Admin.",
        403
      ),
    }
  }

  return { scope, response: null }
}

function buildValidationResponse(rows, errors) {
  const invalidRows = new Set(
    errors
      .map((error) => Number(error.row))
      .filter((row) => Number.isSafeInteger(row) && row > 0)
  ).size

  return createErrorResponse(
    "File masih memiliki data yang tidak valid. Perbaiki baris yang ditandai lalu upload kembali.",
    422,
    {
      data: {
        total_rows: rows.length,
        valid_rows: Math.max(0, rows.length - invalidRows),
        invalid_rows: invalidRows,
        total_errors: errors.length,
        errors: errors.slice(0, MAX_RETURNED_ERRORS),
      },
    }
  )
}

async function isTidSchemaEnabled(db) {
  const result = await db.request().query(`
    SELECT CASE
      WHEN COL_LENGTH(N'dbo.master_mesin', N'tid') IS NULL THEN CAST(0 AS BIT)
      ELSE CAST(1 AS BIT)
    END AS tid_enabled;
  `)

  return Boolean(result.recordset[0]?.tid_enabled)
}

async function getLocationCategoryConstraintStatus(db, rows) {
  const result = await db
    .request()
    .input("rowsJson", sql.NVarChar(sql.MAX), JSON.stringify(rows))
    .query(`
      DECLARE @definition NVARCHAR(MAX);
      DECLARE @isDisabled BIT = 0;
      DECLARE @isNotTrusted BIT = 0;

      SELECT
        @definition = UPPER(definition),
        @isDisabled = is_disabled,
        @isNotTrusted = is_not_trusted
      FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
        AND name = N'CK_master_mesin_kategori_lokasi';

      SELECT
        CAST(CASE WHEN @definition IS NULL THEN 0 ELSE 1 END AS BIT)
          AS constraint_found,
        @isDisabled AS is_disabled,
        @isNotTrusted AS is_not_trusted,
        CONVERT(NVARCHAR(128), SERVERPROPERTY('ServerName')) AS server_name,
        DB_NAME() AS database_name,
        @definition AS constraint_definition;

      SELECT DISTINCT
        UPPER(LTRIM(RTRIM(source.kategori_lokasi))) AS kategori_lokasi
      FROM OPENJSON(@rowsJson)
      WITH (
        kategori_lokasi NVARCHAR(50) '$.kategori_lokasi'
      ) source
      WHERE @definition IS NOT NULL
        AND CHARINDEX(
          NCHAR(39) + UPPER(LTRIM(RTRIM(source.kategori_lokasi))) + NCHAR(39),
          @definition
        ) = 0;
    `)

  const schema = result.recordsets?.[0]?.[0] || {}
  const unsupportedCategories = (result.recordsets?.[1] || [])
    .map((item) => normalizeUpper(item.kategori_lokasi))
    .filter(Boolean)

  return {
    constraintFound: Boolean(schema.constraint_found),
    isDisabled: Boolean(schema.is_disabled),
    isNotTrusted: Boolean(schema.is_not_trusted),
    serverName: String(schema.server_name || ""),
    databaseName: String(schema.database_name || ""),
    constraintDefinition: String(schema.constraint_definition || ""),
    unsupportedCategories,
  }
}

async function getOperationTimeConstraintStatus(db, rows) {
  const result = await db
    .request()
    .input("rowsJson", sql.NVarChar(sql.MAX), JSON.stringify(rows))
    .query(`
      DECLARE @definition NVARCHAR(MAX);
      DECLARE @isDisabled BIT = 0;
      DECLARE @isNotTrusted BIT = 0;

      SELECT
        @definition = definition,
        @isDisabled = is_disabled,
        @isNotTrusted = is_not_trusted
      FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID(N'dbo.master_mesin')
        AND name = N'CK_master_mesin_waktu_ops';

      SELECT
        CAST(CASE WHEN @definition IS NULL THEN 0 ELSE 1 END AS BIT)
          AS constraint_found,
        @isDisabled AS is_disabled,
        @isNotTrusted AS is_not_trusted,
        CONVERT(NVARCHAR(128), SERVERPROPERTY('ServerName')) AS server_name,
        DB_NAME() AS database_name,
        @definition AS constraint_definition;

      SELECT DISTINCT
        LTRIM(RTRIM(source.waktu_ops)) AS waktu_ops
      FROM OPENJSON(@rowsJson)
      WITH (
        waktu_ops VARCHAR(20) '$.waktu_ops'
      ) source
      WHERE @definition IS NOT NULL
        AND CHARINDEX(
          NCHAR(39) + LTRIM(RTRIM(source.waktu_ops)) + NCHAR(39),
          @definition
        ) = 0;
    `)

  const schema = result.recordsets?.[0]?.[0] || {}
  const unsupportedTimes = (result.recordsets?.[1] || [])
    .map((item) => String(item.waktu_ops || "").trim())
    .filter(Boolean)

  return {
    constraintFound: Boolean(schema.constraint_found),
    isDisabled: Boolean(schema.is_disabled),
    isNotTrusted: Boolean(schema.is_not_trusted),
    serverName: String(schema.server_name || ""),
    databaseName: String(schema.database_name || ""),
    constraintDefinition: String(schema.constraint_definition || ""),
    unsupportedTimes,
  }
}

async function getCabangMap(db, rows) {
  const result = await db
    .request()
    .input("rowsJson", sql.NVarChar(sql.MAX), JSON.stringify(rows))
    .query(`
      SELECT DISTINCT
        c.id,
        UPPER(LTRIM(RTRIM(c.kode_cabang))) AS kode_cabang,
        c.nama_cabang,
        c.is_active,
        k.is_active AS kanwil_is_active
      FROM dbo.master_cabang c
      INNER JOIN dbo.master_kanwil k
        ON k.id = c.kanwil_id
      INNER JOIN OPENJSON(@rowsJson)
      WITH (
        kode_cabang VARCHAR(30) '$.kode_cabang'
      ) source
        ON UPPER(LTRIM(RTRIM(c.kode_cabang))) = source.kode_cabang;
    `)

  return new Map(
    result.recordset.map((item) => [normalizeUpper(item.kode_cabang), item])
  )
}

async function getProjectMap(db, rows, scopeCodeUker) {
  const result = await db
    .request()
    .input("rowsJson", sql.NVarChar(sql.MAX), JSON.stringify(rows))
    .input("scopeCodeUker", sql.NVarChar(20), scopeCodeUker)
    .query(`
      SELECT DISTINCT
        p.id,
        UPPER(LTRIM(RTRIM(p.kode_project))) AS kode_project,
        p.nama_project,
        p.is_active,
        mu.codeuker,
        mu.nama_uker
      FROM dbo.master_project p
      INNER JOIN dbo.master_uker mu
        ON mu.id = p.uker_id
      INNER JOIN OPENJSON(@rowsJson)
      WITH (
        kode_project VARCHAR(30) '$.kode_project'
      ) source
        ON UPPER(LTRIM(RTRIM(p.kode_project))) = source.kode_project
      WHERE @scopeCodeUker IS NULL
         OR UPPER(LTRIM(RTRIM(mu.codeuker))) = UPPER(LTRIM(RTRIM(@scopeCodeUker)));
    `)

  return new Map(
    result.recordset.map((item) => [normalizeUpper(item.kode_project), item])
  )
}

async function getMachineTypeMap(db, rows) {
  const result = await db
    .request()
    .input("rowsJson", sql.NVarChar(sql.MAX), JSON.stringify(rows))
    .query(`
      SELECT DISTINCT
        t.id,
        UPPER(LTRIM(RTRIM(m.kode_merk))) AS kode_merk,
        UPPER(LTRIM(RTRIM(t.jenis_mesin))) AS jenis_mesin,
        LTRIM(RTRIM(t.nama_model)) AS nama_model,
        t.is_active,
        m.is_active AS merk_is_active
      FROM dbo.master_tipe_mesin t
      INNER JOIN dbo.master_merk m
        ON m.id = t.merk_id
      INNER JOIN OPENJSON(@rowsJson)
      WITH (
        kode_merk VARCHAR(30) '$.kode_merk',
        jenis_mesin NVARCHAR(100) '$.jenis_mesin',
        nama_model NVARCHAR(150) '$.nama_model'
      ) source
        ON UPPER(LTRIM(RTRIM(m.kode_merk))) = source.kode_merk
       AND UPPER(LTRIM(RTRIM(t.jenis_mesin))) = source.jenis_mesin
       AND UPPER(LTRIM(RTRIM(t.nama_model))) = UPPER(LTRIM(RTRIM(source.nama_model)));
    `)

  return new Map(
    result.recordset.map((item) => [
      createMachineTypeKey(item.kode_merk, item.jenis_mesin, item.nama_model),
      item,
    ])
  )
}

async function getExistingIdentifiers(db, rows) {
  const result = await db
    .request()
    .input("rowsJson", sql.NVarChar(sql.MAX), JSON.stringify(rows))
    .query(`
      SELECT DISTINCT
        'TID' AS identifier_type,
        UPPER(LTRIM(RTRIM(m.tid))) AS identifier_value
      FROM dbo.master_mesin m
      INNER JOIN OPENJSON(@rowsJson)
      WITH (tid VARCHAR(50) '$.tid') source
        ON UPPER(LTRIM(RTRIM(m.tid))) = source.tid

      UNION ALL

      SELECT DISTINCT
        'SN' AS identifier_type,
        UPPER(LTRIM(RTRIM(m.sn))) AS identifier_value
      FROM dbo.master_mesin m
      INNER JOIN OPENJSON(@rowsJson)
      WITH (sn VARCHAR(100) '$.sn') source
        ON UPPER(LTRIM(RTRIM(m.sn))) = source.sn;
    `)

  const tids = new Set()
  const sns = new Set()

  result.recordset.forEach((item) => {
    if (item.identifier_type === "TID") {
      tids.add(normalizeUpper(item.identifier_value))
    } else if (item.identifier_type === "SN") {
      sns.add(normalizeUpper(item.identifier_value))
    }
  })

  return { tids, sns }
}

export async function POST(request) {
  const authorization = await authorizeApiRequest(request, "/masters", "create")

  if (!authorization.authorized) {
    return authorization.response
  }

  const scopeResult = resolveDataScope(authorization)
  if (scopeResult.response) return scopeResult.response

  let transaction = null

  try {
    let body

    try {
      body = await readJsonBody(request, {
        maxBytes: MAX_MACHINE_IMPORT_REQUEST_BYTES,
      })
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return createErrorResponse(
          "Ukuran data upload terlalu besar. Pecah file menjadi beberapa batch.",
          413
        )
      }

      if (error instanceof InvalidJsonBodyError) {
        return createErrorResponse("Format permintaan upload tidak valid.")
      }

      throw error
    }

    if (!Array.isArray(body?.rows)) {
      return createErrorResponse("Data mesin untuk upload tidak ditemukan.")
    }

    if (body.rows.length > MAX_MACHINE_IMPORT_ROWS) {
      return createErrorResponse(
        `Maksimal ${MAX_MACHINE_IMPORT_ROWS} baris dalam satu kali upload.`
      )
    }

    const validation = validateMachineImportRows(body.rows)
    const normalizedRows = validation.rows
    const errors = [...validation.errors]

    if (normalizedRows.length === 0 || errors.some((error) => error.row === null)) {
      return buildValidationResponse(normalizedRows, errors)
    }

    const db = await connectDB()

    if (!(await isTidSchemaEnabled(db))) {
      return createErrorResponse(
        "Kolom TID belum tersedia. Jalankan migration 011-add-master-mesin-tid.sql terlebih dahulu.",
        409
      )
    }

    const [locationConstraint, operationTimeConstraint] = await Promise.all([
      getLocationCategoryConstraintStatus(db, normalizedRows),
      getOperationTimeConstraintStatus(db, normalizedRows),
    ])

    if (
      !locationConstraint.constraintFound ||
      locationConstraint.isDisabled ||
      locationConstraint.isNotTrusted ||
      locationConstraint.unsupportedCategories.length > 0
    ) {
      const unsupportedText =
        locationConstraint.unsupportedCategories.length > 0
          ? ` Kategori yang belum diizinkan: ${locationConstraint.unsupportedCategories.join(", ")}.`
          : ""

      const databaseIdentity = [
        locationConstraint.serverName,
        locationConstraint.databaseName,
      ].filter(Boolean).join(" / ")

      return createErrorResponse(
        `Constraint database Kategori Lokasi belum sesuai.${unsupportedText} Database aktif: ${databaseIdentity || "tidak terdeteksi"}. Jalankan npm run db:migrate untuk menerapkan migration 020-sync-master-mesin-location-categories.sql pada server dan database yang sama dengan aplikasi.`,
        409,
        {
          data: {
            constraint_found: locationConstraint.constraintFound,
            constraint_disabled: locationConstraint.isDisabled,
            constraint_not_trusted: locationConstraint.isNotTrusted,
            unsupported_categories:
              locationConstraint.unsupportedCategories,
            server_name: locationConstraint.serverName,
            database_name: locationConstraint.databaseName,
            constraint_definition: locationConstraint.constraintDefinition,
          },
        }
      )
    }

    if (
      !operationTimeConstraint.constraintFound ||
      operationTimeConstraint.isDisabled ||
      operationTimeConstraint.isNotTrusted ||
      operationTimeConstraint.unsupportedTimes.length > 0
    ) {
      const unsupportedText =
        operationTimeConstraint.unsupportedTimes.length > 0
          ? ` Waktu yang belum diizinkan: ${operationTimeConstraint.unsupportedTimes.join(", ")}.`
          : ""

      const databaseIdentity = [
        operationTimeConstraint.serverName,
        operationTimeConstraint.databaseName,
      ].filter(Boolean).join(" / ")

      return createErrorResponse(
        `Constraint database Waktu Operasional belum sesuai.${unsupportedText} Database aktif: ${databaseIdentity || "tidak terdeteksi"}. Jalankan npm run db:migrate untuk menerapkan migration 021-sync-master-mesin-operation-times.sql pada server dan database yang sama dengan aplikasi.`,
        409,
        {
          data: {
            constraint_found: operationTimeConstraint.constraintFound,
            constraint_disabled: operationTimeConstraint.isDisabled,
            constraint_not_trusted: operationTimeConstraint.isNotTrusted,
            unsupported_times: operationTimeConstraint.unsupportedTimes,
            server_name: operationTimeConstraint.serverName,
            database_name: operationTimeConstraint.databaseName,
            constraint_definition: operationTimeConstraint.constraintDefinition,
          },
        }
      )
    }

    const scope = scopeResult.scope
    const [cabangMap, projectMap, machineTypeMap, existing] = await Promise.all([
      getCabangMap(db, normalizedRows),
      getProjectMap(db, normalizedRows, scope.codeUker),
      getMachineTypeMap(db, normalizedRows),
      getExistingIdentifiers(db, normalizedRows),
    ])

    normalizedRows.forEach((row) => {
      const cabang = cabangMap.get(row.kode_cabang)
      if (!cabang) {
        errors.push({
          row: row._row_number,
          field: "kode_cabang",
          message: `Kode Cabang ${row.kode_cabang} tidak ditemukan.`,
        })
      } else if (!cabang.is_active || !cabang.kanwil_is_active) {
        errors.push({
          row: row._row_number,
          field: "kode_cabang",
          message: `Cabang ${row.kode_cabang} atau Kanwil induknya sudah nonaktif.`,
        })
      }

      const project = projectMap.get(row.kode_project)
      if (!project) {
        errors.push({
          row: row._row_number,
          field: "kode_project",
          message: scope.codeUker
            ? `Project ${row.kode_project} tidak ditemukan atau bukan milik unit kerja Anda.`
            : `Kode Project ${row.kode_project} tidak ditemukan.`,
        })
      } else if (!project.is_active) {
        errors.push({
          row: row._row_number,
          field: "kode_project",
          message: `Project ${row.kode_project} sudah nonaktif.`,
        })
      }

      const typeKey = createMachineTypeKey(
        row.kode_merk,
        row.jenis_mesin,
        row.nama_model
      )
      const machineType = machineTypeMap.get(typeKey)
      if (!machineType) {
        errors.push({
          row: row._row_number,
          field: "nama_model",
          message: `Kombinasi Merk ${row.kode_merk}, Jenis ${row.jenis_mesin}, dan Model ${row.nama_model} tidak ditemukan pada Master Tipe Mesin.`,
        })
      } else if (!machineType.is_active || !machineType.merk_is_active) {
        errors.push({
          row: row._row_number,
          field: "nama_model",
          message: `Tipe Mesin ${row.nama_model} atau Merk ${row.kode_merk} sudah nonaktif.`,
        })
      }

      if (existing.tids.has(row.tid)) {
        errors.push({
          row: row._row_number,
          field: "tid",
          message: `TID ${row.tid} sudah terdaftar.`,
        })
      }

      if (existing.sns.has(row.sn)) {
        errors.push({
          row: row._row_number,
          field: "sn",
          message: `SN ${row.sn} sudah terdaftar.`,
        })
      }
    })

    if (errors.length > 0) {
      return buildValidationResponse(normalizedRows, errors)
    }

    const insertRows = normalizedRows.map((row) => {
      const cabang = cabangMap.get(row.kode_cabang)
      const project = projectMap.get(row.kode_project)
      const machineType = machineTypeMap.get(
        createMachineTypeKey(row.kode_merk, row.jenis_mesin, row.nama_model)
      )

      return {
        row_number: row._row_number,
        tid: row.tid,
        sn: row.sn,
        db: row.db || null,
        cabang_id: Number(cabang.id),
        project_id: Number(project.id),
        lokasi: row.lokasi,
        site: row.site,
        kategori_mesin: normalizeUpper(machineType.jenis_mesin),
        tipe_mesin_id: Number(machineType.id),
        kategori_lokasi: row.kategori_lokasi,
        garansi: row.garansi,
        hari_ops: row.hari_ops,
        jam_ops: row.jam_ops,
        waktu_ops: row.waktu_ops,
        longitude: row.longitude,
        latitude: row.latitude,
        is_active: row.status === "AKTIF",
      }
    })

    transaction = new sql.Transaction(db)
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)

    const insertResult = await new sql.Request(transaction)
      .input("rowsJson", sql.NVarChar(sql.MAX), JSON.stringify(insertRows))
      .query(`
        DECLARE @source TABLE (
          row_number INT NOT NULL,
          tid VARCHAR(50) NOT NULL,
          sn VARCHAR(100) NOT NULL,
          db_value NVARCHAR(100) NULL,
          cabang_id INT NOT NULL,
          project_id BIGINT NOT NULL,
          lokasi NVARCHAR(500) NOT NULL,
          site VARCHAR(10) NOT NULL,
          kategori_mesin NVARCHAR(100) NOT NULL,
          tipe_mesin_id INT NOT NULL,
          kategori_lokasi NVARCHAR(50) NOT NULL,
          garansi VARCHAR(20) NOT NULL,
          hari_ops VARCHAR(20) NOT NULL,
          jam_ops VARCHAR(20) NOT NULL,
          waktu_ops VARCHAR(20) NOT NULL,
          longitude DECIMAL(9,6) NULL,
          latitude DECIMAL(9,6) NULL,
          is_active BIT NOT NULL
        );

        INSERT INTO @source (
          row_number,
          tid,
          sn,
          db_value,
          cabang_id,
          project_id,
          lokasi,
          site,
          kategori_mesin,
          tipe_mesin_id,
          kategori_lokasi,
          garansi,
          hari_ops,
          jam_ops,
          waktu_ops,
          longitude,
          latitude,
          is_active
        )
        SELECT
          row_number,
          tid,
          sn,
          db_value,
          cabang_id,
          project_id,
          lokasi,
          site,
          kategori_mesin,
          tipe_mesin_id,
          kategori_lokasi,
          garansi,
          hari_ops,
          jam_ops,
          waktu_ops,
          longitude,
          latitude,
          is_active
        FROM OPENJSON(@rowsJson)
        WITH (
          row_number INT '$.row_number',
          tid VARCHAR(50) '$.tid',
          sn VARCHAR(100) '$.sn',
          db_value NVARCHAR(100) '$.db',
          cabang_id INT '$.cabang_id',
          project_id BIGINT '$.project_id',
          lokasi NVARCHAR(500) '$.lokasi',
          site VARCHAR(10) '$.site',
          kategori_mesin NVARCHAR(100) '$.kategori_mesin',
          tipe_mesin_id INT '$.tipe_mesin_id',
          kategori_lokasi NVARCHAR(50) '$.kategori_lokasi',
          garansi VARCHAR(20) '$.garansi',
          hari_ops VARCHAR(20) '$.hari_ops',
          jam_ops VARCHAR(20) '$.jam_ops',
          waktu_ops VARCHAR(20) '$.waktu_ops',
          longitude DECIMAL(9,6) '$.longitude',
          latitude DECIMAL(9,6) '$.latitude',
          is_active BIT '$.is_active'
        );

        IF EXISTS (
          SELECT 1
          FROM @source
          WHERE UPPER(LTRIM(RTRIM(tid))) = UPPER(LTRIM(RTRIM(sn)))
        )
          THROW 51032, 'TID dan SN pada mesin yang sama tidak boleh sama.', 1;

        IF EXISTS (
          SELECT 1
          FROM dbo.master_mesin m WITH (UPDLOCK, HOLDLOCK)
          INNER JOIN @source source
            ON UPPER(LTRIM(RTRIM(m.tid))) = UPPER(LTRIM(RTRIM(source.tid)))
        )
          THROW 51030, 'Terdapat TID yang sudah terdaftar.', 1;

        IF EXISTS (
          SELECT 1
          FROM dbo.master_mesin m WITH (UPDLOCK, HOLDLOCK)
          INNER JOIN @source source
            ON UPPER(LTRIM(RTRIM(m.sn))) = UPPER(LTRIM(RTRIM(source.sn)))
        )
          THROW 51031, 'Terdapat SN yang sudah terdaftar.', 1;

        INSERT INTO dbo.master_mesin (
          tid,
          sn,
          db,
          cabang_id,
          project_id,
          lokasi,
          site,
          kategori_mesin,
          tipe_mesin_id,
          kategori_lokasi,
          garansi,
          hari_ops,
          jam_ops,
          waktu_ops,
          longitude,
          latitude,
          is_active,
          created_at,
          updated_at
        )
        SELECT
          source.tid,
          source.sn,
          source.db_value,
          source.cabang_id,
          source.project_id,
          source.lokasi,
          source.site,
          source.kategori_mesin,
          source.tipe_mesin_id,
          source.kategori_lokasi,
          source.garansi,
          source.hari_ops,
          source.jam_ops,
          source.waktu_ops,
          source.longitude,
          source.latitude,
          source.is_active,
          SYSDATETIME(),
          SYSDATETIME()
        FROM @source source;

        SELECT @@ROWCOUNT AS imported_count;
      `)

    await transaction.commit()
    transaction = null

    const importedCount = Number(
      insertResult.recordset[0]?.imported_count || insertRows.length
    )

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "IMPORT",
      module: "masters.mesin",
      entityType: "master_mesin",
      entityId: null,
      metadata: {
        imported_count: importedCount,
        tids: insertRows.slice(0, 25).map((row) => row.tid),
        sns: insertRows.slice(0, 25).map((row) => row.sn),
        identifiers_truncated: insertRows.length > 25,
      },
    })

    return NextResponse.json(
      {
        success: true,
        message: `${importedCount} data mesin berhasil diupload.`,
        data: {
          imported_count: importedCount,
          total_rows: insertRows.length,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback()
      } catch (rollbackError) {
        console.error("Rollback import mesin gagal:", rollbackError)
      }
    }

    console.error("POST import master mesin error:", error)
    const sqlErrorNumber = getSqlErrorNumber(error)

    if ([2601, 2627, 51030, 51031].includes(sqlErrorNumber)) {
      return createErrorResponse(
        "Upload dibatalkan karena terdapat TID atau SN yang sudah terdaftar. Muat ulang data lalu upload kembali.",
        409
      )
    }

    if (sqlErrorNumber === 51032) {
      return createErrorResponse(
        "Upload dibatalkan karena terdapat TID dan SN dengan nilai yang sama.",
        409
      )
    }

    if (
      sqlErrorNumber === 547 &&
      /CK_master_mesin_kategori_lokasi/i.test(getServerErrorMessage(error))
    ) {
      return createErrorResponse(
        "Upload dibatalkan karena constraint database Kategori Lokasi masih memakai versi lama. Jalankan npm run db:migrate untuk menerapkan migration 020-sync-master-mesin-location-categories.sql pada database yang dipakai aplikasi, lalu upload kembali.",
        409
      )
    }

    if (
      sqlErrorNumber === 547 &&
      /CK_master_mesin_waktu_ops/i.test(getServerErrorMessage(error))
    ) {
      return createErrorResponse(
        "Upload dibatalkan karena constraint database Waktu Operasional masih memakai versi lama. Jalankan npm run db:migrate untuk menerapkan migration 021-sync-master-mesin-operation-times.sql pada database yang dipakai aplikasi, lalu upload kembali.",
        409
      )
    }

    if (sqlErrorNumber === 547) {
      return createErrorResponse(
        "Upload dibatalkan karena terdapat relasi atau nilai master yang tidak sesuai dengan constraint database.",
        409
      )
    }

    return createInternalErrorResponse(error, "Gagal mengupload data mesin.")
  }
}
