import { readJsonBody } from "@/lib/http/json-body"
import { NextResponse } from "next/server"

import {
  authorizeApiRequest,
  getUserDataScope,
  hasMenuAccess,
} from "@/lib/access-control"
import { getMachineKeyMatrixConfig } from "@/lib/machine-key/matrix-config"
import { connectDB, sql } from "@/lib/mssql"
import { insertAuditLog } from "@/lib/security/audit-log"
import { normalizeRowVersionToken } from "@/modules/master-mesin/row-version"
import { serializeMachineKeyMatrixConfig } from "@/modules/machine-key/matrix-config"
import { validateMachineKeyPayload } from "@/modules/machine-key/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MACHINE_KEY_STATUSES = new Set(["IN", "OUT"])

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

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeUpperText(value) {
  return normalizeText(value).toUpperCase()
}

function normalizeId(value) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function normalizeLimit(value, fallback = 8, maximum = 20) {
  const limit = Number(value)
  return Number.isSafeInteger(limit) && limit > 0
    ? Math.min(limit, maximum)
    : fallback
}

function escapeLikePattern(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/\[/g, "\\[")
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

function resolveUniqueConflict(error) {
  const message = getServerErrorMessage(error)

  if (/UX_machine_key_machine(?:_type)?/i.test(message)) {
    return "Mesin tersebut sudah memiliki mapping kunci dan tidak dapat dipilih kembali."
  }

  if (/UX_machine_key_matrix_slot/i.test(message)) {
    return "Slot matrix sudah digunakan oleh set kunci lain pada unit kerja yang sama."
  }

  if (/UX_machine_key_barcode/i.test(message)) {
    return "Barcode sudah digunakan. Acak ulang segmen random lalu simpan kembali."
  }

  return "Mapping kunci bertabrakan dengan data yang sudah tersimpan."
}

async function authorizeMaster(request, action = "view") {
  return authorizeApiRequest(request, "/masters", action)
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
      ELSE CAST(1 AS BIT)
    END AS schema_ready;
  `)

  return Boolean(result.recordset[0]?.schema_ready)
}

function normalizeMapping(row) {
  if (!row) return null

  return {
    ...row,
    id: Number(row.id),
    machine_id: Number(row.machine_id),
    uker_id: Number(row.uker_id),
    current_work_order_id: row.current_work_order_id
      ? Number(row.current_work_order_id)
      : null,
    row_version: normalizeRowVersionToken(row.row_version),
  }
}

async function getMachineById(executor, machineId, scopeCodeUker = null) {
  const result = await executor
    .request()
    .input("machineId", sql.BigInt, machineId)
    .input("scopeCodeUker", sql.NVarChar(20), scopeCodeUker)
    .query(`
      SELECT TOP 1
        ms.id,
        ms.tid,
        ms.sn,
        ms.lokasi,
        ms.is_active,
        p.nama_project,
        p.uker_id,
        mu.codeuker,
        mu.nama_uker,
        c.nama_cabang
      FROM dbo.master_mesin ms
      INNER JOIN dbo.master_project p
        ON p.id = ms.project_id
      INNER JOIN dbo.master_uker mu
        ON mu.id = p.uker_id
      INNER JOIN dbo.master_cabang c
        ON c.id = ms.cabang_id
      WHERE ms.id = @machineId
        AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker);
    `)

  return result.recordset[0] || null
}

async function getMappingById(executor, id, scopeCodeUker = null) {
  const result = await executor
    .request()
    .input("id", sql.BigInt, id)
    .input("scopeCodeUker", sql.NVarChar(20), scopeCodeUker)
    .query(`
      SELECT TOP 1
        mk.id,
        mk.machine_id,
        mk.uker_id,
        mk.key_type,
        mk.function_code,
        mk.matrix_wall,
        mk.matrix_column,
        mk.matrix_row,
        mk.random_segment,
        mk.barcode,
        mk.has_tombak,
        mk.has_fascia,
        mk.status,
        mk.current_work_order_id,
        wo.work_order_no AS current_work_order_no,
        mk.checked_out_at,
        mk.checked_in_at,
        mk.notes,
        mk.created_at,
        mk.updated_at,
        CONVERT(VARCHAR(18), CONVERT(VARBINARY(8), mk.row_version), 1) AS row_version,
        ms.tid,
        ms.sn,
        ms.lokasi,
        ms.is_active AS machine_is_active,
        p.nama_project,
        mu.codeuker,
        mu.nama_uker,
        c.nama_cabang
      FROM dbo.machine_key_mappings mk
      INNER JOIN dbo.master_mesin ms
        ON ms.id = mk.machine_id
      INNER JOIN dbo.master_project p
        ON p.id = ms.project_id
      INNER JOIN dbo.master_uker mu
        ON mu.id = mk.uker_id
      INNER JOIN dbo.master_cabang c
        ON c.id = ms.cabang_id
      LEFT JOIN dbo.replenish_work_orders wo
        ON wo.id = mk.current_work_order_id
      WHERE mk.id = @id
        AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker);
    `)

  return normalizeMapping(result.recordset[0])
}

export async function GET(request) {
  const authorization = await authorizeMaster(request, "view")

  if (!authorization.authorized) {
    return authorization.response
  }

  const scopeResult = resolveDataScope(authorization)
  if (scopeResult.response) return scopeResult.response

  try {
    const scope = scopeResult.scope
    const matrixConfig = getMachineKeyMatrixConfig()
    const serializedMatrixConfig = serializeMachineKeyMatrixConfig(matrixConfig)
    const db = await connectDB()

    if (!(await ensureMachineKeySchema(db))) {
      return createErrorResponse(
        "Skema mapping kunci belum lengkap. Jalankan migration 036 dan 037.",
        409,
        { code: "MACHINE_KEY_SCHEMA_REQUIRED" }
      )
    }

    const { searchParams } = new URL(request.url)
    const mode = normalizeText(searchParams.get("mode")).toLowerCase()

    if (mode === "available-machines") {
      const search = normalizeText(searchParams.get("search")).slice(0, 100)
      const limit = normalizeLimit(searchParams.get("limit"))
      const currentMappingId = normalizeId(searchParams.get("current_mapping_id"))

      if (search.length < 2) {
        return NextResponse.json({
          success: true,
          data: { machines: [] },
        })
      }

      const escapedSearch = escapeLikePattern(search)
      const result = await db
        .request()
        .input("limit", sql.Int, limit)
        .input("scopeCodeUker", sql.NVarChar(20), scope.codeUker)
        .input("currentMappingId", sql.BigInt, currentMappingId)
        .input("searchExact", sql.NVarChar(100), search)
        .input("searchPrefix", sql.NVarChar(202), `${escapedSearch}%`)
        .input("searchContains", sql.NVarChar(202), `%${escapedSearch}%`)
        .query(`
          SELECT TOP (@limit)
            ms.id,
            ms.tid,
            ms.sn,
            ms.lokasi,
            ms.is_active,
            p.nama_project,
            p.uker_id,
            mu.codeuker,
            mu.nama_uker,
            c.nama_cabang
          FROM dbo.master_mesin ms
          INNER JOIN dbo.master_project p
            ON p.id = ms.project_id
          INNER JOIN dbo.master_uker mu
            ON mu.id = p.uker_id
          INNER JOIN dbo.master_cabang c
            ON c.id = ms.cabang_id
          WHERE ms.is_active = 1
            AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker)
            AND (
              NOT EXISTS (
                SELECT 1
                FROM dbo.machine_key_mappings existing_mapping
                WHERE existing_mapping.machine_id = ms.id
              )
              OR EXISTS (
                SELECT 1
                FROM dbo.machine_key_mappings current_mapping
                WHERE current_mapping.id = @currentMappingId
                  AND current_mapping.machine_id = ms.id
              )
            )
            AND (
              ms.tid = @searchExact
              OR ms.sn = @searchExact
              OR ms.tid LIKE @searchPrefix ESCAPE '\\'
              OR ms.sn LIKE @searchPrefix ESCAPE '\\'
              OR ms.lokasi LIKE @searchContains ESCAPE '\\'
              OR p.nama_project LIKE @searchContains ESCAPE '\\'
              OR c.nama_cabang LIKE @searchContains ESCAPE '\\'
            )
          ORDER BY
            CASE
              WHEN ms.tid = @searchExact OR ms.sn = @searchExact THEN 0
              WHEN ms.tid LIKE @searchPrefix ESCAPE '\\'
                OR ms.sn LIKE @searchPrefix ESCAPE '\\' THEN 1
              ELSE 2
            END,
            ms.id DESC;
        `)

      return NextResponse.json({
        success: true,
        data: {
          machines: result.recordset.map((machine) => ({
            ...machine,
            id: Number(machine.id),
            uker_id: Number(machine.uker_id),
          })),
        },
      })
    }

    const id = normalizeId(searchParams.get("id"))

    if (searchParams.has("id")) {
      if (!id) return createErrorResponse("ID mapping kunci tidak valid.")

      const mapping = await getMappingById(db, id, scope.codeUker)
      if (!mapping) {
        return createErrorResponse(
          scope.codeUker
            ? "Mapping kunci tidak ditemukan atau bukan milik unit kerja Anda."
            : "Mapping kunci tidak ditemukan.",
          404
        )
      }

      return NextResponse.json({ success: true, data: mapping })
    }

    const wall = normalizeUpperText(searchParams.get("wall"))
    const status = normalizeUpperText(searchParams.get("status"))
    const search = normalizeText(searchParams.get("search")).slice(0, 100)
    const requestedMachineId = normalizeId(searchParams.get("machine_id"))

    if (wall && !matrixConfig.walls.includes(wall)) {
      return createErrorResponse("Filter dinding matrix tidak valid.")
    }

    if (status && !MACHINE_KEY_STATUSES.has(status)) {
      return createErrorResponse("Filter status kunci tidak valid.")
    }

    if (searchParams.has("machine_id") && !requestedMachineId) {
      return createErrorResponse("Filter mesin tidak valid.")
    }

    const totalSlots = matrixConfig.totalSlots
    let matrixScope = {
      uker_id: null,
      codeuker: scope.codeUker,
      nama_uker: null,
      requires_machine_selection: false,
    }

    if (scope.isSuperAdmin && !requestedMachineId) {
      const [canCreate, canUpdate, canDelete] = await Promise.all([
        hasMenuAccess(authorization.user.role_id, "/masters", "create"),
        hasMenuAccess(authorization.user.role_id, "/masters", "update"),
        hasMenuAccess(authorization.user.role_id, "/masters", "delete"),
      ])

      return NextResponse.json({
        success: true,
        data: {
          mappings: [],
          summary: {
            total_slots: totalSlots,
            total_mapped: 0,
            total_unmapped: totalSlots,
            total_in: 0,
            total_out: 0,
            replenish: 0,
            flm: 0,
            backup: 0,
          },
          scope: {
            is_super_admin: true,
            codeuker: null,
          },
          matrix_scope: {
            ...matrixScope,
            requires_machine_selection: true,
          },
          matrix_config: serializedMatrixConfig,
          sync_status: {
            available: false,
            active_machines: 0,
            unmapped_machines: 0,
            free_slots: totalSlots,
            will_map: 0,
            reason: "Pilih mesin untuk menentukan unit kerja yang akan disinkronkan.",
          },
          permissions: {
            can_create: canCreate,
            can_update: canUpdate,
            can_delete: canDelete,
          },
        },
      })
    }

    let selectedMatrixMachine = null

    if (scope.isSuperAdmin) {
      selectedMatrixMachine = await getMachineById(db, requestedMachineId, null)

      if (!selectedMatrixMachine) {
        return createErrorResponse("Mesin untuk scope matrix tidak ditemukan.", 404)
      }

      matrixScope = {
        uker_id: Number(selectedMatrixMachine.uker_id),
        codeuker: selectedMatrixMachine.codeuker,
        nama_uker: selectedMatrixMachine.nama_uker,
        requires_machine_selection: false,
      }
    }

    const whereParts = []
    const listRequest = db.request()
    const summaryRequest = db.request()

    function addInput(name, type, value) {
      listRequest.input(name, type, value)
      summaryRequest.input(name, type, value)
    }

    if (scope.codeUker) {
      addInput("scopeCodeUker", sql.NVarChar(20), scope.codeUker)
      whereParts.push("mu.codeuker = @scopeCodeUker")
    } else {
      addInput("matrixUkerId", sql.BigInt, matrixScope.uker_id)
      whereParts.push("mk.uker_id = @matrixUkerId")
    }

    if (wall) {
      listRequest.input("wall", sql.VarChar(2), wall)
      whereParts.push("mk.matrix_wall = @wall")
    }

    if (status) {
      listRequest.input("status", sql.VarChar(10), status)
      whereParts.push("mk.status = @status")
    }

    if (search) {
      listRequest.input("search", sql.NVarChar(150), `%${search}%`)
      whereParts.push(`(
        mk.barcode LIKE @search
        OR ms.tid LIKE @search
        OR ms.sn LIKE @search
        OR ms.lokasi LIKE @search
        OR p.nama_project LIKE @search
      )`)
    }

    const whereClause = whereParts.length
      ? `WHERE ${whereParts.join(" AND ")}`
      : ""
    const summaryWhere = scope.codeUker
      ? "WHERE mu.codeuker = @scopeCodeUker"
      : "WHERE mk.uker_id = @matrixUkerId"
    const machineSummaryWhere = scope.codeUker
      ? "WHERE mu.codeuker = @scopeCodeUker"
      : "WHERE p.uker_id = @matrixUkerId"

    const [listResult, summaryResult, canCreate, canUpdate, canDelete] =
      await Promise.all([
        listRequest.query(`
          SELECT
            mk.id,
            mk.machine_id,
            mk.uker_id,
            mk.key_type,
            mk.function_code,
            mk.matrix_wall,
            mk.matrix_column,
            mk.matrix_row,
            mk.random_segment,
            mk.barcode,
            mk.has_tombak,
            mk.has_fascia,
            mk.status,
            mk.current_work_order_id,
            wo.work_order_no AS current_work_order_no,
            mk.checked_out_at,
            mk.checked_in_at,
            mk.notes,
            mk.created_at,
            mk.updated_at,
            CONVERT(VARCHAR(18), CONVERT(VARBINARY(8), mk.row_version), 1) AS row_version,
            ms.tid,
            ms.sn,
            ms.lokasi,
            ms.is_active AS machine_is_active,
            p.nama_project,
            mu.codeuker,
            mu.nama_uker,
            c.nama_cabang
          FROM dbo.machine_key_mappings mk
          INNER JOIN dbo.master_mesin ms
            ON ms.id = mk.machine_id
          INNER JOIN dbo.master_project p
            ON p.id = ms.project_id
          INNER JOIN dbo.master_uker mu
            ON mu.id = mk.uker_id
          INNER JOIN dbo.master_cabang c
            ON c.id = ms.cabang_id
          LEFT JOIN dbo.replenish_work_orders wo
            ON wo.id = mk.current_work_order_id
          ${whereClause}
          ORDER BY
            mk.matrix_wall,
            mk.matrix_row,
            mk.matrix_column;
        `),
        summaryRequest.query(`
          SELECT
            COUNT_BIG(1) AS total_mapped,
            SUM(CASE WHEN mk.status = 'IN' THEN 1 ELSE 0 END) AS total_in,
            SUM(CASE WHEN mk.status = 'OUT' THEN 1 ELSE 0 END) AS total_out,
            SUM(CASE WHEN mk.key_type = 'REPLENISH' THEN 1 ELSE 0 END) AS replenish,
            SUM(CASE WHEN mk.key_type = 'FLM' THEN 1 ELSE 0 END) AS flm,
            SUM(CASE WHEN mk.key_type = 'BACKUP' THEN 1 ELSE 0 END) AS backup_count
          FROM dbo.machine_key_mappings mk
          INNER JOIN dbo.master_mesin ms
            ON ms.id = mk.machine_id
          INNER JOIN dbo.master_uker mu
            ON mu.id = mk.uker_id
          ${summaryWhere};

          SELECT
            COUNT_BIG(1) AS active_machines,
            SUM(
              CASE
                WHEN existing_mapping.machine_id IS NULL THEN 1
                ELSE 0
              END
            ) AS unmapped_machines
          FROM dbo.master_mesin ms
          INNER JOIN dbo.master_project p
            ON p.id = ms.project_id
          INNER JOIN dbo.master_uker mu
            ON mu.id = p.uker_id
          LEFT JOIN dbo.machine_key_mappings existing_mapping
            ON existing_mapping.machine_id = ms.id
          ${machineSummaryWhere}
            AND ms.is_active = 1;
        `),
        hasMenuAccess(authorization.user.role_id, "/masters", "create"),
        hasMenuAccess(authorization.user.role_id, "/masters", "update"),
        hasMenuAccess(authorization.user.role_id, "/masters", "delete"),
      ])

    const summaryRow = summaryResult.recordsets?.[0]?.[0] || {}
    const machineSummaryRow = summaryResult.recordsets?.[1]?.[0] || {}
    const totalMapped = Number(summaryRow.total_mapped || 0)
    const freeSlots = Math.max(0, totalSlots - totalMapped)
    const unmappedMachines = Number(machineSummaryRow.unmapped_machines || 0)

    return NextResponse.json({
      success: true,
      data: {
        mappings: listResult.recordset.map(normalizeMapping),
        summary: {
          total_slots: totalSlots,
          total_mapped: totalMapped,
          total_unmapped: freeSlots,
          total_in: Number(summaryRow.total_in || 0),
          total_out: Number(summaryRow.total_out || 0),
          replenish: Number(summaryRow.replenish || 0),
          flm: Number(summaryRow.flm || 0),
          backup: Number(summaryRow.backup_count || 0),
        },
        scope: {
          is_super_admin: scope.isSuperAdmin,
          codeuker: scope.codeUker,
        },
        matrix_scope: matrixScope,
        matrix_config: serializedMatrixConfig,
        sync_status: {
          available: canCreate && unmappedMachines > 0 && freeSlots > 0,
          active_machines: Number(machineSummaryRow.active_machines || 0),
          unmapped_machines: unmappedMachines,
          free_slots: freeSlots,
          will_map: Math.min(unmappedMachines, freeSlots),
          reason:
            unmappedMachines === 0
              ? "Seluruh mesin aktif sudah memiliki mapping."
              : freeSlots === 0
                ? "Seluruh slot matrix sudah penuh."
                : canCreate
                  ? null
                  : "Permission create diperlukan untuk menjalankan sinkronisasi.",
        },
        permissions: {
          can_create: canCreate,
          can_update: canUpdate,
          can_delete: canDelete,
        },
      },
    })
  } catch (error) {
    console.error("GET machine key mapping error:", error)
    return createInternalErrorResponse(error, "Gagal mengambil mapping kunci mesin.")
  }
}

export async function POST(request) {
  const authorization = await authorizeMaster(request, "create")

  if (!authorization.authorized) {
    return authorization.response
  }

  const scopeResult = resolveDataScope(authorization)
  if (scopeResult.response) return scopeResult.response

  let transaction = null

  try {
    let body

    try {
      body = await readJsonBody(request, { maxBytes: 128 * 1024 })
    } catch {
      return createErrorResponse("Format permintaan tidak valid.")
    }

    const matrixConfig = getMachineKeyMatrixConfig()
    const validation = validateMachineKeyPayload(body, matrixConfig)
    if (validation.error) return createErrorResponse(validation.error)

    const scope = scopeResult.scope
    const db = await connectDB()

    if (!(await ensureMachineKeySchema(db))) {
      return createErrorResponse(
        "Skema mapping kunci belum lengkap. Jalankan migration 036 dan 037.",
        409
      )
    }

    const machine = await getMachineById(
      db,
      validation.data.machineId,
      scope.codeUker
    )

    if (!machine) {
      return createErrorResponse(
        scope.codeUker
          ? "Mesin tidak ditemukan atau bukan milik unit kerja Anda."
          : "Mesin tidak ditemukan.",
        404
      )
    }

    if (!machine.is_active) {
      return createErrorResponse("Mesin nonaktif tidak dapat dimapping.", 409)
    }

    transaction = db.transaction()
    await transaction.begin()

    const result = await transaction
      .request()
      .input("machineId", sql.BigInt, validation.data.machineId)
      .input("ukerId", sql.BigInt, machine.uker_id)
      .input("keyType", sql.VarChar(20), validation.data.keyType)
      .input("functionCode", sql.Char(1), validation.data.functionCode)
      .input("matrixWall", sql.VarChar(2), validation.data.matrixWall)
      .input("matrixColumn", sql.Char(1), validation.data.matrixColumn)
      .input("matrixRow", sql.Char(2), validation.data.matrixRow)
      .input("randomSegment", sql.VarChar(4), validation.data.randomSegment)
      .input("hasTombak", sql.Bit, validation.data.hasTombak)
      .input("hasFascia", sql.Bit, validation.data.hasFascia)
      .input("notes", sql.NVarChar(500), validation.data.notes)
      .input("userId", sql.Int, authorization.user.id)
      .query(`
        IF EXISTS (
          SELECT 1
          FROM dbo.machine_key_mappings WITH (UPDLOCK, HOLDLOCK)
          WHERE machine_id = @machineId
        )
          THROW 53620, 'MACHINE_ALREADY_MAPPED', 1;

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
        OUTPUT INSERTED.id
        VALUES (
          @machineId,
          @ukerId,
          @keyType,
          @functionCode,
          @matrixWall,
          @matrixColumn,
          @matrixRow,
          @randomSegment,
          @hasTombak,
          @hasFascia,
          'IN',
          @notes,
          @userId,
          @userId,
          SYSDATETIME(),
          SYSDATETIME()
        );
      `)

    const createdId = Number(result.recordset[0]?.id)

    await insertAuditLog(transaction, {
      request,
      userId: authorization.user.id,
      action: "CREATE",
      module: "masters.kunci-mesin",
      entityType: "machine_key_mapping",
      entityId: createdId,
      metadata: {
        machine_id: validation.data.machineId,
        uker_id: Number(machine.uker_id),
        tid: machine.tid,
        key_type: validation.data.keyType,
        matrix_slot: `${validation.data.matrixWall}-${validation.data.matrixColumn}-${validation.data.matrixRow}`,
        barcode: validation.data.barcode,
        status: "IN",
      },
    })

    await transaction.commit()
    transaction = null

    const created = await getMappingById(db, createdId, scope.codeUker)

    return NextResponse.json(
      {
        success: true,
        message: "Mapping kunci mesin berhasil disimpan.",
        data: created,
      },
      { status: 201 }
    )
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback()
      } catch (rollbackError) {
        console.error("Rollback POST machine key mapping failed:", rollbackError)
      }
    }

    console.error("POST machine key mapping error:", error)

    if (getSqlErrorNumber(error) === 53620) {
      return createErrorResponse(
        "Mesin tersebut sudah memiliki mapping kunci dan tidak dapat dipilih kembali.",
        409
      )
    }

    if ([2601, 2627].includes(getSqlErrorNumber(error))) {
      return createErrorResponse(resolveUniqueConflict(error), 409)
    }

    if (getSqlErrorNumber(error) === 547) {
      return createErrorResponse(
        "Mesin, pengguna, atau data relasi mapping tidak valid.",
        409
      )
    }

    return createInternalErrorResponse(error, "Gagal menyimpan mapping kunci mesin.")
  }
}

export async function PUT(request) {
  const authorization = await authorizeMaster(request, "update")

  if (!authorization.authorized) {
    return authorization.response
  }

  const scopeResult = resolveDataScope(authorization)
  if (scopeResult.response) return scopeResult.response

  let transaction = null

  try {
    let body

    try {
      body = await readJsonBody(request, { maxBytes: 128 * 1024 })
    } catch {
      return createErrorResponse("Format permintaan tidak valid.")
    }

    const id = normalizeId(body.id)
    if (!id) return createErrorResponse("ID mapping kunci tidak valid.")

    const rowVersion = normalizeRowVersionToken(body.row_version)
    if (!rowVersion) {
      return createErrorResponse(
        "Versi data mapping tidak tersedia. Muat ulang sebelum menyimpan.",
        409
      )
    }

    const matrixConfig = getMachineKeyMatrixConfig()
    const validation = validateMachineKeyPayload(body, matrixConfig)
    if (validation.error) return createErrorResponse(validation.error)

    const scope = scopeResult.scope
    const db = await connectDB()

    if (!(await ensureMachineKeySchema(db))) {
      return createErrorResponse(
        "Skema mapping kunci belum lengkap. Jalankan migration 036 dan 037.",
        409
      )
    }

    const existing = await getMappingById(db, id, scope.codeUker)
    if (!existing) {
      return createErrorResponse(
        scope.codeUker
          ? "Mapping kunci tidak ditemukan atau bukan milik unit kerja Anda."
          : "Mapping kunci tidak ditemukan.",
        404
      )
    }

    if (existing.status === "OUT") {
      return createErrorResponse(
        "Mapping tidak dapat diubah saat kunci sedang keluar. Kembalikan kunci terlebih dahulu.",
        409
      )
    }

    if (rowVersion !== normalizeRowVersionToken(existing.row_version)) {
      return createErrorResponse(
        "Mapping telah berubah oleh pengguna lain. Muat ulang sebelum menyimpan.",
        409
      )
    }

    const machine = await getMachineById(
      db,
      validation.data.machineId,
      scope.codeUker
    )

    if (!machine) {
      return createErrorResponse(
        scope.codeUker
          ? "Mesin tidak ditemukan atau bukan milik unit kerja Anda."
          : "Mesin tidak ditemukan.",
        404
      )
    }

    if (!machine.is_active) {
      return createErrorResponse("Mesin nonaktif tidak dapat dimapping.", 409)
    }

    transaction = db.transaction()
    await transaction.begin()

    const updateResult = await transaction
      .request()
      .input("id", sql.BigInt, id)
      .input("rowVersion", sql.VarBinary(8), Buffer.from(rowVersion.slice(2), "hex"))
      .input("machineId", sql.BigInt, validation.data.machineId)
      .input("ukerId", sql.BigInt, machine.uker_id)
      .input("keyType", sql.VarChar(20), validation.data.keyType)
      .input("functionCode", sql.Char(1), validation.data.functionCode)
      .input("matrixWall", sql.VarChar(2), validation.data.matrixWall)
      .input("matrixColumn", sql.Char(1), validation.data.matrixColumn)
      .input("matrixRow", sql.Char(2), validation.data.matrixRow)
      .input("randomSegment", sql.VarChar(4), validation.data.randomSegment)
      .input("hasTombak", sql.Bit, validation.data.hasTombak)
      .input("hasFascia", sql.Bit, validation.data.hasFascia)
      .input("notes", sql.NVarChar(500), validation.data.notes)
      .input("userId", sql.Int, authorization.user.id)
      .query(`
        IF EXISTS (
          SELECT 1
          FROM dbo.machine_key_mappings WITH (UPDLOCK, HOLDLOCK)
          WHERE machine_id = @machineId
            AND id <> @id
        )
          THROW 53620, 'MACHINE_ALREADY_MAPPED', 1;

        UPDATE dbo.machine_key_mappings
        SET
          machine_id = @machineId,
          uker_id = @ukerId,
          key_type = @keyType,
          function_code = @functionCode,
          matrix_wall = @matrixWall,
          matrix_column = @matrixColumn,
          matrix_row = @matrixRow,
          random_segment = @randomSegment,
          has_tombak = @hasTombak,
          has_fascia = @hasFascia,
          notes = @notes,
          updated_by = @userId,
          updated_at = SYSDATETIME()
        WHERE id = @id
          AND row_version = @rowVersion
          AND status = 'IN';
      `)

    if (Number(updateResult.rowsAffected?.[0] || 0) === 0) {
      await transaction.rollback()
      transaction = null
      return createErrorResponse(
        "Mapping telah berubah oleh pengguna lain atau kunci sedang keluar. Muat ulang sebelum menyimpan.",
        409
      )
    }

    await insertAuditLog(transaction, {
      request,
      userId: authorization.user.id,
      action: "UPDATE",
      module: "masters.kunci-mesin",
      entityType: "machine_key_mapping",
      entityId: id,
      metadata: {
        before: {
          machine_id: existing.machine_id,
          uker_id: existing.uker_id,
          tid: existing.tid,
          key_type: existing.key_type,
          matrix_slot: `${existing.matrix_wall}-${existing.matrix_column}-${existing.matrix_row}`,
          barcode: existing.barcode,
        },
        after: {
          machine_id: validation.data.machineId,
          uker_id: Number(machine.uker_id),
          tid: machine.tid,
          key_type: validation.data.keyType,
          matrix_slot: `${validation.data.matrixWall}-${validation.data.matrixColumn}-${validation.data.matrixRow}`,
          barcode: validation.data.barcode,
        },
      },
    })

    await transaction.commit()
    transaction = null

    const updated = await getMappingById(db, id, scope.codeUker)

    return NextResponse.json({
      success: true,
      message: "Mapping kunci mesin berhasil diperbarui.",
      data: updated,
    })
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback()
      } catch (rollbackError) {
        console.error("Rollback PUT machine key mapping failed:", rollbackError)
      }
    }

    console.error("PUT machine key mapping error:", error)

    if (getSqlErrorNumber(error) === 53620) {
      return createErrorResponse(
        "Mesin tersebut sudah memiliki mapping kunci dan tidak dapat dipilih kembali.",
        409
      )
    }

    if ([2601, 2627].includes(getSqlErrorNumber(error))) {
      return createErrorResponse(resolveUniqueConflict(error), 409)
    }

    if (getSqlErrorNumber(error) === 547) {
      return createErrorResponse(
        "Mesin, pengguna, atau data relasi mapping tidak valid.",
        409
      )
    }

    return createInternalErrorResponse(error, "Gagal memperbarui mapping kunci mesin.")
  }
}

export async function DELETE(request) {
  const authorization = await authorizeMaster(request, "delete")

  if (!authorization.authorized) {
    return authorization.response
  }

  const scopeResult = resolveDataScope(authorization)
  if (scopeResult.response) return scopeResult.response

  let transaction = null

  try {
    let body

    try {
      body = await readJsonBody(request, { maxBytes: 64 * 1024 })
    } catch {
      return createErrorResponse("Format permintaan tidak valid.")
    }

    const id = normalizeId(body.id)
    if (!id) return createErrorResponse("ID mapping kunci tidak valid.")

    const rowVersion = normalizeRowVersionToken(body.row_version)
    if (!rowVersion) {
      return createErrorResponse(
        "Versi data mapping tidak tersedia. Muat ulang sebelum menghapus.",
        409
      )
    }

    const scope = scopeResult.scope
    const db = await connectDB()

    if (!(await ensureMachineKeySchema(db))) {
      return createErrorResponse(
        "Skema mapping kunci belum lengkap. Jalankan migration 036 dan 037.",
        409
      )
    }

    const existing = await getMappingById(db, id, scope.codeUker)
    if (!existing) {
      return createErrorResponse(
        scope.codeUker
          ? "Mapping kunci tidak ditemukan atau bukan milik unit kerja Anda."
          : "Mapping kunci tidak ditemukan.",
        404
      )
    }

    if (existing.status === "OUT") {
      return createErrorResponse(
        "Mapping tidak dapat dihapus saat kunci sedang keluar.",
        409
      )
    }

    if (rowVersion !== normalizeRowVersionToken(existing.row_version)) {
      return createErrorResponse(
        "Mapping telah berubah oleh pengguna lain. Muat ulang sebelum menghapus.",
        409
      )
    }

    transaction = db.transaction()
    await transaction.begin()

    const deleteResult = await transaction
      .request()
      .input("id", sql.BigInt, id)
      .input("rowVersion", sql.VarBinary(8), Buffer.from(rowVersion.slice(2), "hex"))
      .query(`
        DELETE FROM dbo.machine_key_mappings
        WHERE id = @id
          AND row_version = @rowVersion
          AND status = 'IN';
      `)

    if (Number(deleteResult.rowsAffected?.[0] || 0) === 0) {
      await transaction.rollback()
      transaction = null
      return createErrorResponse(
        "Mapping telah berubah oleh pengguna lain atau kunci sedang keluar. Muat ulang sebelum menghapus.",
        409
      )
    }

    await insertAuditLog(transaction, {
      request,
      userId: authorization.user.id,
      action: "DELETE",
      module: "masters.kunci-mesin",
      entityType: "machine_key_mapping",
      entityId: id,
      metadata: {
        machine_id: existing.machine_id,
        tid: existing.tid,
        key_type: existing.key_type,
        matrix_slot: `${existing.matrix_wall}-${existing.matrix_column}-${existing.matrix_row}`,
        barcode: existing.barcode,
      },
    })

    await transaction.commit()
    transaction = null

    return NextResponse.json({
      success: true,
      message: "Mapping kunci mesin berhasil dihapus. Slot kembali berwarna kuning.",
    })
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback()
      } catch (rollbackError) {
        console.error("Rollback DELETE machine key mapping failed:", rollbackError)
      }
    }

    console.error("DELETE machine key mapping error:", error)
    return createInternalErrorResponse(error, "Gagal menghapus mapping kunci mesin.")
  }
}
