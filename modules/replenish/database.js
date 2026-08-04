import "server-only"

import { sql } from "@/lib/mssql"
import { normalizeRowVersionToken } from "@/modules/master-mesin/row-version"

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
  const vehicleResult = await createRequest(executor)
    .input("vehicleId", sql.BigInt, data.vehicleId)
    .input("ukerId", sql.BigInt, ukerId)
    .query(`
      SELECT TOP 1
        k.id,
        k.nomor_kendaraan,
        k.merk_kendaraan,
        k.jenis_kendaraan,
        k.status
      FROM dbo.master_kendaraan k
      WHERE k.id = @vehicleId
        AND k.uker_id = @ukerId
        AND k.status = 'AKTIF'
        AND UPPER(LTRIM(RTRIM(k.jenis_kendaraan))) = 'MOBIL';
    `)

  if (vehicleResult.recordset.length === 0) {
    return {
      error: "Kendaraan harus berupa mobil yang aktif dan berasal dari unit kerja yang sama.",
    }
  }

  const employeeResult = await createRequest(executor)
    .input("custodyId", sql.BigInt, data.custodyId)
    .input("driverId", sql.BigInt, data.driverId)
    .input("ukerId", sql.BigInt, ukerId)
    .query(`
      SELECT
        id,
        nip,
        nama,
        jabatan,
        CASE
          WHEN id = @custodyId THEN 'CUSTODY'
          WHEN id = @driverId THEN 'DRIVER'
        END AS selected_team_role
      FROM dbo.pegawai
      WHERE uker_id = @ukerId
        AND status = 1
        AND (
          (
            id = @custodyId
            AND UPPER(LTRIM(RTRIM(ISNULL(jabatan, '')))) = 'CUSTODY'
          )
          OR
          (
            id = @driverId
            AND UPPER(LTRIM(RTRIM(ISNULL(jabatan, '')))) = 'DRIVER'
          )
        );
    `)

  const selectedEmployees = new Map(
    employeeResult.recordset.map((employee) => [String(employee.id), employee])
  )

  if (!selectedEmployees.has(String(data.custodyId))) {
    return {
      error: "Pegawai yang dipilih sebagai Custody harus aktif, menjabat Custody, dan berasal dari unit kerja yang sama.",
    }
  }

  if (!selectedEmployees.has(String(data.driverId))) {
    return {
      error: "Pegawai yang dipilih sebagai Pengemudi harus aktif, menjabat Driver, dan berasal dari unit kerja yang sama.",
    }
  }

  const machineRequest = createRequest(executor)
    .input("ukerId", sql.BigInt, ukerId)
  const machineParameters = data.points.map((point, index) => {
    const parameter = `machineId${index}`
    machineRequest.input(parameter, sql.BigInt, point.machineId)
    return `@${parameter}`
  })

  const machineResult = await machineRequest.query(`
    SELECT
      mm.id,
      mm.sn,
      mm.tid,
      mm.lokasi
    FROM dbo.master_mesin mm
    INNER JOIN dbo.master_project mp ON mp.id = mm.project_id
    WHERE mm.id IN (${machineParameters.join(", ")})
      AND mp.uker_id = @ukerId
      AND mm.is_active = 1;
  `)

  if (machineResult.recordset.length !== data.points.length) {
    return {
      error: "Satu atau lebih ATM/CRM tidak aktif, tidak ditemukan, atau berada di unit kerja lain.",
    }
  }

  const conflictRequest = createRequest(executor)
    .input("scheduleDate", sql.Date, data.scheduleDate)
    .input("vehicleId", sql.BigInt, data.vehicleId)
    .input("custodyId", sql.BigInt, data.custodyId)
    .input("driverId", sql.BigInt, data.driverId)
    .input("ignoredWorkOrderId", sql.BigInt, ignoredWorkOrderId)

  const conflictResult = await conflictRequest.query(`
    SELECT TOP 1
      wo.work_order_no,
      CASE
        WHEN wo.vehicle_id = @vehicleId THEN 'VEHICLE'
        ELSE 'EMPLOYEE'
      END AS conflict_type,
      tm.employee_id,
      tm.member_role
    FROM dbo.replenish_work_orders wo
    LEFT JOIN dbo.replenish_team_members tm
      ON tm.work_order_id = wo.id
    WHERE wo.schedule_date = @scheduleDate
      AND wo.status NOT IN ('DITOLAK', 'DIBATALKAN')
      AND (@ignoredWorkOrderId IS NULL OR wo.id <> @ignoredWorkOrderId)
      AND (
        wo.vehicle_id = @vehicleId
        OR tm.employee_id IN (@custodyId, @driverId)
      )
    ORDER BY wo.id DESC;
  `)

  const conflict = conflictResult.recordset[0]
  if (conflict) {
    return {
      error:
        conflict.conflict_type === "VEHICLE"
          ? `Kendaraan telah digunakan pada ${conflict.work_order_no} di tanggal yang sama.`
          : `Anggota tim telah ditugaskan pada ${conflict.work_order_no} di tanggal yang sama.`,
    }
  }

  return {
    error: null,
    references: {
      vehicle: vehicleResult.recordset[0],
      employees: employeeResult.recordset,
      machines: machineResult.recordset,
    },
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
  const deleteRequest = createRequest(executor)
    .input("workOrderId", sql.BigInt, workOrderId)

  await deleteRequest.query(`
    DELETE FROM dbo.replenish_work_order_points WHERE work_order_id = @workOrderId;
    DELETE FROM dbo.replenish_team_members WHERE work_order_id = @workOrderId;
  `)

  for (const point of data.points) {
    await createRequest(executor)
      .input("workOrderId", sql.BigInt, workOrderId)
      .input("machineId", sql.BigInt, point.machineId)
      .input("sequenceNo", sql.SmallInt, point.sequenceNo)
      .input("requestedAmount", sql.Decimal(19, 2), point.requestedAmount)
      .input("notes", sql.NVarChar(500), point.notes)
      .query(`
        INSERT INTO dbo.replenish_work_order_points
          (work_order_id, machine_id, sequence_no, requested_amount, status, notes)
        VALUES
          (@workOrderId, @machineId, @sequenceNo, @requestedAmount, 'TERJADWAL', @notes);
      `)
  }

  for (const member of [
    { employeeId: data.custodyId, role: "CUSTODY", isLead: true },
    { employeeId: data.driverId, role: "PENGEMUDI", isLead: false },
  ]) {
    await createRequest(executor)
      .input("workOrderId", sql.BigInt, workOrderId)
      .input("employeeId", sql.BigInt, member.employeeId)
      .input("memberRole", sql.VarChar(20), member.role)
      .input("isLead", sql.Bit, member.isLead)
      .query(`
        INSERT INTO dbo.replenish_team_members
          (work_order_id, employee_id, member_role, is_lead)
        VALUES
          (@workOrderId, @employeeId, @memberRole, @isLead);
      `)
  }
}

export function calculateRequestedAmount(points) {
  return points.reduce(
    (total, point) => total + Number(point.requestedAmount || 0),
    0
  )
}

export async function getReplenishWorkOrderDetail(
  executor,
  workOrderId,
  scopeCodeUker = null
) {
  const workOrderResult = await createRequest(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("scopeCodeUker", sql.NVarChar(4), scopeCodeUker)
    .query(`
      SELECT TOP 1
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
        wo.submitted_at,
        wo.approved_by,
        approver.full_name AS approved_by_name,
        wo.approved_at,
        wo.cancelled_by,
        canceller.full_name AS cancelled_by_name,
        wo.cancelled_at,
        wo.created_at,
        wo.updated_at,
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
    `)

  const workOrder = workOrderResult.recordset[0]
  if (!workOrder) return null

  const [pointsResult, teamResult, historyResult] = await Promise.all([
    createRequest(executor)
      .input("workOrderId", sql.BigInt, workOrderId)
      .query(`
        SELECT
          p.id,
          p.machine_id,
          p.sequence_no,
          p.requested_amount,
          p.status,
          p.notes,
          m.sn,
          m.tid,
          m.lokasi,
          m.kategori_mesin
        FROM dbo.replenish_work_order_points p
        INNER JOIN dbo.master_mesin m ON m.id = p.machine_id
        WHERE p.work_order_id = @workOrderId
        ORDER BY p.sequence_no;
      `),
    createRequest(executor)
      .input("workOrderId", sql.BigInt, workOrderId)
      .query(`
        SELECT
          tm.id,
          tm.employee_id,
          tm.member_role,
          tm.is_lead,
          p.nip,
          p.nama,
          p.jabatan
        FROM dbo.replenish_team_members tm
        INNER JOIN dbo.pegawai p ON p.id = tm.employee_id
        WHERE tm.work_order_id = @workOrderId
        ORDER BY CASE tm.member_role
          WHEN 'CUSTODY' THEN 1
          WHEN 'PENGEMUDI' THEN 2
          ELSE 99
        END;
      `),
    createRequest(executor)
      .input("workOrderId", sql.BigInt, workOrderId)
      .query(`
        SELECT TOP (100)
          h.id,
          h.from_status,
          h.to_status,
          h.action,
          h.notes,
          h.actor_user_id,
          u.full_name AS actor_name,
          h.created_at
        FROM dbo.replenish_status_history h
        INNER JOIN dbo.users u ON u.id = h.actor_user_id
        WHERE h.work_order_id = @workOrderId
        ORDER BY h.id DESC;
      `),
  ])

  return {
    ...workOrder,
    row_version: normalizeRowVersionToken(workOrder.row_version),
    points: pointsResult.recordset,
    team: teamResult.recordset,
    history: historyResult.recordset,
  }
}
