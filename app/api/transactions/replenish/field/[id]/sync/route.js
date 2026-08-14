import { createHash } from "node:crypto"

import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { runInTransaction, isRetryableSqlError } from "@/lib/database/transaction"
import { readJsonBody, InvalidJsonBodyError, RequestBodyTooLargeError } from "@/lib/http/json-body"
import { connectDB, sql } from "@/lib/mssql"
import { insertAuditLog } from "@/lib/security/audit-log"
import {
  isReplenishFieldCustody,
  isReplenishFieldDriver,
  isReplenishFieldSupervisor,
} from "@/modules/replenish/authorization"
import { REPLENISH_FIELD_ACTIONS, REPLENISH_FIELD_MENU_HREF } from "@/modules/replenish/constants"
import { getReplenishFieldSnapshot } from "@/modules/replenish/field-database"
import {
  deleteFieldEvidence,
  prepareFieldEvidence,
  saveFieldEvidence,
} from "@/modules/replenish/field-evidence-storage"
import {
  comparePointScan,
  normalizeFieldEvent,
  normalizePointScan,
  ReplenishFieldValidationError,
  requireFieldLocation,
} from "@/modules/replenish/field-validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 5 * 1024 * 1024
const GPS_ACTIONS = new Set([
  REPLENISH_FIELD_ACTIONS.CONFIRM_DEPARTURE,
  REPLENISH_FIELD_ACTIONS.START_TRIP,
  REPLENISH_FIELD_ACTIONS.ARRIVE_POINT,
  REPLENISH_FIELD_ACTIONS.START_POINT,
  REPLENISH_FIELD_ACTIONS.COMPLETE_POINT,
  REPLENISH_FIELD_ACTIONS.REPORT_EXCEPTION,
  REPLENISH_FIELD_ACTIONS.START_RETURN,
  REPLENISH_FIELD_ACTIONS.ARRIVE_OFFICE,
])

function normalizeId(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function errorResponse(message, status = 400, extra = {}) {
  return NextResponse.json({ success: false, message, ...extra }, { status })
}

function normalizeReason(value, { required = false } = {}) {
  const reason = String(value || "").trim().slice(0, 1000)
  if (required && reason.length < 10) {
    throw new ReplenishFieldValidationError("Alasan wajib diisi minimal 10 karakter.")
  }
  return reason || null
}

function auditPayload(event, preparedEvidence) {
  const payload = { ...event.payload }
  if (payload.evidence) {
    payload.evidence = preparedEvidence
      ? {
          mime_type: preparedEvidence.mimeType,
          size: preparedEvidence.size,
          sha256: preparedEvidence.sha256,
          original_name: preparedEvidence.originalName,
        }
      : null
  }
  return payload
}

function attachCapabilities(snapshot, user) {
  if (!snapshot) return null
  const assignment = snapshot.team.find((member) =>
    Number(member.employee_id) === Number(user?.pegawai_id)
  )
  return {
    ...snapshot,
    capabilities: {
      assigned_role: assignment?.member_role || null,
      can_operate: assignment?.member_role === "CUSTODY" && isReplenishFieldCustody(user),
      can_confirm_departure: assignment?.member_role === "PENGEMUDI" && isReplenishFieldDriver(user),
      can_review_exception: isReplenishFieldSupervisor(user),
    },
  }
}

async function acquireWorkOrderLock(executor, workOrderId) {
  const result = await new sql.Request(executor)
    .input("resource", sql.NVarChar(255), `replenish-field:${workOrderId}`)
    .query(`
      DECLARE @result INT;
      EXEC @result = sys.sp_getapplock
        @Resource = @resource,
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = 10000;
      SELECT @result AS lock_result;
    `)
  if (Number(result.recordset[0]?.lock_result) < 0) {
    throw new ReplenishFieldValidationError("Job sedang diproses perangkat lain. Coba kembali.", 503)
  }
}

async function getLockedContext(executor, workOrderId, pointId, employeeId, scopeCodeUker) {
  const result = await new sql.Request(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("pointId", sql.BigInt, pointId)
    .input("employeeId", sql.BigInt, employeeId || null)
    .input("scopeCodeUker", sql.NVarChar(4), scopeCodeUker)
    .query(`
      SELECT TOP (1)
        wo.id, wo.work_order_no, wo.status, wo.uker_id, unit.codeuker
      FROM dbo.replenish_work_orders wo WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN dbo.master_uker unit ON unit.id = wo.uker_id
      WHERE wo.id = @workOrderId
        AND (@scopeCodeUker IS NULL OR unit.codeuker = @scopeCodeUker);

      SELECT TOP (1) member.member_role, member.employee_id
      FROM dbo.replenish_team_members member
      WHERE member.work_order_id = @workOrderId
        AND member.employee_id = @employeeId;

      SELECT TOP (1)
        point.id, point.work_order_id, point.status, point.sequence_no,
        machine.tid, machine.lokasi
      FROM dbo.replenish_work_order_points point WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN dbo.master_mesin machine ON machine.id = point.machine_id
      WHERE point.id = @pointId
        AND point.work_order_id = @workOrderId;

      SELECT
        cassette.cassette_no,
        cassette.cassette_serial,
        cassette.seal_no
      FROM dbo.cpc_packing_cassettes cassette WITH (UPDLOCK, HOLDLOCK)
      WHERE cassette.work_order_point_id = @pointId
      ORDER BY cassette.cassette_no;

      SELECT TOP (1)
        asset.reject_cassette_serial,
        asset.reject_cassette_seal_no,
        asset.departure_bag_seal_no,
        asset.return_bag_seal_no
      FROM dbo.cpc_packing_tid_assets asset WITH (UPDLOCK, HOLDLOCK)
      WHERE asset.work_order_point_id = @pointId;
    `)

  return {
    workOrder: result.recordsets?.[0]?.[0] || null,
    assignment: result.recordsets?.[1]?.[0] || null,
    point: result.recordsets?.[2]?.[0] || null,
    cassettes: result.recordsets?.[3] || [],
    assets: result.recordsets?.[4]?.[0] || null,
  }
}

function assertActorCanRun(user, assignment, action) {
  const supervisorAction = action === REPLENISH_FIELD_ACTIONS.APPROVE_EXCEPTION
    || action === REPLENISH_FIELD_ACTIONS.REJECT_EXCEPTION
  if (supervisorAction) {
    if (!isReplenishFieldSupervisor(user)) {
      throw new ReplenishFieldValidationError("Hanya supervisor Replenish yang dapat meninjau ketidaksesuaian.", 403)
    }
    return
  }

  if (action === REPLENISH_FIELD_ACTIONS.CONFIRM_DEPARTURE) {
    if (!isReplenishFieldDriver(user) || assignment?.member_role !== "PENGEMUDI") {
      throw new ReplenishFieldValidationError("Konfirmasi keberangkatan hanya dapat dilakukan Driver yang ditugaskan.", 403)
    }
    return
  }

  if (!isReplenishFieldCustody(user) || assignment?.member_role !== "CUSTODY") {
    throw new ReplenishFieldValidationError("Operasi scan hanya dapat dilakukan Custody yang ditugaskan.", 403)
  }
}

async function insertStatusHistory(executor, workOrderId, fromStatus, toStatus, action, userId, notes = null) {
  if (fromStatus === toStatus) return
  await new sql.Request(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("fromStatus", sql.VarChar(40), fromStatus)
    .input("toStatus", sql.VarChar(40), toStatus)
    .input("action", sql.VarChar(30), action.slice(0, 30))
    .input("notes", sql.NVarChar(1000), notes)
    .input("userId", sql.Int, userId)
    .query(`
      UPDATE dbo.replenish_work_orders
      SET status = @toStatus, updated_at = SYSDATETIME()
      WHERE id = @workOrderId AND status = @fromStatus;
      IF @@ROWCOUNT <> 1
        THROW 54720, 'Status Work Order berubah. Muat ulang job lapangan.', 1;

      INSERT INTO dbo.replenish_status_history
        (work_order_id, from_status, to_status, action, notes, actor_user_id)
      VALUES (@workOrderId, @fromStatus, @toStatus, @action, @notes, @userId);
    `)
}

async function assertCodesUnusedOnOtherPoints(executor, workOrderId, pointId, codes) {
  const result = await new sql.Request(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("pointId", sql.BigInt, pointId)
    .input("codesJson", sql.NVarChar(sql.MAX), JSON.stringify(codes))
    .query(`
      WITH submitted AS (
        SELECT code
        FROM OPENJSON(@codesJson) WITH (code VARCHAR(100) '$')
      ), used_codes AS (
        SELECT exchange.work_order_point_id, exchange.old_cassette_serial AS code
        FROM dbo.replenish_field_cassette_exchanges exchange WITH (UPDLOCK, HOLDLOCK)
        WHERE exchange.work_order_id = @workOrderId
        UNION ALL SELECT work_order_point_id, old_seal_no FROM dbo.replenish_field_cassette_exchanges WITH (UPDLOCK, HOLDLOCK) WHERE work_order_id = @workOrderId
        UNION ALL SELECT work_order_point_id, new_cassette_serial FROM dbo.replenish_field_cassette_exchanges WITH (UPDLOCK, HOLDLOCK) WHERE work_order_id = @workOrderId
        UNION ALL SELECT work_order_point_id, new_seal_no FROM dbo.replenish_field_cassette_exchanges WITH (UPDLOCK, HOLDLOCK) WHERE work_order_id = @workOrderId
        UNION ALL SELECT work_order_point_id, departure_bag_seal_no FROM dbo.replenish_field_point_checks WITH (UPDLOCK, HOLDLOCK) WHERE work_order_id = @workOrderId
        UNION ALL SELECT work_order_point_id, reject_cassette_serial FROM dbo.replenish_field_point_checks WITH (UPDLOCK, HOLDLOCK) WHERE work_order_id = @workOrderId
        UNION ALL SELECT work_order_point_id, reject_cassette_seal_no FROM dbo.replenish_field_point_checks WITH (UPDLOCK, HOLDLOCK) WHERE work_order_id = @workOrderId
        UNION ALL SELECT work_order_point_id, return_bag_seal_no FROM dbo.replenish_field_point_checks WITH (UPDLOCK, HOLDLOCK) WHERE work_order_id = @workOrderId
      )
      SELECT TOP (1) used.code
      FROM used_codes used
      INNER JOIN submitted ON submitted.code = used.code
      WHERE used.work_order_point_id <> @pointId
        AND used.code IS NOT NULL;
    `)
  const duplicate = result.recordset[0]?.code
  if (duplicate) {
    throw new ReplenishFieldValidationError(
      `Kode ${duplicate} sudah digunakan pada TID lain di Work Order ini.`,
      409,
      { code: "DUPLICATE_SCAN_CODE" }
    )
  }
}

async function savePointScan(executor, workOrderId, pointId, userId, scan, status) {
  await new sql.Request(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("pointId", sql.BigInt, pointId)
    .input("userId", sql.Int, userId)
    .input("status", sql.VarChar(30), status)
    .input("departureBag", sql.VarChar(100), scan.assets.departureBagSealNo)
    .input("rejectSerial", sql.VarChar(100), scan.assets.rejectCassetteSerial)
    .input("rejectSeal", sql.VarChar(100), scan.assets.rejectCassetteSealNo)
    .input("returnBag", sql.VarChar(100), scan.assets.returnBagSealNo)
    .input("cassettesJson", sql.NVarChar(sql.MAX), JSON.stringify(scan.cassettes))
    .query(`
      MERGE dbo.replenish_field_point_checks AS target
      USING (SELECT @pointId AS work_order_point_id) AS source
        ON target.work_order_point_id = source.work_order_point_id
      WHEN MATCHED THEN UPDATE SET
        departure_bag_seal_no = @departureBag,
        reject_cassette_serial = @rejectSerial,
        reject_cassette_seal_no = @rejectSeal,
        return_bag_seal_no = @returnBag,
        scan_status = @status,
        completed_by = CASE WHEN @status IN ('COMPLETE', 'COMPLETE_WITH_EXCEPTION') THEN @userId ELSE NULL END,
        completed_at = CASE WHEN @status IN ('COMPLETE', 'COMPLETE_WITH_EXCEPTION') THEN SYSDATETIME() ELSE NULL END,
        updated_at = SYSDATETIME()
      WHEN NOT MATCHED THEN INSERT (
        work_order_id, work_order_point_id, departure_bag_seal_no,
        reject_cassette_serial, reject_cassette_seal_no, return_bag_seal_no,
        scan_status, completed_by, completed_at
      ) VALUES (
        @workOrderId, @pointId, @departureBag,
        @rejectSerial, @rejectSeal, @returnBag,
        @status,
        CASE WHEN @status IN ('COMPLETE', 'COMPLETE_WITH_EXCEPTION') THEN @userId ELSE NULL END,
        CASE WHEN @status IN ('COMPLETE', 'COMPLETE_WITH_EXCEPTION') THEN SYSDATETIME() ELSE NULL END
      );

      MERGE dbo.replenish_field_cassette_exchanges AS target
      USING (
        SELECT cassette_no, old_cassette_serial, old_seal_no,
          new_cassette_serial, new_seal_no
        FROM OPENJSON(@cassettesJson)
        WITH (
          cassette_no SMALLINT '$.cassetteNo',
          old_cassette_serial VARCHAR(100) '$.oldCassetteSerial',
          old_seal_no VARCHAR(100) '$.oldSealNo',
          new_cassette_serial VARCHAR(100) '$.newCassetteSerial',
          new_seal_no VARCHAR(100) '$.newSealNo'
        )
      ) AS source
        ON target.work_order_point_id = @pointId
       AND target.cassette_no = source.cassette_no
      WHEN MATCHED THEN UPDATE SET
        old_cassette_serial = source.old_cassette_serial,
        old_seal_no = source.old_seal_no,
        new_cassette_serial = source.new_cassette_serial,
        new_seal_no = source.new_seal_no,
        scanned_by = @userId,
        scanned_at = SYSDATETIME(),
        updated_at = SYSDATETIME()
      WHEN NOT MATCHED THEN INSERT (
        work_order_id, work_order_point_id, cassette_no,
        old_cassette_serial, old_seal_no, new_cassette_serial, new_seal_no,
        scanned_by, scanned_at
      ) VALUES (
        @workOrderId, @pointId, source.cassette_no,
        source.old_cassette_serial, source.old_seal_no,
        source.new_cassette_serial, source.new_seal_no,
        @userId, SYSDATETIME()
      );
    `)
}

async function finishPointAndMaybeWorkOrder(executor, workOrder, pointId, userId, pointStatus) {
  const result = await new sql.Request(executor)
    .input("workOrderId", sql.BigInt, workOrder.id)
    .input("pointId", sql.BigInt, pointId)
    .input("pointStatus", sql.VarChar(40), pointStatus)
    .query(`
      UPDATE dbo.replenish_work_order_points
      SET status = @pointStatus, updated_at = SYSDATETIME()
      WHERE id = @pointId
        AND work_order_id = @workOrderId
        AND status = 'DALAM_PROSES';
      IF @@ROWCOUNT <> 1
        THROW 54721, 'Status TID berubah. Muat ulang job lapangan.', 1;

      SELECT
        COUNT_BIG(*) AS total_points,
        SUM(CASE WHEN status IN ('BERHASIL', 'BERHASIL_DENGAN_CATATAN') THEN 1 ELSE 0 END) AS completed_points
      FROM dbo.replenish_work_order_points WITH (UPDLOCK, HOLDLOCK)
      WHERE work_order_id = @workOrderId;
    `)
  const progress = result.recordset[0]
  if (Number(progress?.total_points) > 0 && Number(progress?.total_points) === Number(progress?.completed_points)) {
    await insertStatusHistory(
      executor,
      workOrder.id,
      workOrder.status,
      "SELESAI_DI_LOKASI",
      "FIELD_POINTS_DONE",
      userId,
      "Seluruh TID lapangan telah diselesaikan."
    )
    workOrder.status = "SELESAI_DI_LOKASI"
  }
}

async function createFieldEvent(executor, event, workOrderId, userId, payloadHash, payloadJson) {
  const result = await new sql.Request(executor)
    .input("clientEventId", sql.UniqueIdentifier, event.clientEventId)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("pointId", sql.BigInt, event.pointId)
    .input("action", sql.VarChar(40), event.action)
    .input("userId", sql.Int, userId)
    .input("recordedAt", sql.DateTime2(0), event.recordedAt)
    .input("latitude", sql.Decimal(9, 6), event.location?.latitude ?? null)
    .input("longitude", sql.Decimal(9, 6), event.location?.longitude ?? null)
    .input("accuracy", sql.Decimal(9, 2), event.location?.accuracy ?? null)
    .input("offline", sql.Bit, event.offlineCreated ? 1 : 0)
    .input("payloadHash", sql.Char(64), payloadHash)
    .input("payloadJson", sql.NVarChar(sql.MAX), payloadJson)
    .query(`
      INSERT INTO dbo.replenish_field_events (
        client_event_id, work_order_id, work_order_point_id, action,
        actor_user_id, device_recorded_at, latitude, longitude, accuracy_m,
        offline_created, payload_hash, payload_json
      )
      OUTPUT INSERTED.id
      VALUES (
        @clientEventId, @workOrderId, @pointId, @action,
        @userId, @recordedAt, @latitude, @longitude, @accuracy,
        @offline, @payloadHash, @payloadJson
      );
    `)
  return Number(result.recordset[0]?.id)
}

async function runAction(executor, { event, workOrderId, user, context, eventId, preparedEvidence, onEvidenceSaved }) {
  const { action } = event
  const point = context.point
  const workOrder = context.workOrder
  const userId = Number(user.id)

  if (action === REPLENISH_FIELD_ACTIONS.CONFIRM_DEPARTURE) {
    if (workOrder.status !== "SIAP_BERANGKAT") {
      throw new ReplenishFieldValidationError("Driver hanya dapat mengonfirmasi job yang siap berangkat.", 409)
    }
    const previous = await new sql.Request(executor)
      .input("workOrderId", sql.BigInt, workOrderId)
      .input("eventId", sql.BigInt, eventId)
      .query(`
        SELECT TOP (1) id
        FROM dbo.replenish_field_events WITH (UPDLOCK, HOLDLOCK)
        WHERE work_order_id = @workOrderId
          AND action = 'CONFIRM_DEPARTURE'
          AND id <> @eventId;
      `)
    if (previous.recordset.length) {
      throw new ReplenishFieldValidationError("Keberangkatan sudah dikonfirmasi Driver.", 409)
    }
    return { message: "Keberangkatan dikonfirmasi Driver.", event_id: eventId }
  }

  if (action === REPLENISH_FIELD_ACTIONS.START_TRIP) {
    if (workOrder.status !== "SIAP_BERANGKAT") {
      throw new ReplenishFieldValidationError("Job belum siap berangkat atau perjalanan sudah dimulai.", 409)
    }
    await insertStatusHistory(executor, workOrderId, workOrder.status, "DALAM_PERJALANAN", "FIELD_START_TRIP", userId)
    await new sql.Request(executor)
      .input("workOrderId", sql.BigInt, workOrderId)
      .query(`
        UPDATE dbo.replenish_work_order_points
        SET status = 'DALAM_PERJALANAN', updated_at = SYSDATETIME()
        WHERE work_order_id = @workOrderId AND status = 'TERJADWAL';
      `)
    return { message: "Perjalanan menuju lokasi dimulai.", event_id: eventId }
  }

  if (action === REPLENISH_FIELD_ACTIONS.ARRIVE_POINT) {
    if (!point || !["TERJADWAL", "DALAM_PERJALANAN"].includes(point.status)) {
      throw new ReplenishFieldValidationError("TID tidak berada pada status perjalanan.", 409)
    }
    await new sql.Request(executor)
      .input("pointId", sql.BigInt, point.id)
      .query(`UPDATE dbo.replenish_work_order_points SET status = 'TIBA', updated_at = SYSDATETIME() WHERE id = @pointId;`)
    if (["SIAP_BERANGKAT", "BERANGKAT", "DALAM_PERJALANAN"].includes(workOrder.status)) {
      await insertStatusHistory(executor, workOrderId, workOrder.status, "TIBA_DI_LOKASI", "FIELD_ARRIVE", userId, `Tiba di TID ${point.tid}.`)
    }
    return { message: `Tiba di TID ${point.tid}.`, event_id: eventId }
  }

  if (action === REPLENISH_FIELD_ACTIONS.START_POINT) {
    if (!point || point.status !== "TIBA") {
      throw new ReplenishFieldValidationError("TID harus berstatus Tiba sebelum proses scan dimulai.", 409)
    }
    await new sql.Request(executor)
      .input("pointId", sql.BigInt, point.id)
      .query(`UPDATE dbo.replenish_work_order_points SET status = 'DALAM_PROSES', updated_at = SYSDATETIME() WHERE id = @pointId;`)
    if (["SIAP_BERANGKAT", "BERANGKAT", "DALAM_PERJALANAN", "TIBA_DI_LOKASI"].includes(workOrder.status)) {
      await insertStatusHistory(executor, workOrderId, workOrder.status, "DALAM_PROSES_REPLENISH", "FIELD_START_POINT", userId, `Mulai proses TID ${point.tid}.`)
    }
    return { message: `Scan TID ${point.tid} dimulai.`, event_id: eventId }
  }

  if (action === REPLENISH_FIELD_ACTIONS.COMPLETE_POINT || action === REPLENISH_FIELD_ACTIONS.REPORT_EXCEPTION) {
    if (!point || point.status !== "DALAM_PROSES") {
      throw new ReplenishFieldValidationError("TID belum berada dalam proses scan.", 409)
    }
    if (!context.assets) {
      throw new ReplenishFieldValidationError("Data perlengkapan packing CPC untuk TID ini belum tersedia.", 409)
    }
    const scan = normalizePointScan(event.payload?.scan, context.cassettes.length)
    const expected = { cassettes: context.cassettes, ...context.assets }
    const mismatches = comparePointScan(scan, expected)
    await assertCodesUnusedOnOtherPoints(executor, workOrderId, point.id, scan.codes)

    if (action === REPLENISH_FIELD_ACTIONS.COMPLETE_POINT) {
      if (mismatches.length) {
        throw new ReplenishFieldValidationError(
          "Hasil scan tidak sesuai packing CPC. Gunakan Laporkan Ketidaksesuaian.",
          409,
          { code: "SCAN_MISMATCH", mismatches }
        )
      }
      await savePointScan(executor, workOrderId, point.id, userId, scan, "COMPLETE")
      await finishPointAndMaybeWorkOrder(executor, workOrder, point.id, userId, "BERHASIL")
      return { message: `TID ${point.tid} berhasil diselesaikan.`, event_id: eventId }
    }

    if (!mismatches.length) {
      throw new ReplenishFieldValidationError("Tidak ditemukan ketidaksesuaian antara hasil scan dan packing CPC.")
    }
    const reason = normalizeReason(event.payload?.reason, { required: true })
    if (!preparedEvidence) {
      throw new ReplenishFieldValidationError("Foto bukti wajib dilampirkan untuk ketidaksesuaian.")
    }
    const pending = await new sql.Request(executor)
      .input("pointId", sql.BigInt, point.id)
      .query(`
        SELECT TOP (1) id FROM dbo.replenish_field_exceptions WITH (UPDLOCK, HOLDLOCK)
        WHERE work_order_point_id = @pointId AND status = 'MENUNGGU_REVIEW';
      `)
    if (pending.recordset.length) {
      throw new ReplenishFieldValidationError("TID masih mempunyai ketidaksesuaian yang menunggu review.", 409)
    }

    await savePointScan(executor, workOrderId, point.id, userId, scan, "EXCEPTION_PENDING")
    const exceptionResult = await new sql.Request(executor)
      .input("workOrderId", sql.BigInt, workOrderId)
      .input("pointId", sql.BigInt, point.id)
      .input("eventId", sql.BigInt, eventId)
      .input("reason", sql.NVarChar(1000), reason)
      .input("mismatches", sql.NVarChar(sql.MAX), JSON.stringify(mismatches))
      .input("userId", sql.Int, userId)
      .query(`
        INSERT INTO dbo.replenish_field_exceptions (
          work_order_id, work_order_point_id, source_event_id,
          exception_type, reason, mismatch_json, reported_by
        )
        OUTPUT INSERTED.id
        VALUES (@workOrderId, @pointId, @eventId, 'SCAN_MISMATCH', @reason, @mismatches, @userId);
      `)
    const exceptionId = Number(exceptionResult.recordset[0]?.id)
    const storedFileName = await saveFieldEvidence(preparedEvidence)
    onEvidenceSaved(storedFileName)
    await new sql.Request(executor)
      .input("exceptionId", sql.BigInt, exceptionId)
      .input("storedFileName", sql.VarChar(180), storedFileName)
      .input("originalFileName", sql.NVarChar(255), preparedEvidence.originalName)
      .input("mimeType", sql.VarChar(50), preparedEvidence.mimeType)
      .input("fileSize", sql.Int, preparedEvidence.size)
      .input("sha256", sql.Char(64), preparedEvidence.sha256)
      .input("userId", sql.Int, userId)
      .query(`
        INSERT INTO dbo.replenish_field_exception_evidence (
          exception_id, stored_file_name, original_file_name,
          mime_type, file_size, sha256, created_by
        ) VALUES (
          @exceptionId, @storedFileName, @originalFileName,
          @mimeType, @fileSize, @sha256, @userId
        );
      `)
    return {
      message: "Ketidaksesuaian dikirim ke supervisor.",
      event_id: eventId,
      exception_id: exceptionId,
      stored_file_name: storedFileName,
    }
  }

  if (action === REPLENISH_FIELD_ACTIONS.APPROVE_EXCEPTION || action === REPLENISH_FIELD_ACTIONS.REJECT_EXCEPTION) {
    const exceptionId = normalizeId(event.payload?.exception_id)
    if (!exceptionId) throw new ReplenishFieldValidationError("ID ketidaksesuaian tidak valid.")
    const reviewNotes = normalizeReason(event.payload?.notes, {
      required: action === REPLENISH_FIELD_ACTIONS.REJECT_EXCEPTION,
    })
    const exceptionResult = await new sql.Request(executor)
      .input("exceptionId", sql.BigInt, exceptionId)
      .input("workOrderId", sql.BigInt, workOrderId)
      .query(`
        SELECT TOP (1)
          exception.id, exception.work_order_point_id, exception.status,
          CASE WHEN evidence.id IS NULL THEN 0 ELSE 1 END AS has_evidence
        FROM dbo.replenish_field_exceptions exception WITH (UPDLOCK, HOLDLOCK)
        LEFT JOIN dbo.replenish_field_exception_evidence evidence ON evidence.exception_id = exception.id
        WHERE exception.id = @exceptionId AND exception.work_order_id = @workOrderId;
      `)
    const exception = exceptionResult.recordset[0]
    if (!exception || exception.status !== "MENUNGGU_REVIEW") {
      throw new ReplenishFieldValidationError("Ketidaksesuaian sudah ditinjau atau tidak ditemukan.", 409)
    }
    if (Number(exception.work_order_point_id) !== Number(event.pointId)) {
      throw new ReplenishFieldValidationError("TID event tidak sesuai dengan ketidaksesuaian yang ditinjau.", 409)
    }
    if (!exception.has_evidence) {
      throw new ReplenishFieldValidationError("Ketidaksesuaian belum mempunyai foto bukti.", 409)
    }

    const approved = action === REPLENISH_FIELD_ACTIONS.APPROVE_EXCEPTION
    await new sql.Request(executor)
      .input("exceptionId", sql.BigInt, exceptionId)
      .input("status", sql.VarChar(30), approved ? "DISETUJUI" : "DITOLAK")
      .input("reviewNotes", sql.NVarChar(1000), reviewNotes)
      .input("userId", sql.Int, userId)
      .input("pointId", sql.BigInt, exception.work_order_point_id)
      .query(`
        UPDATE dbo.replenish_field_exceptions
        SET status = @status, reviewed_by = @userId,
          reviewed_at = SYSDATETIME(), review_notes = @reviewNotes
        WHERE id = @exceptionId AND status = 'MENUNGGU_REVIEW';

        UPDATE dbo.replenish_field_point_checks
        SET scan_status = CASE WHEN @status = 'DISETUJUI' THEN 'COMPLETE_WITH_EXCEPTION' ELSE 'DRAFT' END,
          completed_by = CASE WHEN @status = 'DISETUJUI' THEN @userId ELSE NULL END,
          completed_at = CASE WHEN @status = 'DISETUJUI' THEN SYSDATETIME() ELSE NULL END,
          updated_at = SYSDATETIME()
        WHERE work_order_point_id = @pointId;
      `)
    if (approved) {
      const reviewedPoint = { id: Number(exception.work_order_point_id) }
      await finishPointAndMaybeWorkOrder(executor, workOrder, reviewedPoint.id, userId, "BERHASIL_DENGAN_CATATAN")
    }
    return {
      message: approved ? "Ketidaksesuaian disetujui." : "Ketidaksesuaian ditolak dan dikembalikan ke Custody.",
      event_id: eventId,
      exception_id: exceptionId,
    }
  }

  if (action === REPLENISH_FIELD_ACTIONS.START_RETURN) {
    if (!["SELESAI_DI_LOKASI", "BERHASIL_SEBAGIAN"].includes(workOrder.status)) {
      throw new ReplenishFieldValidationError("Seluruh TID harus selesai sebelum perjalanan kembali.", 409)
    }
    await insertStatusHistory(executor, workOrderId, workOrder.status, "DALAM_PERJALANAN_KEMBALI", "FIELD_START_RETURN", userId)
    return { message: "Perjalanan kembali ke kantor dimulai.", event_id: eventId }
  }

  if (action === REPLENISH_FIELD_ACTIONS.ARRIVE_OFFICE) {
    if (workOrder.status !== "DALAM_PERJALANAN_KEMBALI") {
      throw new ReplenishFieldValidationError("Job belum berada dalam perjalanan kembali.", 409)
    }
    await insertStatusHistory(executor, workOrderId, workOrder.status, "TIBA_DI_KANTOR", "FIELD_ARRIVE_OFFICE", userId)
    return { message: "Tim tiba kembali di kantor.", event_id: eventId }
  }

  throw new ReplenishFieldValidationError("Aksi lapangan belum didukung.")
}

export async function POST(request, routeContext) {
  const authorization = await authorizeApiRequest(request, REPLENISH_FIELD_MENU_HREF, "update")
  if (!authorization.authorized) return authorization.response
  const { id } = await routeContext.params
  const workOrderId = normalizeId(id)
  if (!workOrderId) return errorResponse("ID work order tidak valid.")

  let rawBody
  try {
    rawBody = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return errorResponse("Event lapangan terlalu besar.", 413)
    if (error instanceof InvalidJsonBodyError) return errorResponse(error.message)
    throw error
  }

  let event
  let preparedEvidence = null
  try {
    event = normalizeFieldEvent(rawBody)
    if (GPS_ACTIONS.has(event.action)) requireFieldLocation(event)
    if (event.action === REPLENISH_FIELD_ACTIONS.REPORT_EXCEPTION) {
      const prepared = prepareFieldEvidence(event.payload?.evidence)
      if (prepared.error) throw new ReplenishFieldValidationError(prepared.error)
      preparedEvidence = prepared.data
    }
  } catch (error) {
    if (error instanceof ReplenishFieldValidationError) {
      return errorResponse(error.message, error.status, error.extra)
    }
    throw error
  }

  const payload = auditPayload(event, preparedEvidence)
  const payloadJson = JSON.stringify(payload)
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({
      workOrderId,
      action: event.action,
      pointId: event.pointId,
      recordedAt: event.recordedAt.toISOString(),
      location: event.location,
      payload,
    }))
    .digest("hex")
  const scope = getUserDataScope(authorization.user)
  const db = await connectDB()
  let storedFileName = null

  try {
    const result = await runInTransaction(db, async (transaction) => {
      await acquireWorkOrderLock(transaction, workOrderId)
      const replay = await new sql.Request(transaction)
        .input("clientEventId", sql.UniqueIdentifier, event.clientEventId)
        .query(`
          SELECT TOP (1) payload_hash, response_json
          FROM dbo.replenish_field_events WITH (UPDLOCK, HOLDLOCK)
          WHERE client_event_id = @clientEventId;
        `)
      if (replay.recordset[0]) {
        if (replay.recordset[0].payload_hash !== payloadHash) {
          throw new ReplenishFieldValidationError("ID event sudah digunakan dengan payload berbeda.", 409)
        }
        return {
          replayed: true,
          result: replay.recordset[0].response_json
            ? JSON.parse(replay.recordset[0].response_json)
            : { message: "Event sebelumnya sudah diproses." },
        }
      }

      const context = await getLockedContext(
        transaction,
        workOrderId,
        event.pointId,
        authorization.user.pegawai_id,
        scope.isSuperAdmin ? null : scope.codeUker
      )
      if (!context.workOrder) throw new ReplenishFieldValidationError("Work Order tidak ditemukan.", 404)
      assertActorCanRun(authorization.user, context.assignment, event.action)
      if (event.pointId && !context.point) {
        throw new ReplenishFieldValidationError("TID tidak termasuk dalam Work Order ini.", 404)
      }

      const eventId = await createFieldEvent(
        transaction,
        event,
        workOrderId,
        authorization.user.id,
        payloadHash,
        payloadJson
      )
      const actionResult = await runAction(transaction, {
        event,
        workOrderId,
        user: authorization.user,
        context,
        eventId,
        preparedEvidence,
        onEvidenceSaved(fileName) {
          storedFileName = fileName
        },
      })
      const response = { ...actionResult }
      delete response.stored_file_name

      await new sql.Request(transaction)
        .input("eventId", sql.BigInt, eventId)
        .input("responseJson", sql.NVarChar(sql.MAX), JSON.stringify(response))
        .query(`UPDATE dbo.replenish_field_events SET response_json = @responseJson WHERE id = @eventId;`)
      await insertAuditLog(transaction, {
        request,
        userId: authorization.user.id,
        action: event.action,
        module: "replenish-field",
        entityType: "replenish_work_order",
        entityId: workOrderId,
        metadata: {
          client_event_id: event.clientEventId,
          point_id: event.pointId,
          offline_created: event.offlineCreated,
          exception_id: response.exception_id || null,
        },
      })
      return { replayed: false, result: response }
    }, { maxRetries: 0 })

    const snapshot = attachCapabilities(await getReplenishFieldSnapshot(
      db,
      workOrderId,
      scope.isSuperAdmin ? null : scope.codeUker
    ), authorization.user)
    return NextResponse.json({
      success: true,
      replayed: result.replayed,
      message: result.result.message,
      data: { result: result.result, snapshot },
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (storedFileName) {
      try { await deleteFieldEvidence(storedFileName) } catch (cleanupError) {
        console.error("Gagal membersihkan bukti lapangan setelah rollback.", cleanupError)
      }
    }
    if (error instanceof ReplenishFieldValidationError) {
      return errorResponse(error.message, error.status, error.extra)
    }
    const number = Number(error?.number || error?.originalError?.info?.number || 0)
    if (isRetryableSqlError(error) || number === 54720 || number === 54721) {
      return errorResponse(
        number === 54720 || number === 54721
          ? "Status job berubah. Muat ulang data sebelum melanjutkan."
          : "Job sedang diproses perangkat lain. Coba kembali.",
        number === 54720 || number === 54721 ? 409 : 503
      )
    }
    console.error("Gagal menyinkronkan event Replenish Lapangan.", error)
    return errorResponse("Gagal menyinkronkan event Replenish Lapangan.", 500)
  }
}
