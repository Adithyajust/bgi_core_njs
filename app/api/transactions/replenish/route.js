import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { readJsonBody, InvalidJsonBodyError, RequestBodyTooLargeError } from "@/lib/http/json-body"
import { connectDB, sql } from "@/lib/mssql"
import { writeAuditLog } from "@/lib/security/audit-log"
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
import { isReplenishTeamApprover } from "@/modules/replenish/authorization"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_PAGE_SIZE = 10
const MAXIMUM_PAGE_SIZE = 50
const MAX_BODY_BYTES = 128 * 1024
const STATUS_SET = new Set(REPLENISH_WORK_ORDER_STATUSES)
const ACTIVITY_SET = new Set(REPLENISH_ACTIVITY_TYPES)

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
    const searchPattern = `%${escapeLike(search)}%`
    const take = pageSize + 1

    const listResult = await db
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
          wo.created_at,
          wo.updated_at,
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
          AND (@activityType IS NULL OR wo.activity_type = @activityType)
          AND (@dateFrom IS NULL OR wo.schedule_date >= CONVERT(DATE, @dateFrom, 23))
          AND (@dateTo IS NULL OR wo.schedule_date <= CONVERT(DATE, @dateTo, 23))
          AND (
            @search = '%%'
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
                )
            )
          )
        ORDER BY wo.id DESC;
      `)

    const summaryResult = await db
      .request()
      .input("scopeUkerId", sql.BigInt, scopeUkerId)
      .query(`
        SELECT
          COUNT_BIG(1) AS total,
          SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) AS draft,
          SUM(CASE WHEN status = 'MENUNGGU_PERSETUJUAN_TIM' THEN 1 ELSE 0 END) AS waiting_approval,
          SUM(CASE WHEN status = 'DISETUJUI' THEN 1 ELSE 0 END) AS approved,
          SUM(CASE WHEN status IN ('GAGAL', 'TERDAPAT_SELISIH', 'DALAM_INVESTIGASI') THEN 1 ELSE 0 END) AS attention,
          SUM(total_requested_amount) AS total_requested_amount
        FROM dbo.replenish_work_orders
        WHERE (@scopeUkerId IS NULL OR uker_id = @scopeUkerId);
      `)

    const rows = listResult.recordset
    const hasMore = rows.length > pageSize
    const pagedRows = hasMore ? rows.slice(0, pageSize) : rows
    const items = pagedRows.map((item) => ({
      ...item,
      // Pastikan token concurrency selalu berbentuk 0x + 16 digit hex.
      // Beberapa versi driver SQL dapat mengembalikan hasil konversi sebagai
      // Buffer-like object walaupun query sudah menggunakan VARCHAR.
      row_version: normalizeRowVersionToken(item.row_version),
    }))
    const summary = summaryResult.recordset[0] || {}

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
      },
    })
  } catch (error) {
    return internalError(error, "Gagal mengambil data work order replenish.")
  }
}

export async function POST(request) {
  const authorization = await authorizeTransaction(request, "create")
  if (!authorization.authorized) return authorization.response

  if (
    authorization.user.role_code !== "SUPER_ADMIN" &&
    isReplenishTeamApprover(authorization.user)
  ) {
    return errorResponse(
      "Manager Operasional dan Asisten Manager CRO bertindak sebagai checker dan tidak dapat membuat work order Replenish.",
      403
    )
  }

  let body
  try {
    body = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return errorResponse("Data work order terlalu besar.", 413)
    }
    if (error instanceof InvalidJsonBodyError) {
      return errorResponse(error.message, 400)
    }
    throw error
  }

  const validation = validateReplenishPayload(body)
  if (validation.error) return errorResponse(validation.error)

  const db = await connectDB()
  const transaction = new sql.Transaction(db)
  let transactionFinished = false

  try {
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)

    const scope = getUserDataScope(authorization.user)
    const resolved = await resolveReplenishUker(
      transaction,
      scope,
      validation.data.ukerId
    )
    if (resolved.error) {
      await transaction.rollback()
      return errorResponse(resolved.error, scope.isSuperAdmin ? 400 : 403)
    }

    const referenceValidation = await validateReplenishReferences(
      transaction,
      validation.data,
      resolved.uker.id
    )
    if (referenceValidation.error) {
      await transaction.rollback()
      return errorResponse(referenceValidation.error, 409)
    }

    const workOrderNo = await createWorkOrderNumber(
      transaction,
      validation.data.scheduleDate
    )
    const totalRequestedAmount = calculateRequestedAmount(validation.data.points)

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
      .query(`
        INSERT INTO dbo.replenish_work_orders
        (
          work_order_no, uker_id, activity_type, schedule_date,
          departure_time, estimated_finish_time, priority, vehicle_id,
          escort_name, status, total_points, total_requested_amount, route_notes, notes,
          created_by, created_at, updated_at
        )
        OUTPUT inserted.id
        VALUES
        (
          @workOrderNo, @ukerId, @activityType,
          CONVERT(DATE, @scheduleDate, 23),
          CONVERT(TIME(0), @departureTime),
          CONVERT(TIME(0), @estimatedFinishTime),
          @priority, @vehicleId, @escortName, 'DRAFT', @totalPoints,
          @totalRequestedAmount, @routeNotes, @notes,
          @createdBy, SYSDATETIME(), SYSDATETIME()
        );
      `)

    const workOrderId = Number(insertResult.recordset[0]?.id)
    await replaceWorkOrderDetails(transaction, workOrderId, validation.data)

    await new sql.Request(transaction)
      .input("workOrderId", sql.BigInt, workOrderId)
      .input("actorUserId", sql.Int, authorization.user.id)
      .query(`
        INSERT INTO dbo.replenish_status_history
          (work_order_id, from_status, to_status, action, notes, actor_user_id)
        VALUES
          (@workOrderId, NULL, 'DRAFT', 'CREATE', 'Work order dibuat.', @actorUserId);
      `)

    await transaction.commit()
    transactionFinished = true

    let created
    try {
      created = await getReplenishWorkOrderDetail(
        db,
        workOrderId,
        scope.isSuperAdmin ? null : scope.codeUker
      )
    } catch (detailError) {
      console.error("Work order created but detail reload failed:", detailError)
      created = {
        id: workOrderId,
        work_order_no: workOrderNo,
        status: "DRAFT",
      }
    }

    await writeAuditLog({
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
      },
    })

    return NextResponse.json(
      {
        success: true,
        message: `Work order ${workOrderNo} berhasil dibuat sebagai draft.`,
        data: { work_order: created },
      },
      { status: 201 }
    )
  } catch (error) {
    if (!transactionFinished) {
      try {
        await transaction.rollback()
      } catch {
        // Transaksi mungkin telah dibatalkan SQL Server.
      }
    }
    return internalError(error, "Gagal membuat work order replenish.")
  }
}
