import "server-only"

import { sql } from "@/lib/mssql"
import { normalizeRowVersionToken } from "@/modules/master-mesin/row-version"
import {
  calculateRequestedAmount as calculateRequestedAmountFromPoints,
  materializeReplenishPoints,
} from "@/modules/replenish/calculation"

function createRequest(executor) {
  return new sql.Request(executor)
}

export async function resolveReplenishUker(executor, scope, requestedUkerId) {
  const request = createRequest(executor)

  if (scope.isSuperAdmin) {
    if (!requestedUkerId) {
      return { uker: null, error: "Unit kerja wajib dipilih." }
    }

    request.input("ukerId", sql.BigInt, requestedUkerId)
    const result = await request.query(`
      SELECT TOP 1 id, codeuker, nama_uker
      FROM dbo.master_uker
      WHERE id = @ukerId;
    `)

    return {
      uker: result.recordset[0] || null,
      error: result.recordset[0] ? null : "Unit kerja tidak ditemukan.",
    }
  }

  if (!scope.codeUker) {
    return { uker: null, error: "Unit kerja pengguna belum terhubung." }
  }

  request.input("codeUker", sql.NVarChar(4), scope.codeUker)
  const result = await request.query(`
    SELECT TOP 1 id, codeuker, nama_uker
    FROM dbo.master_uker
    WHERE codeuker = @codeUker;
  `)

  return {
    uker: result.recordset[0] || null,
    error: result.recordset[0]
      ? null
      : "Unit kerja akun tidak ditemukan pada master unit kerja.",
  }
}

export async function validateReplenishReferences(
  executor,
  data,
  ukerId,
  ignoredWorkOrderId = null
) {
  const machineIdsJson = JSON.stringify(data.points.map((point) => point.machineId))
  const result = await createRequest(executor)
    .input("ukerId", sql.BigInt, ukerId)
    .input("scheduleDate", sql.Date, data.scheduleDate)
    .input("vehicleId", sql.BigInt, data.vehicleId)
    .input("custodyId", sql.BigInt, data.custodyId)
    .input("driverId", sql.BigInt, data.driverId)
    .input("ignoredWorkOrderId", sql.BigInt, ignoredWorkOrderId)
    .input("machineIdsJson", sql.NVarChar(sql.MAX), machineIdsJson)
    .query(`
      SET NOCOUNT ON;

      DECLARE @resources TABLE (resource_name NVARCHAR(255) NOT NULL PRIMARY KEY);
      INSERT INTO @resources(resource_name)
      VALUES
        (CONCAT('replenish:', CONVERT(CHAR(8), @scheduleDate, 112), ':employee:', @custodyId)),
        (CONCAT('replenish:', CONVERT(CHAR(8), @scheduleDate, 112), ':employee:', @driverId)),
        (CONCAT('replenish:', CONVERT(CHAR(8), @scheduleDate, 112), ':vehicle:', @vehicleId));

      DECLARE @resourceName NVARCHAR(255);
      DECLARE @lockResult INT;
      DECLARE resource_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT resource_name FROM @resources ORDER BY resource_name;
      OPEN resource_cursor;
      FETCH NEXT FROM resource_cursor INTO @resourceName;
      WHILE @@FETCH_STATUS = 0
      BEGIN
        EXEC @lockResult = sys.sp_getapplock
          @Resource = @resourceName,
          @LockMode = 'Exclusive',
          @LockOwner = 'Transaction',
          @LockTimeout = 5000;
        IF @lockResult < 0
        BEGIN
          CLOSE resource_cursor;
          DEALLOCATE resource_cursor;
          THROW 52710, 'Sumber daya jadwal sedang diproses transaksi lain. Coba kembali.', 1;
        END;
        FETCH NEXT FROM resource_cursor INTO @resourceName;
      END;
      CLOSE resource_cursor;
      DEALLOCATE resource_cursor;

      SELECT TOP (1)
        k.id, k.nomor_kendaraan, k.merk_kendaraan, k.jenis_kendaraan, k.status
      FROM dbo.master_kendaraan k
      WHERE k.id = @vehicleId
        AND k.uker_id = @ukerId
        AND k.status = 'AKTIF'
        AND UPPER(LTRIM(RTRIM(k.jenis_kendaraan))) = 'MOBIL';

      SELECT
        p.id, p.nip, p.nama, p.jabatan,
        CASE WHEN p.id = @custodyId THEN 'CUSTODY'
             WHEN p.id = @driverId THEN 'DRIVER' END AS selected_team_role
      FROM dbo.pegawai p
      WHERE p.uker_id = @ukerId
        AND p.status = 1
        AND ((p.id = @custodyId AND UPPER(LTRIM(RTRIM(ISNULL(p.jabatan, '')))) = 'CUSTODY')
          OR (p.id = @driverId AND UPPER(LTRIM(RTRIM(ISNULL(p.jabatan, '')))) = 'DRIVER'));

      SELECT mm.id, mm.sn, mm.tid, mm.lokasi, mm.denom
      FROM OPENJSON(@machineIdsJson) WITH (id BIGINT '$') requested
      INNER JOIN dbo.master_mesin mm ON mm.id = requested.id
      INNER JOIN dbo.master_project mp ON mp.id = mm.project_id
      WHERE mp.uker_id = @ukerId AND mm.is_active = 1;

      SELECT TOP (1)
        conflicts.work_order_no, conflicts.conflict_type,
        conflicts.employee_id, conflicts.member_role
      FROM (
        SELECT TOP (1)
          wo.id AS work_order_id, wo.work_order_no,
          CAST('VEHICLE' AS VARCHAR(20)) AS conflict_type,
          CAST(NULL AS INT) AS employee_id,
          CAST(NULL AS VARCHAR(20)) AS member_role,
          1 AS conflict_priority
        FROM dbo.replenish_work_orders wo
        WHERE wo.schedule_date = @scheduleDate
          AND wo.vehicle_id = @vehicleId
          AND wo.status NOT IN ('DITOLAK', 'DIBATALKAN')
          AND (@ignoredWorkOrderId IS NULL OR wo.id <> @ignoredWorkOrderId)
        ORDER BY wo.id DESC
        UNION ALL
        SELECT TOP (1)
          wo.id AS work_order_id, wo.work_order_no,
          CAST('EMPLOYEE' AS VARCHAR(20)) AS conflict_type,
          tm.employee_id, tm.member_role, 2 AS conflict_priority
        FROM dbo.replenish_team_members tm
        INNER JOIN dbo.replenish_work_orders wo ON wo.id = tm.work_order_id
        WHERE wo.schedule_date = @scheduleDate
          AND tm.employee_id IN (@custodyId, @driverId)
          AND wo.status NOT IN ('DITOLAK', 'DIBATALKAN')
          AND (@ignoredWorkOrderId IS NULL OR wo.id <> @ignoredWorkOrderId)
        ORDER BY wo.id DESC
      ) conflicts
      ORDER BY conflicts.conflict_priority, conflicts.work_order_id DESC;
    `)

  const [vehicles = [], employees = [], machines = [], conflicts = []] = result.recordsets || []
  const vehicle = vehicles[0] || null
  if (!vehicle) return { error: "Kendaraan harus berupa mobil yang aktif dan berasal dari unit kerja yang sama." }
  const selectedEmployees = new Map(employees.map((employee) => [String(employee.id), employee]))
  if (!selectedEmployees.has(String(data.custodyId))) {
    return { error: "Pegawai yang dipilih sebagai Custody harus aktif, menjabat Custody, dan berasal dari unit kerja yang sama." }
  }
  if (!selectedEmployees.has(String(data.driverId))) {
    return { error: "Pegawai yang dipilih sebagai Pengemudi harus aktif, menjabat Driver, dan berasal dari unit kerja yang sama." }
  }
  if (machines.length !== data.points.length) {
    return { error: "Satu atau lebih ATM/CRM tidak aktif, tidak ditemukan, atau berada di unit kerja lain." }
  }
  const conflict = conflicts[0]
  if (conflict) {
    return { error: conflict.conflict_type === "VEHICLE"
      ? `Kendaraan telah digunakan pada ${conflict.work_order_no} di tanggal yang sama.`
      : `Anggota tim telah ditugaskan pada ${conflict.work_order_no} di tanggal yang sama.` }
  }

  const calculation = materializeReplenishPoints(data.points, machines)
  if (calculation.error) return { error: calculation.error }

  return {
    error: null,
    references: { vehicle, employees, machines },
    points: calculation.points,
  }
}

export async function createWorkOrderNumber(executor, scheduleDate) {
  const result = await createRequest(executor)
    .input("scheduleDate", sql.Date, scheduleDate)
    .query(`
      DECLARE @sequence BIGINT = NEXT VALUE FOR dbo.replenish_work_order_sequence;
      SELECT CONCAT(
        'RPL-',
        CONVERT(CHAR(8), @scheduleDate, 112),
        '-',
        RIGHT(REPLICATE('0', 10) + CONVERT(VARCHAR(20), @sequence), 10)
      ) AS work_order_no;
    `)

  return result.recordset[0]?.work_order_no || null
}

export async function replaceWorkOrderDetails(executor, workOrderId, data) {
  const pointsJson = JSON.stringify(data.points.map((point) => ({
    machineId: point.machineId,
    sequenceNo: point.sequenceNo,
    activityType: point.activityType,
    pagu: point.pagu,
    denominationValue: point.denominationValue,
    requestedAmount: point.requestedAmount,
    notes: point.notes,
  })))

  await createRequest(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("pointsJson", sql.NVarChar(sql.MAX), pointsJson)
    .input("custodyId", sql.BigInt, data.custodyId)
    .input("driverId", sql.BigInt, data.driverId)
    .query(`
      SET NOCOUNT ON;
      DELETE FROM dbo.replenish_work_order_points WHERE work_order_id = @workOrderId;
      DELETE FROM dbo.replenish_team_members WHERE work_order_id = @workOrderId;

      INSERT INTO dbo.replenish_work_order_points
        (work_order_id, machine_id, sequence_no, activity_type, pagu,
         denomination_value, requested_amount, status, notes)
      SELECT @workOrderId, parsed.machine_id, parsed.sequence_no,
        parsed.activity_type, parsed.pagu, parsed.denomination_value,
        parsed.requested_amount, 'TERJADWAL', parsed.notes
      FROM OPENJSON(@pointsJson)
      WITH (
        machine_id BIGINT '$.machineId',
        sequence_no SMALLINT '$.sequenceNo',
        activity_type VARCHAR(20) '$.activityType',
        pagu INT '$.pagu',
        denomination_value BIGINT '$.denominationValue',
        requested_amount DECIMAL(19,2) '$.requestedAmount',
        notes NVARCHAR(500) '$.notes'
      ) parsed;

      IF @@ROWCOUNT <> (SELECT COUNT(1) FROM OPENJSON(@pointsJson))
        THROW 52711, 'Jumlah detail work order yang tersimpan tidak sesuai.', 1;

      INSERT INTO dbo.replenish_team_members
        (work_order_id, employee_id, member_role, is_lead)
      VALUES
        (@workOrderId, @custodyId, 'CUSTODY', 1),
        (@workOrderId, @driverId, 'PENGEMUDI', 0);
    `)
}

export async function isReplenishKeyHandoverSchemaReady(executor) {
  const result = await createRequest(executor).query(`
    SELECT CASE
      WHEN OBJECT_ID(N'dbo.replenish_key_handovers', N'U') IS NOT NULL
       AND OBJECT_ID(N'dbo.replenish_key_handover_items', N'U') IS NOT NULL
       AND OBJECT_ID(N'dbo.machine_key_mappings', N'U') IS NOT NULL
      THEN CAST(1 AS BIT)
      ELSE CAST(0 AS BIT)
    END AS schema_ready;
  `)
  return Boolean(result.recordset[0]?.schema_ready)
}

export async function validateReplenishKeyHandoverForSubmit(executor, workOrderId) {
  if (!(await isReplenishKeyHandoverSchemaReady(executor))) {
    return {
      error: "Fitur scan serah terima kunci belum siap. Jalankan migration 038 terlebih dahulu.",
      status: 503,
    }
  }

  const result = await createRequest(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .query(`
      SELECT
        COUNT_BIG(point.id) AS expected_count,
        COALESCE(SUM(CASE WHEN mapping.id IS NOT NULL THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END), 0) AS mapped_count,
        COALESCE(SUM(CASE WHEN item.id IS NOT NULL THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END), 0) AS scanned_count,
        COALESCE(SUM(CASE
          WHEN mapping.id IS NOT NULL
           AND mapping.status <> 'IN'
           AND ISNULL(mapping.current_work_order_id, 0) <> @workOrderId
          THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END), 0) AS unavailable_count,
        CONVERT(BIT, CASE WHEN MAX(CASE WHEN handover.verified_at IS NOT NULL THEN 1 ELSE 0 END) = 1 THEN 1 ELSE 0 END) AS verified,
        CONVERT(BIT, CASE WHEN MAX(CASE WHEN handover.printed_at IS NOT NULL THEN 1 ELSE 0 END) = 1 THEN 1 ELSE 0 END) AS printed
      FROM dbo.replenish_work_order_points point
      LEFT JOIN dbo.machine_key_mappings mapping WITH (UPDLOCK, HOLDLOCK)
        ON mapping.machine_id = point.machine_id
       AND mapping.key_type = 'REPLENISH'
      LEFT JOIN dbo.replenish_key_handovers handover WITH (UPDLOCK, HOLDLOCK)
        ON handover.work_order_id = point.work_order_id
      LEFT JOIN dbo.replenish_key_handover_items item WITH (UPDLOCK, HOLDLOCK)
        ON item.handover_id = handover.id
       AND item.work_order_point_id = point.id
       AND item.machine_key_mapping_id = mapping.id
       AND item.barcode_snapshot = mapping.barcode
      WHERE point.work_order_id = @workOrderId;
    `)

  const row = result.recordset[0] || {}
  const expected = Number(row.expected_count || 0)
  const mapped = Number(row.mapped_count || 0)
  const scanned = Number(row.scanned_count || 0)
  const unavailable = Number(row.unavailable_count || 0)

  if (expected === 0) {
    return { error: "Work order belum memiliki ATM/CRM untuk diverifikasi.", status: 409 }
  }
  if (mapped !== expected) {
    return {
      error: `Masih ada ${Math.max(0, expected - mapped)} ATM/CRM yang belum memiliki mapping kunci Replenish.`,
      status: 409,
    }
  }
  if (scanned !== expected) {
    return {
      error: `Scan serah terima kunci belum lengkap. ${Math.max(0, expected - scanned)} kunci masih harus discan.`,
      status: 409,
    }
  }
  if (unavailable > 0) {
    return {
      error: `${unavailable} kunci sedang tidak tersedia untuk work order ini.`,
      status: 409,
    }
  }
  if (!Boolean(row.verified)) {
    return { error: "Verifikasi serah terima kunci belum lengkap.", status: 409 }
  }
  return {
    error: null,
    expected,
    mapped,
    scanned,
    verified: true,
    printed: Boolean(row.printed),
  }
}

export async function resetReplenishKeyHandover(executor, workOrderId, userId) {
  if (!(await isReplenishKeyHandoverSchemaReady(executor))) return false

  await createRequest(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("userId", sql.Int, userId)
    .query(`
      UPDATE mapping
      SET
        status = 'IN',
        current_work_order_id = NULL,
        checked_in_at = SYSDATETIME(),
        updated_by = @userId,
        updated_at = SYSDATETIME()
      FROM dbo.machine_key_mappings mapping
      INNER JOIN dbo.replenish_key_handover_items item
        ON item.machine_key_mapping_id = mapping.id
      INNER JOIN dbo.replenish_key_handovers handover
        ON handover.id = item.handover_id
      WHERE handover.work_order_id = @workOrderId
        AND mapping.status = 'OUT'
        AND mapping.current_work_order_id = @workOrderId;

      DELETE item
      FROM dbo.replenish_key_handover_items item
      INNER JOIN dbo.replenish_key_handovers handover ON handover.id = item.handover_id
      WHERE handover.work_order_id = @workOrderId;

      UPDATE dbo.replenish_key_handovers
      SET
        receipt_no = NULL,
        verified_at = NULL,
        verified_by = NULL,
        printed_at = NULL,
        printed_by = NULL,
        updated_at = SYSDATETIME()
      WHERE work_order_id = @workOrderId;
    `)

  return true
}

export function calculateRequestedAmount(points) {
  return calculateRequestedAmountFromPoints(points)
}

export async function getReplenishWorkOrderDetail(
  executor,
  workOrderId,
  scopeCodeUker = null
) {
  const result = await createRequest(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("scopeCodeUker", sql.NVarChar(4), scopeCodeUker)
    .query(`
      SET NOCOUNT ON;

      SELECT TOP (1)
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
        wo.route_notes,
        wo.notes,
        wo.rejection_reason,
        wo.created_by,
        creator.full_name AS created_by_name,
        wo.submitted_by,
        submitter.full_name AS submitted_by_name,
        CONVERT(CHAR(19), wo.submitted_at, 126) AS submitted_at,
        wo.approved_by,
        approver.full_name AS approved_by_name,
        CONVERT(CHAR(19), wo.approved_at, 126) AS approved_at,
        wo.cancelled_by,
        canceller.full_name AS cancelled_by_name,
        CONVERT(CHAR(19), wo.cancelled_at, 126) AS cancelled_at,
        CONVERT(CHAR(19), wo.created_at, 126) AS created_at,
        CONVERT(CHAR(19), wo.updated_at, 126) AS updated_at,
        CONVERT(VARCHAR(18), wo.row_version, 1) AS row_version
      FROM dbo.replenish_work_orders wo
      INNER JOIN dbo.master_uker mu ON mu.id = wo.uker_id
      INNER JOIN dbo.master_kendaraan k ON k.id = wo.vehicle_id
      INNER JOIN dbo.users creator ON creator.id = wo.created_by
      LEFT JOIN dbo.users submitter ON submitter.id = wo.submitted_by
      LEFT JOIN dbo.users approver ON approver.id = wo.approved_by
      LEFT JOIN dbo.users canceller ON canceller.id = wo.cancelled_by
      WHERE wo.id = @workOrderId
        AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker);

      SELECT
        point.id,
        point.machine_id,
        point.sequence_no,
        point.activity_type,
        point.pagu,
        point.denomination_value,
        point.required_cassettes,
        point.requested_amount,
        point.status,
        point.notes,
        machine.sn,
        machine.tid,
        machine.lokasi,
        machine.kategori_mesin,
        machine.denom
      FROM dbo.replenish_work_order_points point
      INNER JOIN dbo.replenish_work_orders wo ON wo.id = point.work_order_id
      INNER JOIN dbo.master_uker mu ON mu.id = wo.uker_id
      INNER JOIN dbo.master_mesin machine ON machine.id = point.machine_id
      WHERE point.work_order_id = @workOrderId
        AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker)
      ORDER BY point.sequence_no;

      SELECT
        team.id,
        team.employee_id,
        team.member_role,
        team.is_lead,
        employee.nip,
        employee.nama,
        employee.jabatan
      FROM dbo.replenish_team_members team
      INNER JOIN dbo.replenish_work_orders wo ON wo.id = team.work_order_id
      INNER JOIN dbo.master_uker mu ON mu.id = wo.uker_id
      INNER JOIN dbo.pegawai employee ON employee.id = team.employee_id
      WHERE team.work_order_id = @workOrderId
        AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker)
      ORDER BY CASE team.member_role
        WHEN 'CUSTODY' THEN 1
        WHEN 'PENGEMUDI' THEN 2
        ELSE 99
      END;

      SELECT TOP (100)
        history.id,
        history.from_status,
        history.to_status,
        history.action,
        history.notes,
        history.actor_user_id,
        actor.full_name AS actor_name,
        CONVERT(CHAR(19), history.created_at, 126) AS created_at
      FROM dbo.replenish_status_history history
      INNER JOIN dbo.replenish_work_orders wo ON wo.id = history.work_order_id
      INNER JOIN dbo.master_uker mu ON mu.id = wo.uker_id
      INNER JOIN dbo.users actor ON actor.id = history.actor_user_id
      WHERE history.work_order_id = @workOrderId
        AND (@scopeCodeUker IS NULL OR mu.codeuker = @scopeCodeUker)
      ORDER BY history.id DESC;
    `)

  const [workOrders = [], points = [], team = [], history = []] = result.recordsets || []
  const workOrder = workOrders[0]
  if (!workOrder) return null

  return {
    ...workOrder,
    row_version: normalizeRowVersionToken(workOrder.row_version),
    points,
    team,
    history,
  }
}

export async function listReplenishAdminKpis(executor, {
  scopeUkerId = null,
  dateFrom,
  dateTo,
  searchPattern = "%",
  adminUserId = null,
  afterApprovedAt = null,
  afterId = null,
  pageSize = 20,
} = {}) {
  const take = pageSize + 1
  const result = await createRequest(executor)
    .input("take", sql.Int, take)
    .input("scopeUkerId", sql.BigInt, scopeUkerId)
    .input("dateFrom", sql.VarChar(10), dateFrom)
    .input("dateTo", sql.VarChar(10), dateTo)
    .input("search", sql.NVarChar(210), searchPattern)
    .input("adminUserId", sql.Int, adminUserId)
    .input("afterApprovedAt", sql.VarChar(19), afterApprovedAt)
    .input("afterId", sql.BigInt, afterId)
    .query(`
      SELECT
        wo.id AS work_order_id,
        wo.work_order_no,
        wo.uker_id,
        uker.codeuker,
        uker.nama_uker,
        CONVERT(CHAR(10), wo.schedule_date, 23) AS schedule_date,
        wo.activity_type,
        wo.priority,
        wo.total_points,
        wo.total_requested_amount,
        wo.created_by,
        creator.full_name AS created_by_name,
        wo.created_at,
        wo.submitted_at,
        wo.approved_by,
        approver.full_name AS approved_by_name,
        wo.approved_at,
        team.custody_name,
        team.driver_name
      INTO #eligible_replenish_admin_kpi
      FROM dbo.replenish_work_orders wo
      INNER JOIN dbo.master_uker uker ON uker.id = wo.uker_id
      INNER JOIN dbo.users creator ON creator.id = wo.created_by
      LEFT JOIN dbo.users approver ON approver.id = wo.approved_by
      OUTER APPLY (
        SELECT
          MAX(CASE WHEN member.member_role = 'CUSTODY' THEN employee.nama END) AS custody_name,
          MAX(CASE WHEN member.member_role = 'PENGEMUDI' THEN employee.nama END) AS driver_name
        FROM dbo.replenish_team_members member
        INNER JOIN dbo.pegawai employee ON employee.id = member.employee_id
        WHERE member.work_order_id = wo.id
      ) team
      WHERE wo.approved_at IS NOT NULL
        AND wo.approved_by IS NOT NULL
        AND wo.approved_at >= CONVERT(DATE, @dateFrom, 23)
        AND wo.approved_at < DATEADD(DAY, 1, CONVERT(DATE, @dateTo, 23))
        AND (@scopeUkerId IS NULL OR wo.uker_id = @scopeUkerId)
        AND (
          @search = '%'
          OR wo.work_order_no LIKE @search ESCAPE '\\'
          OR uker.codeuker LIKE @search ESCAPE '\\'
          OR uker.nama_uker LIKE @search ESCAPE '\\'
          OR creator.full_name LIKE @search ESCAPE '\\'
          OR approver.full_name LIKE @search ESCAPE '\\'
          OR team.custody_name LIKE @search ESCAPE '\\'
          OR team.driver_name LIKE @search ESCAPE '\\'
          OR EXISTS (
            SELECT 1
            FROM dbo.replenish_work_order_points search_point
            INNER JOIN dbo.master_mesin machine ON machine.id = search_point.machine_id
            WHERE search_point.work_order_id = wo.id
              AND machine.tid LIKE @search ESCAPE '\\'
          )
        );

      SELECT
        history.work_order_id,
        history.id,
        history.action,
        history.created_at,
        LEAD(history.action) OVER (
          PARTITION BY history.work_order_id
          ORDER BY history.id
        ) AS next_action,
        LEAD(history.created_at) OVER (
          PARTITION BY history.work_order_id
          ORDER BY history.id
        ) AS next_created_at
      INTO #replenish_admin_kpi_events
      FROM dbo.replenish_status_history history
      INNER JOIN #eligible_replenish_admin_kpi eligible
        ON eligible.work_order_id = history.work_order_id
      WHERE history.action IN ('SUBMIT', 'APPROVE', 'REJECT');

      SELECT
        event.work_order_id,
        MIN(CASE WHEN event.action = 'SUBMIT' THEN event.created_at END) AS first_submitted_at,
        SUM(CASE
          WHEN event.action = 'REJECT'
            AND event.next_action = 'SUBMIT'
            THEN DATEDIFF_BIG(SECOND, event.created_at, event.next_created_at)
          ELSE CONVERT(BIGINT, 0)
        END) AS rework_duration_seconds,
        SUM(CASE
          WHEN event.action = 'SUBMIT'
            AND event.next_action IN ('APPROVE', 'REJECT')
            THEN DATEDIFF_BIG(SECOND, event.created_at, event.next_created_at)
          ELSE CONVERT(BIGINT, 0)
        END) AS approval_duration_seconds,
        SUM(CASE WHEN event.action = 'REJECT' THEN 1 ELSE 0 END) AS rejection_count
      INTO #replenish_admin_kpi_event_metrics
      FROM #replenish_admin_kpi_events event
      GROUP BY event.work_order_id;

      SELECT
        eligible.work_order_id,
        eligible.work_order_no,
        eligible.codeuker,
        eligible.nama_uker,
        eligible.schedule_date,
        eligible.activity_type,
        eligible.priority,
        eligible.total_points,
        eligible.total_requested_amount,
        eligible.created_by,
        eligible.created_by_name,
        eligible.approved_by,
        eligible.approved_by_name,
        eligible.custody_name,
        eligible.driver_name,
        eligible.created_at AS team_draft_created_at,
        eligible.submitted_at,
        eligible.approved_at,
        CASE
          WHEN COALESCE(metrics.first_submitted_at, eligible.submitted_at) IS NOT NULL
            THEN DATEDIFF_BIG(
              SECOND,
              eligible.created_at,
              COALESCE(metrics.first_submitted_at, eligible.submitted_at)
            ) + COALESCE(metrics.rework_duration_seconds, 0)
          ELSE CONVERT(BIGINT, 0)
        END AS admin_preparation_seconds,
        CASE
          WHEN COALESCE(metrics.approval_duration_seconds, 0) > 0
            THEN metrics.approval_duration_seconds
          WHEN eligible.submitted_at IS NOT NULL
            THEN DATEDIFF_BIG(SECOND, eligible.submitted_at, eligible.approved_at)
          ELSE CONVERT(BIGINT, 0)
        END AS approval_duration_seconds,
        DATEDIFF_BIG(SECOND, eligible.created_at, eligible.approved_at) AS total_duration_seconds,
        COALESCE(metrics.rejection_count, 0) AS rejection_count
      INTO #replenish_admin_kpi
      FROM #eligible_replenish_admin_kpi eligible
      LEFT JOIN #replenish_admin_kpi_event_metrics metrics
        ON metrics.work_order_id = eligible.work_order_id;

      SELECT TOP (@take)
        work_order_id,
        work_order_no,
        codeuker,
        nama_uker,
        schedule_date,
        activity_type,
        priority,
        total_points,
        total_requested_amount,
        created_by,
        created_by_name,
        approved_by,
        approved_by_name,
        custody_name,
        driver_name,
        CONVERT(CHAR(19), team_draft_created_at, 126) AS team_draft_created_at,
        CONVERT(CHAR(19), submitted_at, 126) AS submitted_at,
        CONVERT(CHAR(19), approved_at, 126) AS approved_at,
        admin_preparation_seconds,
        approval_duration_seconds,
        total_duration_seconds,
        rejection_count
      FROM #replenish_admin_kpi
      WHERE (@adminUserId IS NULL OR created_by = @adminUserId)
        AND (
          @afterApprovedAt IS NULL
          OR approved_at < CONVERT(DATETIME2(0), @afterApprovedAt, 126)
          OR (
            approved_at = CONVERT(DATETIME2(0), @afterApprovedAt, 126)
            AND work_order_id < @afterId
          )
        )
      ORDER BY approved_at DESC, work_order_id DESC;

      SELECT
        COUNT_BIG(1) AS total_jobs,
        COALESCE(AVG(CONVERT(DECIMAL(20,2), admin_preparation_seconds)), 0) AS average_admin_seconds,
        COALESCE(AVG(CONVERT(DECIMAL(20,2), approval_duration_seconds)), 0) AS average_approval_seconds,
        COALESCE(AVG(CONVERT(DECIMAL(20,2), total_duration_seconds)), 0) AS average_total_seconds,
        COALESCE(MAX(total_duration_seconds), 0) AS longest_total_seconds,
        COALESCE(SUM(CONVERT(BIGINT, rejection_count)), 0) AS total_rejections
      FROM #replenish_admin_kpi
      WHERE @adminUserId IS NULL OR created_by = @adminUserId;

      SELECT DISTINCT
        created_by AS user_id,
        created_by_name AS full_name
      FROM #replenish_admin_kpi
      ORDER BY created_by_name;

      DROP TABLE #replenish_admin_kpi;
      DROP TABLE #replenish_admin_kpi_event_metrics;
      DROP TABLE #replenish_admin_kpi_events;
      DROP TABLE #eligible_replenish_admin_kpi;
    `)

  const rows = result.recordsets?.[0] || []
  const hasMore = rows.length > pageSize
  const visibleRows = hasMore ? rows.slice(0, pageSize) : rows
  const items = visibleRows.map((item) => ({
    ...item,
    work_order_id: Number(item.work_order_id || 0),
    total_points: Number(item.total_points || 0),
    total_requested_amount: Number(item.total_requested_amount || 0),
    created_by: Number(item.created_by || 0) || null,
    approved_by: Number(item.approved_by || 0) || null,
    admin_preparation_seconds: Number(item.admin_preparation_seconds || 0),
    approval_duration_seconds: Number(item.approval_duration_seconds || 0),
    total_duration_seconds: Number(item.total_duration_seconds || 0),
    rejection_count: Number(item.rejection_count || 0),
  }))
  const summary = result.recordsets?.[1]?.[0] || {}
  const admins = (result.recordsets?.[2] || []).map((item) => ({
    user_id: Number(item.user_id || 0),
    full_name: item.full_name || "-",
  }))
  const lastItem = items.at(-1) || null

  return {
    items,
    summary: {
      total_jobs: Number(summary.total_jobs || 0),
      average_admin_seconds: Number(summary.average_admin_seconds || 0),
      average_approval_seconds: Number(summary.average_approval_seconds || 0),
      average_total_seconds: Number(summary.average_total_seconds || 0),
      longest_total_seconds: Number(summary.longest_total_seconds || 0),
      total_rejections: Number(summary.total_rejections || 0),
    },
    admins,
    pagination: {
      page_size: pageSize,
      has_more: hasMore,
      next_cursor: hasMore && lastItem ? {
        approved_at: lastItem.approved_at,
        work_order_id: lastItem.work_order_id,
      } : null,
    },
  }
}
