import "server-only"

import { sql } from "@/lib/mssql"

function request(executor) {
  return new sql.Request(executor)
}

export async function listReplenishFieldJobs(executor, user, scopeCodeUker, { supervisor = false } = {}) {
  const result = await request(executor)
    .input("userEmployeeId", sql.BigInt, user?.pegawai_id || null)
    .input("scopeCodeUker", sql.NVarChar(4), scopeCodeUker || null)
    .input("supervisor", sql.Bit, supervisor ? 1 : 0)
    .query(`
      SELECT TOP (100)
        wo.id,
        wo.work_order_no,
        wo.status,
        wo.priority,
        CONVERT(CHAR(10), wo.schedule_date, 23) AS schedule_date,
        CONVERT(CHAR(5), wo.departure_time, 108) AS departure_time,
        CONVERT(CHAR(5), wo.estimated_finish_time, 108) AS estimated_finish_time,
        mu.codeuker,
        mu.nama_uker,
        CONCAT(vehicle.nomor_kendaraan, ' · ', vehicle.merk_kendaraan) AS vehicle_label,
        team.member_role AS my_team_role,
        wo.total_points,
        progress.completed_points,
        progress.exception_points,
        progress.pending_exceptions,
        CONVERT(CHAR(19), progress.last_field_event_at, 126) AS last_field_event_at
      FROM dbo.replenish_work_orders wo
      INNER JOIN dbo.master_uker mu ON mu.id = wo.uker_id
      INNER JOIN dbo.master_kendaraan vehicle ON vehicle.id = wo.vehicle_id
      OUTER APPLY (
        SELECT TOP (1) member.member_role
        FROM dbo.replenish_team_members member
        WHERE member.work_order_id = wo.id
          AND member.employee_id = @userEmployeeId
      ) team
      OUTER APPLY (
        SELECT
          SUM(CASE WHEN point.status IN ('BERHASIL', 'BERHASIL_DENGAN_CATATAN') THEN 1 ELSE 0 END) AS completed_points,
          SUM(CASE WHEN point.status = 'BERHASIL_DENGAN_CATATAN' THEN 1 ELSE 0 END) AS exception_points,
          (
            SELECT COUNT_BIG(*)
            FROM dbo.replenish_field_exceptions exception
            WHERE exception.work_order_id = wo.id
              AND exception.status = 'MENUNGGU_REVIEW'
          ) AS pending_exceptions,
          (
            SELECT MAX(event.server_recorded_at)
            FROM dbo.replenish_field_events event
            WHERE event.work_order_id = wo.id
          ) AS last_field_event_at
        FROM dbo.replenish_work_order_points point
        WHERE point.work_order_id = wo.id
      ) progress
      WHERE (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker)
        AND (
          (@supervisor = 1 AND EXISTS (
            SELECT 1 FROM dbo.replenish_field_exceptions queue
            WHERE queue.work_order_id = wo.id AND queue.status = 'MENUNGGU_REVIEW'
          ))
          OR (@supervisor = 0 AND team.member_role IS NOT NULL)
        )
        AND wo.status IN (
          'SIAP_BERANGKAT', 'BERANGKAT', 'DALAM_PERJALANAN',
          'TIBA_DI_LOKASI', 'MENUNGGU_KODE_KOMBINASI',
          'DALAM_PROSES_REPLENISH', 'SELESAI_DI_LOKASI',
          'BERHASIL_SEBAGIAN', 'GAGAL', 'DALAM_PERJALANAN_KEMBALI',
          'TIBA_DI_KANTOR'
        )
      ORDER BY
        CASE WHEN progress.pending_exceptions > 0 THEN 0 ELSE 1 END,
        CASE WHEN wo.schedule_date = CAST(GETDATE() AS DATE) THEN 0 ELSE 1 END,
        wo.schedule_date DESC,
        wo.id DESC;
    `)

  return result.recordset.map((item) => ({
    ...item,
    id: Number(item.id),
    total_points: Number(item.total_points || 0),
    completed_points: Number(item.completed_points || 0),
    exception_points: Number(item.exception_points || 0),
    pending_exceptions: Number(item.pending_exceptions || 0),
  }))
}

export async function getReplenishFieldSnapshot(executor, workOrderId, scopeCodeUker = null) {
  const result = await request(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("scopeCodeUker", sql.NVarChar(4), scopeCodeUker)
    .query(`
      SELECT TOP (1)
        wo.id,
        wo.work_order_no,
        wo.status,
        wo.priority,
        wo.activity_type,
        CONVERT(CHAR(10), wo.schedule_date, 23) AS schedule_date,
        CONVERT(CHAR(5), wo.departure_time, 108) AS departure_time,
        CONVERT(CHAR(5), wo.estimated_finish_time, 108) AS estimated_finish_time,
        wo.route_notes,
        wo.notes,
        mu.codeuker,
        mu.nama_uker,
        CONCAT(vehicle.nomor_kendaraan, ' · ', vehicle.merk_kendaraan) AS vehicle_label
      FROM dbo.replenish_work_orders wo
      INNER JOIN dbo.master_uker mu ON mu.id = wo.uker_id
      INNER JOIN dbo.master_kendaraan vehicle ON vehicle.id = wo.vehicle_id
      WHERE wo.id = @workOrderId
        AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker);

      SELECT
        member.member_role,
        member.is_lead,
        employee.id AS employee_id,
        employee.nip,
        employee.nama,
        employee.jabatan
      FROM dbo.replenish_team_members member
      INNER JOIN dbo.pegawai employee ON employee.id = member.employee_id
      WHERE member.work_order_id = @workOrderId
      ORDER BY member.member_role;

      SELECT
        point.id,
        point.sequence_no,
        point.activity_type,
        point.status,
        point.requested_amount,
        point.notes,
        machine.tid,
        machine.sn,
        machine.lokasi,
        machine.kategori_mesin,
        machine.denom,
        check_data.scan_status,
        check_data.departure_bag_seal_no AS scanned_departure_bag_seal_no,
        check_data.reject_cassette_serial AS scanned_reject_cassette_serial,
        check_data.reject_cassette_seal_no AS scanned_reject_cassette_seal_no,
        check_data.return_bag_seal_no AS scanned_return_bag_seal_no,
        expected_asset.reject_cassette_serial,
        expected_asset.reject_cassette_seal_no,
        expected_asset.departure_bag_seal_no,
        expected_asset.return_bag_seal_no,
        pending.pending_exception_id
      FROM dbo.replenish_work_order_points point
      INNER JOIN dbo.master_mesin machine ON machine.id = point.machine_id
      LEFT JOIN dbo.replenish_field_point_checks check_data
        ON check_data.work_order_point_id = point.id
      LEFT JOIN dbo.cpc_packing_tid_assets expected_asset
        ON expected_asset.work_order_point_id = point.id
      OUTER APPLY (
        SELECT TOP (1) exception.id AS pending_exception_id
        FROM dbo.replenish_field_exceptions exception
        WHERE exception.work_order_point_id = point.id
          AND exception.status = 'MENUNGGU_REVIEW'
        ORDER BY exception.id DESC
      ) pending
      WHERE point.work_order_id = @workOrderId
      ORDER BY point.sequence_no;

      SELECT
        cassette.work_order_point_id,
        cassette.cassette_no,
        cassette.cassette_serial,
        cassette.seal_no,
        cassette.denomination_value,
        cassette.sheets_count,
        exchange.old_cassette_serial,
        exchange.old_seal_no,
        exchange.new_cassette_serial,
        exchange.new_seal_no
      FROM dbo.cpc_packing_cassettes cassette
      INNER JOIN dbo.replenish_work_order_points point
        ON point.id = cassette.work_order_point_id
      LEFT JOIN dbo.replenish_field_cassette_exchanges exchange
        ON exchange.work_order_point_id = cassette.work_order_point_id
       AND exchange.cassette_no = cassette.cassette_no
      WHERE point.work_order_id = @workOrderId
      ORDER BY point.sequence_no, cassette.cassette_no;

      SELECT
        exception.id,
        exception.work_order_point_id,
        exception.exception_type,
        exception.reason,
        exception.mismatch_json,
        exception.status,
        reporter.full_name AS reported_by_name,
        CONVERT(CHAR(19), exception.reported_at, 126) AS reported_at,
        reviewer.full_name AS reviewed_by_name,
        CONVERT(CHAR(19), exception.reviewed_at, 126) AS reviewed_at,
        exception.review_notes,
        evidence.id AS evidence_id,
        evidence.mime_type AS evidence_mime_type
      FROM dbo.replenish_field_exceptions exception
      INNER JOIN dbo.users reporter ON reporter.id = exception.reported_by
      LEFT JOIN dbo.users reviewer ON reviewer.id = exception.reviewed_by
      LEFT JOIN dbo.replenish_field_exception_evidence evidence
        ON evidence.exception_id = exception.id
      WHERE exception.work_order_id = @workOrderId
      ORDER BY exception.id DESC;

      SELECT TOP (100)
        event.id,
        event.action,
        event.work_order_point_id,
        actor.full_name AS actor_name,
        CONVERT(CHAR(19), event.device_recorded_at, 126) AS device_recorded_at,
        CONVERT(CHAR(19), event.server_recorded_at, 126) AS server_recorded_at,
        event.latitude,
        event.longitude,
        event.accuracy_m,
        event.offline_created
      FROM dbo.replenish_field_events event
      INNER JOIN dbo.users actor ON actor.id = event.actor_user_id
      WHERE event.work_order_id = @workOrderId
      ORDER BY event.id DESC;
    `)

  const workOrder = result.recordsets?.[0]?.[0] || null
  if (!workOrder) return null

  const cassettesByPoint = new Map()
  for (const cassette of result.recordsets?.[3] || []) {
    const pointId = Number(cassette.work_order_point_id)
    const current = cassettesByPoint.get(pointId) || []
    current.push({
      ...cassette,
      work_order_point_id: pointId,
      cassette_no: Number(cassette.cassette_no),
      denomination_value: Number(cassette.denomination_value || 0),
      sheets_count: Number(cassette.sheets_count || 0),
    })
    cassettesByPoint.set(pointId, current)
  }

  return {
    work_order: { ...workOrder, id: Number(workOrder.id) },
    team: (result.recordsets?.[1] || []).map((member) => ({
      ...member,
      employee_id: Number(member.employee_id),
      is_lead: Boolean(member.is_lead),
    })),
    points: (result.recordsets?.[2] || []).map((point) => ({
      ...point,
      id: Number(point.id),
      sequence_no: Number(point.sequence_no),
      requested_amount: Number(point.requested_amount || 0),
      pending_exception_id: Number(point.pending_exception_id || 0) || null,
      cassettes: cassettesByPoint.get(Number(point.id)) || [],
    })),
    exceptions: (result.recordsets?.[4] || []).map((item) => ({
      ...item,
      id: Number(item.id),
      work_order_point_id: Number(item.work_order_point_id),
      evidence_id: Number(item.evidence_id || 0) || null,
      mismatches: (() => {
        try { return item.mismatch_json ? JSON.parse(item.mismatch_json) : [] } catch { return [] }
      })(),
      mismatch_json: undefined,
    })),
    events: (result.recordsets?.[5] || []).map((item) => ({
      ...item,
      id: Number(item.id),
      work_order_point_id: Number(item.work_order_point_id || 0) || null,
      latitude: item.latitude === null ? null : Number(item.latitude),
      longitude: item.longitude === null ? null : Number(item.longitude),
      accuracy_m: item.accuracy_m === null ? null : Number(item.accuracy_m),
      offline_created: Boolean(item.offline_created),
    })),
  }
}

export async function getFieldAssignment(executor, workOrderId, employeeId) {
  if (!employeeId) return null
  const result = await request(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("employeeId", sql.BigInt, employeeId)
    .query(`
      SELECT TOP (1) member.member_role, member.employee_id
      FROM dbo.replenish_team_members member
      WHERE member.work_order_id = @workOrderId
        AND member.employee_id = @employeeId;
    `)
  return result.recordset[0] || null
}
