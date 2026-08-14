import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope, hasMenuAccess } from "@/lib/access-control"
import { readJsonBody, InvalidJsonBodyError, RequestBodyTooLargeError } from "@/lib/http/json-body"
import { runInTransaction, isRetryableSqlError } from "@/lib/database/transaction"
import { connectDB, sql } from "@/lib/mssql"
import { insertAuditLog } from "@/lib/security/audit-log"
import { normalizeRowVersionToken } from "@/modules/master-mesin/row-version"
import {
  calculateRequestedAmount,
  createWorkOrderNumber,
  getReplenishWorkOrderDetail,
  replaceWorkOrderDetails,
  resolveReplenishUker,
  validateReplenishReferences,
} from "@/modules/replenish/database"
import {
  REPLENISH_ACTIVITY_TYPES,
  REPLENISH_WORK_ORDER_STATUSES,
} from "@/modules/replenish/constants"
import { validateReplenishPayload } from "@/modules/replenish/validation"
import { isReplenishKeyHandoverPrinter, isReplenishTeamApprover } from "@/modules/replenish/authorization"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_PAGE_SIZE = 10
const MAXIMUM_PAGE_SIZE = 50
const MAX_BODY_BYTES = 128 * 1024
const STATUS_SET = new Set(REPLENISH_WORK_ORDER_STATUSES)
const ACTIVITY_SET = new Set(REPLENISH_ACTIVITY_TYPES)
const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

class ReplenishRouteError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = "ReplenishRouteError"
    this.status = status
  }
}

function normalizeIdempotencyKey(request) {
  const value = String(request.headers.get("idempotency-key") || "").trim()
  return IDEMPOTENCY_KEY_PATTERN.test(value) ? value.toLowerCase() : null
}

function sqlErrorNumber(error) {
  return Number(error?.number || error?.originalError?.info?.number || 0)
}

function errorResponse(message, status = 400, extra = {}) {
  return NextResponse.json({ success: false, message, ...extra }, { status })
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizePositiveInteger(value, fallback, maximum = null) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback
  return maximum === null ? parsed : Math.min(parsed, maximum)
}

function normalizeCursor(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeDateFilter(value) {
  const normalized = normalizeText(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null
}

function escapeLike(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")
}

function internalError(error, fallbackMessage) {
  console.error(fallbackMessage, error)
  if (isRetryableSqlError(error) || sqlErrorNumber(error) === 52710) {
    return NextResponse.json(
      { success: false, message: "Sistem sedang memproses transaksi lain. Coba kembali beberapa saat lagi." },
      { status: 503, headers: { "Retry-After": "1" } }
    )
  }
  const detail = process.env.NODE_ENV === "production" ? "" : ` Detail: ${error.message}`
  return errorResponse(`${fallbackMessage}${detail}`, 500)
}

async function authorizeTransaction(request, action = "view") {
  return authorizeApiRequest(request, "/transactions", action)
}

export async function GET(request) {
  const authorization = await authorizeTransaction(request, "view")
  if (!authorization.authorized) return authorization.response

  try {
    const url = new URL(request.url)
    const pageSize = normalizePositiveInteger(
      url.searchParams.get("page_size"),
      DEFAULT_PAGE_SIZE,
      MAXIMUM_PAGE_SIZE
    )
    const afterId = normalizeCursor(url.searchParams.get("after_id"))
    const search = normalizeText(url.searchParams.get("search")).slice(0, 100)
    const rawStatus = normalizeText(url.searchParams.get("status")).toUpperCase()
    const rawActivity = normalizeText(url.searchParams.get("activity_type")).toUpperCase()
    const status = STATUS_SET.has(rawStatus) ? rawStatus : null
    const activityType = ACTIVITY_SET.has(rawActivity) ? rawActivity : null
    const dateFrom = normalizeDateFilter(url.searchParams.get("date_from"))
    const dateTo = normalizeDateFilter(url.searchParams.get("date_to"))

    const db = await connectDB()
    const scope = getUserDataScope(authorization.user)
    const [canCreateTransaction, canUpdateTransaction] = scope.isSuperAdmin
      ? [true, true]
      : await Promise.all([
          hasMenuAccess(authorization.user.role_id, "/transactions", "create"),
          hasMenuAccess(authorization.user.role_id, "/transactions", "update"),
        ])
    const canPrintKeyHandoverByAccess = Boolean(
      scope.isSuperAdmin ||
      isReplenishKeyHandoverPrinter(authorization.user) ||
      canCreateTransaction ||
      canUpdateTransaction
    )
    const resolved = await resolveReplenishUker(
      db,
      scope,
      normalizeCursor(url.searchParams.get("uker_id"))
    )

    if (resolved.error && !scope.isSuperAdmin) {
      return errorResponse(resolved.error, 403)
    }

    const scopeUkerId = scope.isSuperAdmin
      ? normalizeCursor(url.searchParams.get("uker_id"))
      : resolved.uker.id
    const searchPattern = search ? `${escapeLike(search)}%` : "%"
    const take = pageSize + 1

    const listAndSummaryResult = await db
      .request()
      .input("take", sql.Int, take)
      .input("afterId", sql.BigInt, afterId)
      .input("scopeUkerId", sql.BigInt, scopeUkerId)
      .input("status", sql.VarChar(40), status)
      .input("activityType", sql.VarChar(20), activityType)
      .input("dateFrom", sql.VarChar(10), dateFrom)
      .input("dateTo", sql.VarChar(10), dateTo)
      .input("search", sql.NVarChar(210), searchPattern)
      .query(`
        SELECT TOP (@take)
          wo.id,
          wo.work_order_no,
          wo.uker_id,
          mu.codeuker,
          mu.nama_uker,
          wo.activity_type,
          CONVERT(CHAR(10), wo.schedule_date, 23) AS schedule_date,
          CONVERT(CHAR(5), wo.departure_time, 108) AS departure_time,
          CONVERT(CHAR(5), wo.estimated_finish_time, 108) AS estimated_finish_time,
          wo.priority,
          wo.vehicle_id,
          CONCAT(k.nomor_kendaraan, ' · ', k.merk_kendaraan) AS vehicle_label,
          wo.escort_name,
          wo.status,
          wo.total_points,
          wo.total_requested_amount,
          wo.created_by,
          creator.full_name AS created_by_name,
          team.custody_name,
          team.driver_name,
          CONVERT(CHAR(19), wo.created_at, 126) AS created_at,
          CONVERT(CHAR(19), wo.updated_at, 126) AS updated_at,
          CONVERT(VARCHAR(18), wo.row_version, 1) AS row_version
        FROM dbo.replenish_work_orders wo
        INNER JOIN dbo.master_uker mu ON mu.id = wo.uker_id
        INNER JOIN dbo.master_kendaraan k ON k.id = wo.vehicle_id
        INNER JOIN dbo.users creator ON creator.id = wo.created_by
        OUTER APPLY (
          SELECT
            MAX(CASE WHEN tm.member_role = 'CUSTODY' THEN p.nama END) AS custody_name,
            MAX(CASE WHEN tm.member_role = 'PENGEMUDI' THEN p.nama END) AS driver_name
          FROM dbo.replenish_team_members tm
          INNER JOIN dbo.pegawai p ON p.id = tm.employee_id
          WHERE tm.work_order_id = wo.id
        ) team
        WHERE (@scopeUkerId IS NULL OR wo.uker_id = @scopeUkerId)
          AND (@afterId IS NULL OR wo.id < @afterId)
          AND (@status IS NULL OR wo.status = @status)
          AND (
            @activityType IS NULL
            OR EXISTS (
              SELECT 1
              FROM dbo.replenish_work_order_points activity_point
              WHERE activity_point.work_order_id = wo.id
                AND activity_point.activity_type = @activityType
            )
          )
          AND (@dateFrom IS NULL OR wo.schedule_date >= CONVERT(DATE, @dateFrom, 23))
          AND (@dateTo IS NULL OR wo.schedule_date <= CONVERT(DATE, @dateTo, 23))
          AND (
            @search = '%'
            OR wo.work_order_no LIKE @search ESCAPE '\\'
            OR mu.nama_uker LIKE @search ESCAPE '\\'
            OR EXISTS (
              SELECT 1
              FROM dbo.replenish_work_order_points search_point
              INNER JOIN dbo.master_mesin search_machine
                ON search_machine.id = search_point.machine_id
              WHERE search_point.work_order_id = wo.id
                AND (
                  search_machine.tid LIKE @search ESCAPE '\\'
                  OR search_machine.sn LIKE @search ESCAPE '\\'
                  OR search_machine.lokasi LIKE @search ESCAPE '\\'
                  OR search_machine.denom LIKE @search ESCAPE '\\'
                )
            )
          )
        ORDER BY wo.id DESC;

        -- Compatibility fallback: daftar tetap dapat dibuka ketika migration 031
        -- belum diterapkan. Dynamic SQL mencegah SQL Server mengompilasi referensi
        -- ke tabel summary yang belum tersedia. Jalur fallback hanya sementara;
        -- production tetap wajib menjalankan seluruh database migration.
        IF OBJECT_ID(N'dbo.replenish_work_order_summary', N'U') IS NOT NULL
        BEGIN
          EXEC sys.sp_executesql
            N'SELECT
                COALESCE(SUM(total_count), 0) AS total,
                COALESCE(SUM(draft_count), 0) AS draft,
                COALESCE(SUM(waiting_approval_count), 0) AS waiting_approval,
                COALESCE(SUM(approved_count), 0) AS approved,
                COALESCE(SUM(attention_count), 0) AS attention,
                COALESCE(SUM(total_requested_amount), 0) AS total_requested_amount,
                CONVERT(BIT, 1) AS schema_ready
              FROM dbo.replenish_work_order_summary
              WHERE @scopeUkerId IS NULL OR uker_id = @scopeUkerId;',
            N'@scopeUkerId BIGINT',
            @scopeUkerId = @scopeUkerId;
        END
        ELSE
        BEGIN
          SELECT
            COUNT_BIG(1) AS total,
            COALESCE(SUM(CASE WHEN status = 'DRAFT' THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END), 0) AS draft,
            COALESCE(SUM(CASE WHEN status = 'MENUNGGU_PERSETUJUAN_TIM' THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END), 0) AS waiting_approval,
            COALESCE(SUM(CASE WHEN status = 'DISETUJUI' THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END), 0) AS approved,
            COALESCE(SUM(CASE WHEN status IN ('GAGAL', 'TERDAPAT_SELISIH', 'DALAM_INVESTIGASI') THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END), 0) AS attention,
            COALESCE(SUM(CONVERT(DECIMAL(38,2), total_requested_amount)), 0) AS total_requested_amount,
            CONVERT(BIT, 0) AS schema_ready
          FROM dbo.replenish_work_orders
          WHERE @scopeUkerId IS NULL OR uker_id = @scopeUkerId;
        END;
      `)

    const rows = listAndSummaryResult.recordsets?.[0] || []
    const hasMore = rows.length > pageSize
    const pagedRows = hasMore ? rows.slice(0, pageSize) : rows
    const items = pagedRows.map((item) => ({
      ...item,
      // Visibility cetak dikirim dari backend agar UI tidak menebak nama role.
      // Owner WO tetap boleh melihat tombol; readiness tetap ditentukan status/scan.
      can_print_key_handover: Boolean(
        canPrintKeyHandoverByAccess || Number(item.created_by) === Number(authorization.user.id)
      ),
      // Pastikan token concurrency selalu berbentuk 0x + 16 digit hex.
      // Beberapa versi driver SQL dapat mengembalikan hasil konversi sebagai
      // Buffer-like object walaupun query sudah menggunakan VARCHAR.
      row_version: normalizeRowVersionToken(item.row_version),
    }))
    const summary = listAndSummaryResult.recordsets?.[1]?.[0] || {}
    const schemaReady = Boolean(summary.schema_ready)

    if (!schemaReady) {
      console.warn(
        "Replenish berjalan dalam compatibility mode. Jalankan npm run db:migrate untuk menerapkan migration 031."
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        work_orders: items,
        pagination: {
          page_size: pageSize,
          has_more: hasMore,
          next_cursor: hasMore ? items.at(-1)?.id || null : null,
        },
        summary: {
          total: Number(summary.total || 0),
          draft: Number(summary.draft || 0),
          waiting_approval: Number(summary.waiting_approval || 0),
          approved: Number(summary.approved || 0),
          attention: Number(summary.attention || 0),
          total_requested_amount: Number(summary.total_requested_amount || 0),
        },
        scope: {
          is_super_admin: scope.isSuperAdmin,
          uker_id: scopeUkerId,
          codeuker: resolved.uker?.codeuker || null,
          nama_uker: resolved.uker?.nama_uker || null,
        },
        capabilities: {
          can_print_key_handover: canPrintKeyHandoverByAccess,
        },
        database_schema: {
          replenish_scalability_ready: schemaReady,
        },
      },
    })
  } catch (error) {
    return internalError(error, "Gagal mengambil data work order replenish.")
  }
}

export async function POST(request) {
  const authorization = await authorizeTransaction(request, "create")
  if (!authorization.authorized) return authorization.response

  if (authorization.user.role_code !== "SUPER_ADMIN" && isReplenishTeamApprover(authorization.user)) {
    return errorResponse(
      "Manager Operasional dan Asisten Manager CRO bertindak sebagai checker dan tidak dapat membuat work order Replenish.",
      403
    )
  }

  const idempotencyKey = normalizeIdempotencyKey(request)
  if (!idempotencyKey) {
    return errorResponse("Header Idempotency-Key wajib berupa UUID yang valid untuk mencegah transaksi ganda.", 400)
  }

  let body
  try {
    body = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return errorResponse("Data work order terlalu besar.", 413)
    if (error instanceof InvalidJsonBodyError) return errorResponse(error.message, 400)
    return internalError(error, "Gagal membaca data work order replenish.")
  }

  const validation = validateReplenishPayload(body)
  if (validation.error) return errorResponse(validation.error)

  const db = await connectDB()
  const scope = getUserDataScope(authorization.user)

  async function loadExistingIdempotentWorkOrder() {
    const existingResult = await db.request()
      .input("createdBy", sql.Int, authorization.user.id)
      .input("clientRequestId", sql.UniqueIdentifier, idempotencyKey)
      .query(`
        SELECT TOP (1) id, work_order_no, status
        FROM dbo.replenish_work_orders
        WHERE created_by = @createdBy AND client_request_id = @clientRequestId;
      `)
    const existing = existingResult.recordset[0]
    if (!existing) return null
    return (await getReplenishWorkOrderDetail(
      db, existing.id, scope.isSuperAdmin ? null : scope.codeUker
    )) || existing
  }

  try {
    const replayed = await loadExistingIdempotentWorkOrder()
    if (replayed) {
      return NextResponse.json(
        {
          success: true,
          message: `Permintaan sebelumnya telah diproses sebagai ${replayed.work_order_no}.`,
          data: { work_order: replayed, idempotent_replay: true },
        },
        { status: 200, headers: { "Idempotency-Replayed": "true" } }
      )
    }

    const createdIdentity = await runInTransaction(
      db,
      async (transaction) => {
        const resolved = await resolveReplenishUker(transaction, scope, validation.data.ukerId)
        if (resolved.error) {
          throw new ReplenishRouteError(resolved.error, scope.isSuperAdmin ? 400 : 403)
        }

        const referenceValidation = await validateReplenishReferences(
          transaction, validation.data, resolved.uker.id
        )
        if (referenceValidation.error) throw new ReplenishRouteError(referenceValidation.error, 409)

        const transactionData = {
          ...validation.data,
          points: referenceValidation.points,
        }
        const workOrderNo = await createWorkOrderNumber(transaction, transactionData.scheduleDate)
        const totalRequestedAmount = calculateRequestedAmount(transactionData.points)
        const insertResult = await new sql.Request(transaction)
          .input("workOrderNo", sql.VarChar(30), workOrderNo)
          .input("ukerId", sql.BigInt, resolved.uker.id)
          .input("activityType", sql.VarChar(20), validation.data.activityType)
          .input("scheduleDate", sql.VarChar(10), validation.data.scheduleDate)
          .input("departureTime", sql.VarChar(5), validation.data.departureTime)
          .input("estimatedFinishTime", sql.VarChar(5), validation.data.estimatedFinishTime)
          .input("priority", sql.VarChar(10), validation.data.priority)
          .input("vehicleId", sql.BigInt, validation.data.vehicleId)
          .input("escortName", sql.NVarChar(200), validation.data.escortName)
          .input("totalPoints", sql.SmallInt, validation.data.points.length)
          .input("totalRequestedAmount", sql.Decimal(19, 2), totalRequestedAmount)
          .input("routeNotes", sql.NVarChar(1000), validation.data.routeNotes)
          .input("notes", sql.NVarChar(1000), validation.data.notes)
          .input("createdBy", sql.Int, authorization.user.id)
          .input("clientRequestId", sql.UniqueIdentifier, idempotencyKey)
          .query(`
            DECLARE @insertedWorkOrder TABLE
            (
              id BIGINT NOT NULL
            );

            INSERT INTO dbo.replenish_work_orders
            (
              work_order_no, uker_id, activity_type, schedule_date,
              departure_time, estimated_finish_time, priority, vehicle_id,
              escort_name, status, total_points, total_requested_amount,
              route_notes, notes, created_by, client_request_id, created_at, updated_at
            )
            OUTPUT inserted.id INTO @insertedWorkOrder (id)
            VALUES
            (
              @workOrderNo, @ukerId, @activityType, CONVERT(DATE, @scheduleDate, 23),
              CONVERT(TIME(0), @departureTime), CONVERT(TIME(0), @estimatedFinishTime),
              @priority, @vehicleId, @escortName, 'DRAFT', @totalPoints,
              @totalRequestedAmount, @routeNotes, @notes, @createdBy, @clientRequestId,
              SYSDATETIME(), SYSDATETIME()
            );

            SELECT id
            FROM @insertedWorkOrder;
          `)

        const workOrderId = Number(insertResult.recordset[0]?.id)
        await replaceWorkOrderDetails(transaction, workOrderId, transactionData)
        await new sql.Request(transaction)
          .input("workOrderId", sql.BigInt, workOrderId)
          .input("actorUserId", sql.Int, authorization.user.id)
          .query(`
            INSERT INTO dbo.replenish_status_history
              (work_order_id, from_status, to_status, action, notes, actor_user_id)
            VALUES (@workOrderId, NULL, 'DRAFT', 'CREATE', 'Work order dibuat.', @actorUserId);
          `)

        await insertAuditLog(transaction, {
          request,
          userId: authorization.user.id,
          action: "CREATE",
          module: "transactions.replenish",
          entityType: "replenish_work_order",
          entityId: workOrderId,
          metadata: {
            work_order_no: workOrderNo,
            activity_type: validation.data.activityType,
            schedule_date: validation.data.scheduleDate,
            total_points: validation.data.points.length,
            total_requested_amount: totalRequestedAmount,
            escort_name: validation.data.escortName,
            idempotency_key: idempotencyKey,
          },
        })
        return { workOrderId, workOrderNo }
      },
      { isolationLevel: sql.ISOLATION_LEVEL.READ_COMMITTED, maxRetries: 2 }
    )

    let created
    try {
      created = await getReplenishWorkOrderDetail(
        db, createdIdentity.workOrderId, scope.isSuperAdmin ? null : scope.codeUker
      )
    } catch (detailError) {
      console.error("Work order created but detail reload failed:", detailError)
      created = { id: createdIdentity.workOrderId, work_order_no: createdIdentity.workOrderNo, status: "DRAFT" }
    }

    return NextResponse.json(
      {
        success: true,
        message: `Work order ${createdIdentity.workOrderNo} berhasil dibuat sebagai draft.`,
        data: { work_order: created, idempotent_replay: false },
      },
      { status: 201, headers: { "Idempotency-Replayed": "false" } }
    )
  } catch (error) {
    if (error instanceof ReplenishRouteError) return errorResponse(error.message, error.status)
    if ([2601, 2627].includes(sqlErrorNumber(error))) {
      const existing = await loadExistingIdempotentWorkOrder()
      if (existing) {
        return NextResponse.json(
          {
            success: true,
            message: `Permintaan sebelumnya telah diproses sebagai ${existing.work_order_no}.`,
            data: { work_order: existing, idempotent_replay: true },
          },
          { status: 200, headers: { "Idempotency-Replayed": "true" } }
        )
      }
    }
    return internalError(error, "Gagal membuat work order replenish.")
  }
}

