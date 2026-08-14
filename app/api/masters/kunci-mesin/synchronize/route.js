import { readJsonBody } from "@/lib/http/json-body"
import { NextResponse } from "next/server"

import {
  authorizeApiRequest,
  getUserDataScope,
} from "@/lib/access-control"
import { getMachineKeyMatrixConfig } from "@/lib/machine-key/matrix-config"
import { connectDB, sql } from "@/lib/mssql"
import { insertAuditLog } from "@/lib/security/audit-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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

function normalizeId(value) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
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

async function ensureMachineKeySchema(executor) {
  const result = await executor.request().query(`
    SELECT CASE
      WHEN OBJECT_ID(N'dbo.machine_key_mappings', N'U') IS NULL THEN CAST(0 AS BIT)
      WHEN NOT EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.machine_key_mappings')
          AND name = N'UX_machine_key_machine'
      ) THEN CAST(0 AS BIT)
      WHEN NOT EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.machine_key_mappings')
          AND name = N'UX_machine_key_matrix_slot'
      ) THEN CAST(0 AS BIT)
      WHEN NOT EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.machine_key_mappings')
          AND name = N'UX_machine_key_barcode'
      ) THEN CAST(0 AS BIT)
      ELSE CAST(1 AS BIT)
    END AS schema_ready;
  `)

  return Boolean(result.recordset[0]?.schema_ready)
}

async function resolveMatrixScope(executor, scope, scopeMachineId) {
  if (scope.codeUker) {
    const result = await executor
      .request()
      .input("scopeCodeUker", sql.NVarChar(20), scope.codeUker)
      .query(`
        SELECT TOP (1)
          mu.id AS uker_id,
          mu.codeuker,
          mu.nama_uker
        FROM dbo.master_uker mu
        WHERE mu.codeuker = @scopeCodeUker;
      `)

    return result.recordset[0] || null
  }

  if (!scope.isSuperAdmin || !scopeMachineId) return null

  const result = await executor
    .request()
    .input("scopeMachineId", sql.BigInt, scopeMachineId)
    .query(`
      SELECT TOP (1)
        mu.id AS uker_id,
        mu.codeuker,
        mu.nama_uker
      FROM dbo.master_mesin ms
      INNER JOIN dbo.master_project p
        ON p.id = ms.project_id
      INNER JOIN dbo.master_uker mu
        ON mu.id = p.uker_id
      WHERE ms.id = @scopeMachineId;
    `)

  return result.recordset[0] || null
}

export async function POST(request) {
  const authorization = await authorizeApiRequest(
    request,
    "/masters",
    "create"
  )

  if (!authorization.authorized) {
    return authorization.response
  }

  let transaction = null

  try {
    let body = {}

    try {
      body = await readJsonBody(request, { maxBytes: 32 * 1024 })
    } catch {
      return createErrorResponse("Format permintaan sinkronisasi tidak valid.")
    }

    const scopeMachineId = normalizeId(body.scope_machine_id)
    const scope = getUserDataScope(authorization.user)

    if (!scope.isSuperAdmin && !scope.codeUker) {
      return createErrorResponse(
        "Unit kerja pengguna belum terhubung. Hubungi Super Admin.",
        403
      )
    }

    if (scope.isSuperAdmin && !scopeMachineId) {
      return createErrorResponse(
        "Super Admin wajib memilih satu mesin untuk menentukan unit kerja yang akan disinkronkan."
      )
    }

    const db = await connectDB()

    if (!(await ensureMachineKeySchema(db))) {
      return createErrorResponse(
        "Skema mapping kunci belum lengkap. Jalankan migration 036 dan 037.",
        409,
        { code: "MACHINE_KEY_SCHEMA_REQUIRED" }
      )
    }

    const matrixScope = await resolveMatrixScope(db, scope, scopeMachineId)

    if (!matrixScope) {
      return createErrorResponse(
        scope.isSuperAdmin
          ? "Unit kerja dari mesin yang dipilih tidak ditemukan."
          : "Unit kerja pengguna tidak ditemukan.",
        404
      )
    }

    const matrixConfig = getMachineKeyMatrixConfig()
    transaction = db.transaction()
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)

    const syncResult = await transaction
      .request()
      .input("ukerId", sql.BigInt, matrixScope.uker_id)
      .input("wallsJson", sql.NVarChar(sql.MAX), JSON.stringify(matrixConfig.walls))
      .input(
        "columnsJson",
        sql.NVarChar(sql.MAX),
        JSON.stringify(matrixConfig.columns)
      )
      .input("rowsJson", sql.NVarChar(sql.MAX), JSON.stringify(matrixConfig.rows))
      .input("userId", sql.Int, authorization.user.id)
      .query(`
        SET NOCOUNT ON;
        SET XACT_ABORT ON;

        DECLARE @lockResult INT;
        DECLARE @lockResource NVARCHAR(255) =
          CONCAT(N'machine-key-sync:', @ukerId);
        DECLARE @alphabet VARCHAR(36) = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

        EXEC @lockResult = sys.sp_getapplock
          @Resource = @lockResource,
          @LockMode = 'Exclusive',
          @LockOwner = 'Transaction',
          @LockTimeout = 15000;

        IF @lockResult < 0
          THROW 53801, 'MACHINE_KEY_SYNC_LOCK_TIMEOUT', 1;

        DECLARE @Slots TABLE (
          slot_order INT NOT NULL PRIMARY KEY,
          matrix_wall VARCHAR(2) NOT NULL,
          matrix_column CHAR(1) NOT NULL,
          matrix_row CHAR(2) NOT NULL,
          UNIQUE (matrix_wall, matrix_column, matrix_row)
        );

        ;WITH MatrixWalls AS (
          SELECT
            CONVERT(INT, [key]) + 1 AS wall_order,
            CONVERT(VARCHAR(2), [value]) AS matrix_wall
          FROM OPENJSON(@wallsJson)
        ),
        MatrixColumns AS (
          SELECT
            CONVERT(INT, [key]) + 1 AS column_order,
            CONVERT(CHAR(1), [value]) AS matrix_column
          FROM OPENJSON(@columnsJson)
        ),
        MatrixRows AS (
          SELECT
            CONVERT(INT, [key]) + 1 AS row_order,
            CONVERT(CHAR(2), [value]) AS matrix_row
          FROM OPENJSON(@rowsJson)
        )
        INSERT INTO @Slots (
          slot_order,
          matrix_wall,
          matrix_column,
          matrix_row
        )
        SELECT
          ROW_NUMBER() OVER (
            ORDER BY
              wall.wall_order,
              matrix_row.row_order,
              matrix_column.column_order
          ),
          wall.matrix_wall,
          matrix_column.matrix_column,
          matrix_row.matrix_row
        FROM MatrixWalls wall
        CROSS JOIN MatrixRows matrix_row
        CROSS JOIN MatrixColumns matrix_column;

        DECLARE @FreeSlots TABLE (
          assignment_order INT NOT NULL PRIMARY KEY,
          slot_order INT NOT NULL UNIQUE,
          matrix_wall VARCHAR(2) NOT NULL,
          matrix_column CHAR(1) NOT NULL,
          matrix_row CHAR(2) NOT NULL
        );

        INSERT INTO @FreeSlots (
          assignment_order,
          slot_order,
          matrix_wall,
          matrix_column,
          matrix_row
        )
        SELECT
          ROW_NUMBER() OVER (ORDER BY slot.slot_order),
          slot.slot_order,
          slot.matrix_wall,
          slot.matrix_column,
          slot.matrix_row
        FROM @Slots slot
        WHERE NOT EXISTS (
          SELECT 1
          FROM dbo.machine_key_mappings existing_slot WITH (
            UPDLOCK,
            HOLDLOCK,
            INDEX(UX_machine_key_matrix_slot)
          )
          WHERE existing_slot.uker_id = @ukerId
            AND existing_slot.matrix_wall = slot.matrix_wall
            AND existing_slot.matrix_column = slot.matrix_column
            AND existing_slot.matrix_row = slot.matrix_row
        );

        DECLARE @Machines TABLE (
          assignment_order INT NOT NULL PRIMARY KEY,
          machine_id BIGINT NOT NULL UNIQUE,
          tid VARCHAR(100) NULL
        );

        INSERT INTO @Machines (assignment_order, machine_id, tid)
        SELECT
          ROW_NUMBER() OVER (
            ORDER BY
              CASE
                WHEN TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(ms.tid)), '')) IS NULL
                  THEN 1
                ELSE 0
              END,
              TRY_CONVERT(BIGINT, NULLIF(LTRIM(RTRIM(ms.tid)), '')),
              ms.tid,
              ms.id
          ),
          ms.id,
          ms.tid
        FROM dbo.master_mesin ms
        INNER JOIN dbo.master_project p
          ON p.id = ms.project_id
        WHERE p.uker_id = @ukerId
          AND ms.is_active = 1
          AND NOT EXISTS (
            SELECT 1
            FROM dbo.machine_key_mappings existing_machine WITH (
              UPDLOCK,
              HOLDLOCK,
              INDEX(UX_machine_key_machine)
            )
            WHERE existing_machine.machine_id = ms.id
          );

        DECLARE @Assignments TABLE (
          assignment_order INT NOT NULL PRIMARY KEY,
          slot_order INT NOT NULL UNIQUE,
          machine_id BIGINT NOT NULL UNIQUE,
          tid VARCHAR(100) NULL,
          matrix_wall VARCHAR(2) NOT NULL,
          matrix_column CHAR(1) NOT NULL,
          matrix_row CHAR(2) NOT NULL
        );

        INSERT INTO @Assignments (
          assignment_order,
          slot_order,
          machine_id,
          tid,
          matrix_wall,
          matrix_column,
          matrix_row
        )
        SELECT
          machine.assignment_order,
          slot.slot_order,
          machine.machine_id,
          machine.tid,
          slot.matrix_wall,
          slot.matrix_column,
          slot.matrix_row
        FROM @Machines machine
        INNER JOIN @FreeSlots slot
          ON slot.assignment_order = machine.assignment_order;

        DECLARE @Prepared TABLE (
          assignment_order INT NOT NULL PRIMARY KEY,
          slot_order INT NOT NULL UNIQUE,
          machine_id BIGINT NOT NULL UNIQUE,
          tid VARCHAR(100) NULL,
          matrix_wall VARCHAR(2) NOT NULL,
          matrix_column CHAR(1) NOT NULL,
          matrix_row CHAR(2) NOT NULL,
          random_segment VARCHAR(4) NOT NULL,
          barcode VARCHAR(20) NOT NULL UNIQUE
        );

        ;WITH CandidateAttempts AS (
          SELECT attempt_no
          FROM (VALUES
            (0), (1), (2), (3), (4), (5), (6), (7),
            (8), (9), (10), (11), (12), (13), (14), (15),
            (16), (17), (18), (19), (20), (21), (22), (23),
            (24), (25), (26), (27), (28), (29), (30), (31)
          ) attempts(attempt_no)
        ),
        CandidateHashes AS (
          SELECT
            assignment.*,
            attempt.attempt_no,
            HASHBYTES(
              'SHA2_256',
              CONCAT(
                assignment.machine_id,
                ':',
                @ukerId,
                ':',
                assignment.matrix_wall,
                ':',
                assignment.matrix_column,
                ':',
                assignment.matrix_row,
                ':',
                attempt.attempt_no
              )
            ) AS hash_value
          FROM @Assignments assignment
          CROSS JOIN CandidateAttempts attempt
        ),
        CandidateSegments AS (
          SELECT
            candidate.*,
            CONCAT(
              SUBSTRING(@alphabet, CONVERT(INT, SUBSTRING(candidate.hash_value, 1, 1)) % 36 + 1, 1),
              SUBSTRING(@alphabet, CONVERT(INT, SUBSTRING(candidate.hash_value, 2, 1)) % 36 + 1, 1),
              SUBSTRING(@alphabet, CONVERT(INT, SUBSTRING(candidate.hash_value, 3, 1)) % 36 + 1, 1),
              SUBSTRING(@alphabet, CONVERT(INT, SUBSTRING(candidate.hash_value, 4, 1)) % 36 + 1, 1)
            ) AS random_segment
          FROM CandidateHashes candidate
        ),
        AvailableCandidates AS (
          SELECT
            candidate.*,
            CONCAT(
              candidate.matrix_wall,
              candidate.matrix_column,
              candidate.random_segment,
              'R',
              candidate.matrix_row
            ) AS candidate_barcode
          FROM CandidateSegments candidate
          WHERE NOT EXISTS (
            SELECT 1
            FROM dbo.machine_key_mappings existing_barcode WITH (
              UPDLOCK,
              HOLDLOCK,
              INDEX(UX_machine_key_barcode)
            )
            WHERE existing_barcode.barcode = CONCAT(
              candidate.matrix_wall,
              candidate.matrix_column,
              candidate.random_segment,
              'R',
              candidate.matrix_row
            )
          )
        ),
        RankedCandidates AS (
          SELECT
            candidate.*,
            ROW_NUMBER() OVER (
              PARTITION BY candidate.machine_id
              ORDER BY candidate.attempt_no
            ) AS candidate_rank
          FROM AvailableCandidates candidate
        )
        INSERT INTO @Prepared (
          assignment_order,
          slot_order,
          machine_id,
          tid,
          matrix_wall,
          matrix_column,
          matrix_row,
          random_segment,
          barcode
        )
        SELECT
          candidate.assignment_order,
          candidate.slot_order,
          candidate.machine_id,
          candidate.tid,
          candidate.matrix_wall,
          candidate.matrix_column,
          candidate.matrix_row,
          candidate.random_segment,
          candidate.candidate_barcode
        FROM RankedCandidates candidate
        WHERE candidate.candidate_rank = 1;

        IF (SELECT COUNT_BIG(1) FROM @Prepared) <
           (SELECT COUNT_BIG(1) FROM @Assignments)
          THROW 53802, 'MACHINE_KEY_SYNC_BARCODE_EXHAUSTED', 1;

        DECLARE @Created TABLE (
          id BIGINT NOT NULL,
          machine_id BIGINT NOT NULL,
          matrix_wall VARCHAR(2) NOT NULL,
          matrix_column CHAR(1) NOT NULL,
          matrix_row CHAR(2) NOT NULL,
          barcode VARCHAR(20) NOT NULL
        );

        INSERT INTO dbo.machine_key_mappings (
          machine_id,
          uker_id,
          key_type,
          function_code,
          matrix_wall,
          matrix_column,
          matrix_row,
          random_segment,
          has_tombak,
          has_fascia,
          status,
          notes,
          created_by,
          updated_by,
          created_at,
          updated_at
        )
        OUTPUT
          INSERTED.id,
          INSERTED.machine_id,
          INSERTED.matrix_wall,
          INSERTED.matrix_column,
          INSERTED.matrix_row,
          INSERTED.barcode
        INTO @Created (
          id,
          machine_id,
          matrix_wall,
          matrix_column,
          matrix_row,
          barcode
        )
        SELECT
          prepared.machine_id,
          @ukerId,
          'REPLENISH',
          'R',
          prepared.matrix_wall,
          prepared.matrix_column,
          prepared.matrix_row,
          prepared.random_segment,
          1,
          1,
          'IN',
          N'Mapping otomatis melalui sinkronisasi matrix.',
          @userId,
          @userId,
          SYSDATETIME(),
          SYSDATETIME()
        FROM @Prepared prepared;

        DECLARE @createdCount BIGINT = (SELECT COUNT_BIG(1) FROM @Created);
        DECLARE @unmappedBefore BIGINT = (SELECT COUNT_BIG(1) FROM @Machines);
        DECLARE @freeSlotsBefore BIGINT = (SELECT COUNT_BIG(1) FROM @FreeSlots);

        SELECT
          @createdCount AS created_count,
          @unmappedBefore AS unmapped_before,
          @freeSlotsBefore AS free_slots_before,
          @unmappedBefore - @createdCount AS remaining_unmapped,
          @freeSlotsBefore - @createdCount AS remaining_free_slots,
          first_slot.matrix_wall AS first_wall,
          first_slot.matrix_column AS first_column,
          first_slot.matrix_row AS first_row,
          last_slot.matrix_wall AS last_wall,
          last_slot.matrix_column AS last_column,
          last_slot.matrix_row AS last_row
        FROM (SELECT 1 AS join_key) seed
        OUTER APPLY (
          SELECT TOP (1)
            prepared.matrix_wall,
            prepared.matrix_column,
            prepared.matrix_row
          FROM @Prepared prepared
          ORDER BY prepared.slot_order
        ) first_slot
        OUTER APPLY (
          SELECT TOP (1)
            prepared.matrix_wall,
            prepared.matrix_column,
            prepared.matrix_row
          FROM @Prepared prepared
          ORDER BY prepared.slot_order DESC
        ) last_slot;
      `)

    const result = syncResult.recordset[0] || {}
    const createdCount = Number(result.created_count || 0)
    const unmappedBefore = Number(result.unmapped_before || 0)
    const freeSlotsBefore = Number(result.free_slots_before || 0)
    const remainingUnmapped = Number(result.remaining_unmapped || 0)
    const remainingFreeSlots = Number(result.remaining_free_slots || 0)
    const firstSlot = result.first_wall
      ? `${result.first_wall}/${result.first_column}${result.first_row}`
      : null
    const lastSlot = result.last_wall
      ? `${result.last_wall}/${result.last_column}${result.last_row}`
      : null

    await insertAuditLog(transaction, {
      request,
      userId: authorization.user.id,
      action: "SYNCHRONIZE",
      module: "masters.kunci-mesin",
      entityType: "machine_key_mapping_batch",
      entityId: matrixScope.uker_id,
      metadata: {
        uker_id: Number(matrixScope.uker_id),
        codeuker: matrixScope.codeuker,
        created_count: createdCount,
        unmapped_before: unmappedBefore,
        free_slots_before: freeSlotsBefore,
        remaining_unmapped: remainingUnmapped,
        remaining_free_slots: remainingFreeSlots,
        first_slot: firstSlot,
        last_slot: lastSlot,
        key_type: "REPLENISH",
        function_code: "R",
        slot_order: "wall-row-column",
      },
    })

    await transaction.commit()
    transaction = null

    let message
    if (createdCount === 0 && unmappedBefore === 0) {
      message = "Seluruh mesin aktif pada unit kerja ini sudah memiliki mapping."
    } else if (createdCount === 0 && freeSlotsBefore === 0) {
      message = "Sinkronisasi tidak menghasilkan mapping karena seluruh slot matrix sudah penuh."
    } else if (remainingUnmapped > 0) {
      message = `${createdCount} mesin berhasil dimapping otomatis. ${remainingUnmapped} mesin belum termapping karena kapasitas matrix tidak mencukupi.`
    } else {
      message = `${createdCount} mesin berhasil dimapping otomatis ke matrix kunci.`
    }

    return NextResponse.json({
      success: true,
      message,
      data: {
        created_count: createdCount,
        unmapped_before: unmappedBefore,
        free_slots_before: freeSlotsBefore,
        remaining_unmapped: remainingUnmapped,
        remaining_free_slots: remainingFreeSlots,
        first_slot: firstSlot,
        last_slot: lastSlot,
        scope: {
          uker_id: Number(matrixScope.uker_id),
          codeuker: matrixScope.codeuker,
          nama_uker: matrixScope.nama_uker,
        },
      },
    })
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback()
      } catch (rollbackError) {
        console.error("Rollback machine-key synchronization failed:", rollbackError)
      }
    }

    console.error("POST machine-key synchronization error:", error)

    const errorNumber = getSqlErrorNumber(error)

    if (errorNumber === 53801) {
      return createErrorResponse(
        "Sinkronisasi sedang dijalankan oleh pengguna lain. Coba kembali beberapa saat lagi.",
        409
      )
    }

    if (errorNumber === 53802) {
      return createErrorResponse(
        "Sistem tidak dapat menghasilkan barcode unik untuk seluruh mapping. Jalankan ulang sinkronisasi.",
        409
      )
    }

    if ([2601, 2627].includes(errorNumber)) {
      return createErrorResponse(
        "Data berubah saat sinkronisasi berlangsung. Muat ulang matrix, kemudian jalankan sinkronisasi kembali.",
        409
      )
    }

    if (errorNumber === 547) {
      return createErrorResponse(
        "Terdapat mesin atau unit kerja yang tidak lagi valid saat sinkronisasi.",
        409
      )
    }

    return createInternalErrorResponse(
      error,
      "Gagal menyinkronkan mapping kunci mesin."
    )
  }
}
