import "server-only"

import { sql } from "@/lib/mssql"
import { normalizeRowVersionToken } from "@/modules/master-mesin/row-version"
import { CPC_MENU_HREF, CPC_QUEUE_STATUSES } from "@/modules/cpc/constants"
import { getReplenishWorkOrderDetail } from "@/modules/replenish/database"

const CPC_STATUS_SET = new Set(CPC_QUEUE_STATUSES)

function createRequest(executor) {
  return new sql.Request(executor)
}

export async function resolveCpcScope(executor, scope) {
  if (scope.isSuperAdmin) {
    return {
      ukerId: null,
      codeUker: null,
      namaUker: null,
      error: null,
    }
  }

  if (!scope.codeUker) {
    return {
      ukerId: null,
      codeUker: null,
      namaUker: null,
      error: "Unit kerja pengguna CPC belum terhubung.",
    }
  }

  const result = await createRequest(executor)
    .input("codeUker", sql.NVarChar(4), scope.codeUker)
    .query(`
      SELECT TOP (1) id, codeuker, nama_uker
      FROM dbo.master_uker
      WHERE codeuker = @codeUker;
    `)

  const uker = result.recordset[0]
  if (!uker) {
    return {
      ukerId: null,
      codeUker: scope.codeUker,
      namaUker: null,
      error: "Unit kerja akun CPC tidak ditemukan pada master unit kerja.",
    }
  }

  return {
    ukerId: Number(uker.id),
    codeUker: uker.codeuker,
    namaUker: uker.nama_uker,
    error: null,
  }
}

export async function listCpcCassetteRequests(executor, {
  scopeUkerId = null,
  afterId = null,
  pageSize = 10,
  status = null,
  searchPattern = "%",
  dateFrom = null,
  dateTo = null,
} = {}) {
  const take = pageSize + 1
  const result = await createRequest(executor)
    .input("take", sql.Int, take)
    .input("afterId", sql.BigInt, afterId)
    .input("scopeUkerId", sql.BigInt, scopeUkerId)
    .input("status", sql.VarChar(40), status)
    .input("search", sql.NVarChar(210), searchPattern)
    .input("dateFrom", sql.VarChar(10), dateFrom)
    .input("dateTo", sql.VarChar(10), dateTo)
    .query(`
      SELECT TOP (@take)
        wo.id,
        wo.work_order_no,
        wo.uker_id,
        uker.codeuker,
        uker.nama_uker,
        wo.activity_type,
        CONVERT(CHAR(10), wo.schedule_date, 23) AS schedule_date,
        CONVERT(CHAR(5), wo.departure_time, 108) AS departure_time,
        CONVERT(CHAR(5), wo.estimated_finish_time, 108) AS estimated_finish_time,
        wo.priority,
        wo.status,
        wo.total_points,
        wo.total_requested_amount,
        COALESCE(needs.total_sheets, 0) AS total_sheets,
        COALESCE(needs.total_cassettes, 0) AS total_cassettes,
        COALESCE(needs.cash_points, 0) AS cash_points,
        team.custody_name,
        team.driver_name,
        wo.approved_by,
        approver.full_name AS approved_by_name,
        CONVERT(CHAR(19), wo.approved_at, 126) AS approved_at,
        packing_batch.packing_owner_user_id,
        packing_owner.full_name AS packing_owner_name,
        CONVERT(CHAR(19), packing_batch.packing_claimed_at, 126) AS packing_claimed_at,
        CONVERT(CHAR(19), wo.updated_at, 126) AS updated_at,
        CONVERT(VARCHAR(18), wo.row_version, 1) AS row_version
      FROM dbo.replenish_work_orders wo
      INNER JOIN dbo.master_uker uker ON uker.id = wo.uker_id
      LEFT JOIN dbo.users approver ON approver.id = wo.approved_by
      LEFT JOIN dbo.cpc_packing_batches packing_batch ON packing_batch.work_order_id = wo.id
      LEFT JOIN dbo.users packing_owner ON packing_owner.id = packing_batch.packing_owner_user_id
      OUTER APPLY (
        SELECT
          COALESCE(SUM(CONVERT(BIGINT, CASE WHEN point.pagu IS NULL THEN 0 ELSE point.pagu END)), 0) AS total_sheets,
          COALESCE(SUM(CONVERT(BIGINT, CASE WHEN point.required_cassettes IS NULL THEN 0 ELSE point.required_cassettes END)), 0) AS total_cassettes,
          COALESCE(SUM(CONVERT(BIGINT, CASE WHEN point.pagu IS NULL THEN 0 ELSE 1 END)), 0) AS cash_points
        FROM dbo.replenish_work_order_points point
        WHERE point.work_order_id = wo.id
      ) needs
      OUTER APPLY (
        SELECT
          MAX(CASE WHEN member.member_role = 'CUSTODY' THEN employee.nama END) AS custody_name,
          MAX(CASE WHEN member.member_role = 'PENGEMUDI' THEN employee.nama END) AS driver_name
        FROM dbo.replenish_team_members member
        INNER JOIN dbo.pegawai employee ON employee.id = member.employee_id
        WHERE member.work_order_id = wo.id
      ) team
      WHERE wo.status IN ('DISETUJUI', 'MENUNGGU_VALIDASI_KASET', 'KASET_DALAM_PERSIAPAN', 'MENUNGGU_APPROVAL_CPC', 'KASET_SIAP', 'SIAP_BERANGKAT')
        AND (@scopeUkerId IS NULL OR wo.uker_id = @scopeUkerId)
        AND (@afterId IS NULL OR wo.id < @afterId)
        AND (@status IS NULL OR wo.status = @status)
        AND (@dateFrom IS NULL OR wo.schedule_date >= CONVERT(DATE, @dateFrom, 23))
        AND (@dateTo IS NULL OR wo.schedule_date <= CONVERT(DATE, @dateTo, 23))
        AND (
          @search = '%'
          OR wo.work_order_no LIKE @search ESCAPE '\\'
          OR uker.codeuker LIKE @search ESCAPE '\\'
          OR uker.nama_uker LIKE @search ESCAPE '\\'
          OR EXISTS (
            SELECT 1
            FROM dbo.replenish_work_order_points search_point
            INNER JOIN dbo.master_mesin machine ON machine.id = search_point.machine_id
            WHERE search_point.work_order_id = wo.id
              AND (
                machine.tid LIKE @search ESCAPE '\\'
                OR machine.sn LIKE @search ESCAPE '\\'
                OR machine.lokasi LIKE @search ESCAPE '\\'
              )
          )
        )
      ORDER BY wo.id DESC;

      SELECT
        COUNT_BIG(1) AS total,
        COALESCE(SUM(CASE WHEN wo.status = 'DISETUJUI' THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END), 0) AS new_requests,
        COALESCE(SUM(CASE WHEN wo.status = 'MENUNGGU_VALIDASI_KASET' THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END), 0) AS waiting_validation,
        COALESCE(SUM(CASE WHEN wo.status = 'KASET_DALAM_PERSIAPAN' THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END), 0) AS in_preparation,
        COALESCE(SUM(CASE WHEN wo.status = 'MENUNGGU_APPROVAL_CPC' THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END), 0) AS waiting_approval,
        COALESCE(SUM(CASE WHEN wo.status = 'KASET_SIAP' THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END), 0) AS ready,
        COALESCE(SUM(CASE WHEN wo.status = 'SIAP_BERANGKAT' THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END), 0) AS handed_over,
        COALESCE(SUM(CONVERT(DECIMAL(38,2), wo.total_requested_amount)), 0) AS total_requested_amount,
        COALESCE(SUM(CONVERT(BIGINT, needs.total_sheets)), 0) AS total_sheets,
        COALESCE(SUM(CONVERT(BIGINT, needs.total_cassettes)), 0) AS total_cassettes
      FROM dbo.replenish_work_orders wo
      OUTER APPLY (
        SELECT
          COALESCE(SUM(CONVERT(BIGINT, CASE WHEN point.pagu IS NULL THEN 0 ELSE point.pagu END)), 0) AS total_sheets,
          COALESCE(SUM(CONVERT(BIGINT, CASE WHEN point.required_cassettes IS NULL THEN 0 ELSE point.required_cassettes END)), 0) AS total_cassettes
        FROM dbo.replenish_work_order_points point
        WHERE point.work_order_id = wo.id
      ) needs
      WHERE wo.status IN ('DISETUJUI', 'MENUNGGU_VALIDASI_KASET', 'KASET_DALAM_PERSIAPAN', 'MENUNGGU_APPROVAL_CPC', 'KASET_SIAP', 'SIAP_BERANGKAT')
        AND (@scopeUkerId IS NULL OR wo.uker_id = @scopeUkerId);
    `)

  const rows = result.recordsets?.[0] || []
  const hasMore = rows.length > pageSize
  const visibleRows = hasMore ? rows.slice(0, pageSize) : rows
  const items = visibleRows.map((item) => ({
    ...item,
    row_version: normalizeRowVersionToken(item.row_version),
    total_points: Number(item.total_points || 0),
    total_requested_amount: Number(item.total_requested_amount || 0),
    total_sheets: Number(item.total_sheets || 0),
    total_cassettes: Number(item.total_cassettes || 0),
    cash_points: Number(item.cash_points || 0),
  }))

  const summary = result.recordsets?.[1]?.[0] || {}

  return {
    items,
    pagination: {
      page_size: pageSize,
      has_more: hasMore,
      next_cursor: hasMore ? items.at(-1)?.id || null : null,
    },
    summary: {
      total: Number(summary.total || 0),
      new_requests: Number(summary.new_requests || 0),
      waiting_validation: Number(summary.waiting_validation || 0),
      in_preparation: Number(summary.in_preparation || 0),
      waiting_approval: Number(summary.waiting_approval || 0),
      ready: Number(summary.ready || 0),
      handed_over: Number(summary.handed_over || 0),
      total_requested_amount: Number(summary.total_requested_amount || 0),
      total_sheets: Number(summary.total_sheets || 0),
      total_cassettes: Number(summary.total_cassettes || 0),
    },
  }
}

export async function getCpcCassetteRequestDetail(executor, workOrderId, scopeCodeUker = null) {
  const detail = await getReplenishWorkOrderDetail(executor, workOrderId, scopeCodeUker)
  if (!detail || !CPC_STATUS_SET.has(String(detail.status || "").toUpperCase())) return null

  const packing = await getCpcPackingSnapshot(executor, workOrderId)
  const handover = await getCpcCassetteHandoverSnapshot(executor, workOrderId)

  const totals = (detail.points || []).reduce((accumulator, point) => {
    accumulator.totalSheets += Number(point.pagu || 0)
    accumulator.totalCassettes += Number(point.required_cassettes || 0)
    accumulator.cashPoints += point.pagu ? 1 : 0
    return accumulator
  }, { totalSheets: 0, totalCassettes: 0, cashPoints: 0 })

  return {
    ...detail,
    cpc_requirements: {
      total_sheets: totals.totalSheets,
      total_cassettes: totals.totalCassettes,
      cash_points: totals.cashPoints,
      total_requested_amount: Number(detail.total_requested_amount || 0),
    },
    cpc_packing: packing,
    cpc_handover: handover,
  }
}

export async function listCpcSpareCassettes(executor) {
  const result = await createRequest(executor).query(`
    SELECT
      spare.id,
      spare.cassette_serial,
      spare.denomination_value,
      spare.sheets_count,
      CONVERT(DECIMAL(19,2), spare.denomination_value * spare.sheets_count) AS amount,
      spare.rubber_seal_no,
      spare.status,
      spare.prepared_by,
      preparer.full_name AS prepared_by_name,
      CONVERT(CHAR(19), spare.prepared_at, 126) AS prepared_at,
      spare.allocated_packing_cassette_id,
      spare.allocated_by,
      allocator.full_name AS allocated_by_name,
      CONVERT(CHAR(19), spare.allocated_at, 126) AS allocated_at,
      batch.work_order_id,
      wo.work_order_no,
      point.id AS work_order_point_id,
      machine.tid,
      machine.sn,
      CONVERT(CHAR(19), spare.updated_at, 126) AS updated_at,
      CONVERT(VARCHAR(18), spare.row_version, 1) AS row_version
    FROM dbo.cpc_spare_cassettes spare
    LEFT JOIN dbo.users preparer ON preparer.id = spare.prepared_by
    LEFT JOIN dbo.users allocator ON allocator.id = spare.allocated_by
    LEFT JOIN dbo.cpc_packing_cassettes packing ON packing.id = spare.allocated_packing_cassette_id
    LEFT JOIN dbo.cpc_packing_batches batch ON batch.id = packing.batch_id
    LEFT JOIN dbo.replenish_work_orders wo ON wo.id = batch.work_order_id
    LEFT JOIN dbo.replenish_work_order_points point ON point.id = packing.work_order_point_id
    LEFT JOIN dbo.master_mesin machine ON machine.id = point.machine_id
    ORDER BY spare.cassette_serial;
  `)

  const items = (result.recordset || []).map((item) => ({
    ...item,
    denomination_value: Number(item.denomination_value || 0),
    sheets_count: Number(item.sheets_count || 0),
    amount: Number(item.amount || 0),
    row_version: normalizeRowVersionToken(item.row_version),
  }))

  return {
    items,
    summary: {
      total: items.length,
      ready: items.filter((item) => item.status === "READY").length,
      empty: items.filter((item) => item.status === "KOSONG").length,
      allocated: items.filter((item) => item.status === "ALLOCATED").length,
      ready_50000: items.filter((item) => item.status === "READY" && item.denomination_value === 50000).length,
      ready_100000: items.filter((item) => item.status === "READY" && item.denomination_value === 100000).length,
    },
  }
}

export async function getLockedCpcWorkOrder(executor, workOrderId, scopeCodeUker = null) {
  const result = await createRequest(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("scopeCodeUker", sql.NVarChar(4), scopeCodeUker)
    .query(`
      SELECT TOP (1)
        wo.id,
        wo.work_order_no,
        wo.status,
        wo.uker_id,
        wo.approved_at,
        wo.row_version,
        uker.codeuker,
        uker.nama_uker
      FROM dbo.replenish_work_orders wo WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN dbo.master_uker uker ON uker.id = wo.uker_id
      WHERE wo.id = @workOrderId
        AND (@scopeCodeUker IS NULL OR uker.codeuker = @scopeCodeUker);
    `)

  return result.recordset[0] || null
}

export async function ensureCpcPackingBatch(executor, workOrderId, userId) {
  const request = createRequest(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("userId", sql.Int, userId)

  const result = await request.query(`
    IF NOT EXISTS (
      SELECT 1
      FROM dbo.cpc_packing_batches WITH (UPDLOCK, HOLDLOCK)
      WHERE work_order_id = @workOrderId
    )
    BEGIN
      INSERT INTO dbo.cpc_packing_batches
        (work_order_id, status, created_by)
      VALUES
        (@workOrderId, 'PACKING', @userId);
    END;

    DECLARE @batchId BIGINT = (
      SELECT TOP (1) id
      FROM dbo.cpc_packing_batches WITH (UPDLOCK, HOLDLOCK)
      WHERE work_order_id = @workOrderId
    );

    ;WITH numbers AS (
      SELECT 1 AS n
      UNION ALL SELECT 2
      UNION ALL SELECT 3
      UNION ALL SELECT 4
      UNION ALL SELECT 5
      UNION ALL SELECT 6
      UNION ALL SELECT 7
      UNION ALL SELECT 8
      UNION ALL SELECT 9
      UNION ALL SELECT 10
      UNION ALL SELECT 11
      UNION ALL SELECT 12
      UNION ALL SELECT 13
      UNION ALL SELECT 14
      UNION ALL SELECT 15
      UNION ALL SELECT 16
      UNION ALL SELECT 17
      UNION ALL SELECT 18
      UNION ALL SELECT 19
      UNION ALL SELECT 20
    )
    INSERT INTO dbo.cpc_packing_cassettes
      (batch_id, work_order_point_id, cassette_no, denomination_value, sheets_count)
    SELECT
      @batchId,
      point.id,
      numbers.n,
      CONVERT(DECIMAL(19,2), point.denomination_value),
      2000
    FROM dbo.replenish_work_order_points point
    INNER JOIN numbers ON numbers.n <= ISNULL(point.required_cassettes, 0)
    WHERE point.work_order_id = @workOrderId
      AND point.denomination_value IS NOT NULL
      AND point.denomination_value > 0
      AND NOT EXISTS (
        SELECT 1
        FROM dbo.cpc_packing_cassettes existing
        WHERE existing.batch_id = @batchId
          AND existing.work_order_point_id = point.id
          AND existing.cassette_no = numbers.n
      );

    /*
      Per TID extension. Satu point/TID mendapat satu kaset reject Rp0 serta
      dua slot segel bag. Existing approved batches tanpa row extension tetap
      dapat dibaca sebagai data legacy sampai packing tersebut dibuka kembali.
    */
    INSERT INTO dbo.cpc_packing_tid_assets
      (
        batch_id,
        work_order_point_id,
        reject_denomination_value,
        reject_sheets_count
      )
    SELECT
      @batchId,
      point.id,
      CONVERT(DECIMAL(19,2), 0),
      0
    FROM dbo.replenish_work_order_points point
    WHERE point.work_order_id = @workOrderId
      AND NOT EXISTS (
        SELECT 1
        FROM dbo.cpc_packing_tid_assets existing
        WHERE existing.batch_id = @batchId
          AND existing.work_order_point_id = point.id
      );

    SELECT @batchId AS batch_id;
  `)

  return Number(result.recordset[0]?.batch_id || 0) || null
}

export async function acquireCpcPackingOperatorLock(executor, userId) {
  const result = await createRequest(executor)
    .input("userId", sql.Int, userId)
    .query(`
      DECLARE @lockResult INT;
      DECLARE @lockResource NVARCHAR(255) = CONCAT(N'cpc-packing-user:', CONVERT(NVARCHAR(20), @userId));

      EXEC @lockResult = sys.sp_getapplock
        @Resource = @lockResource,
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = 5000;

      IF @lockResult < 0
        THROW 54314, 'Job CPC user sedang diproses transaksi lain. Coba kembali.', 1;

      SELECT @lockResult AS lock_result;
    `)

  return Number(result.recordset[0]?.lock_result ?? -999)
}

export async function getActiveCpcPackingWorkOrderForUser(executor, userId, { excludeWorkOrderId = null } = {}) {
  const result = await createRequest(executor)
    .input("userId", sql.Int, userId)
    .input("excludeWorkOrderId", sql.BigInt, excludeWorkOrderId)
    .query(`
      SELECT TOP (1)
        batch.id AS batch_id,
        batch.work_order_id,
        wo.work_order_no,
        wo.status AS work_order_status,
        batch.status AS packing_status,
        CONVERT(CHAR(19), batch.packing_claimed_at, 126) AS packing_claimed_at
      FROM dbo.cpc_packing_batches batch
      INNER JOIN dbo.replenish_work_orders wo ON wo.id = batch.work_order_id
      WHERE batch.packing_owner_user_id = @userId
        AND wo.status = 'KASET_DALAM_PERSIAPAN'
        AND (@excludeWorkOrderId IS NULL OR batch.work_order_id <> @excludeWorkOrderId)
      ORDER BY batch.packing_claimed_at ASC, batch.id ASC;
    `)

  const row = result.recordset[0] || null
  return row ? {
    batchId: Number(row.batch_id || 0) || null,
    workOrderId: Number(row.work_order_id || 0) || null,
    workOrderNo: row.work_order_no || null,
    workOrderStatus: row.work_order_status || null,
    packingStatus: row.packing_status || null,
    packingClaimedAt: row.packing_claimed_at || null,
  } : null
}

export async function claimCpcPackingWorkOrder(executor, workOrderId, userId) {
  const result = await createRequest(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("userId", sql.Int, userId)
    .query(`
      DECLARE @batchId BIGINT;
      DECLARE @ownerUserId INT;
      DECLARE @ownerName NVARCHAR(255);
      DECLARE @legacyAssigneeCount INT;
      DECLARE @activeWorkOrderId BIGINT;
      DECLARE @activeWorkOrderNo VARCHAR(40);
      DECLARE @activeErrorMessage NVARCHAR(2048);
      DECLARE @userLockResult INT;
      DECLARE @userLockResource NVARCHAR(255) = CONCAT(N'cpc-packing-user:', CONVERT(NVARCHAR(20), @userId));

      /*
        Serialize claim lintas Work Order untuk user yang sama. Row lock per batch
        saja tidak cukup karena dua tab dapat meng-claim dua WO berbeda secara
        bersamaan. Application lock ini membuat aturan satu user = satu job aktif
        tetap atomic di database.
      */
      EXEC @userLockResult = sys.sp_getapplock
        @Resource = @userLockResource,
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = 5000;

      IF @userLockResult < 0
        THROW 54314, 'Job CPC Anda sedang diproses transaksi lain. Coba kembali.', 1;

      SELECT TOP (1)
        @batchId = batch.id,
        @ownerUserId = batch.packing_owner_user_id
      FROM dbo.cpc_packing_batches batch WITH (UPDLOCK, HOLDLOCK)
      WHERE batch.work_order_id = @workOrderId;

      IF @batchId IS NULL
        THROW 54310, 'Batch packing CPC belum tersedia.', 1;

      /*
        Jika WO ini memang sudah dimiliki user, dia tetap boleh melanjutkan.
        Pengecekan job lain hanya dilakukan ketika hendak mengambil WO baru.
        Ini juga menjaga kompatibilitas terhadap assignment lama yang mungkin
        sudah ada sebelum aturan single-active-job diterapkan.
      */
      IF @ownerUserId IS NULL
      BEGIN
        SELECT TOP (1)
          @activeWorkOrderId = other_batch.work_order_id,
          @activeWorkOrderNo = other_wo.work_order_no
        FROM dbo.cpc_packing_batches other_batch WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN dbo.replenish_work_orders other_wo WITH (UPDLOCK, HOLDLOCK)
          ON other_wo.id = other_batch.work_order_id
        WHERE other_batch.packing_owner_user_id = @userId
          AND other_batch.work_order_id <> @workOrderId
          AND other_wo.status = 'KASET_DALAM_PERSIAPAN'
        ORDER BY other_batch.packing_claimed_at ASC, other_batch.id ASC;

        IF @activeWorkOrderId IS NOT NULL
        BEGIN
          SET @activeErrorMessage = CONCAT('Anda masih mengerjakan ', @activeWorkOrderNo, '. Selesaikan dan ajukan job tersebut sebelum mengambil Work Order lain.');
          THROW 54315, @activeErrorMessage, 1;
        END;

        SELECT @legacyAssigneeCount = COUNT(DISTINCT asset.assigned_to)
        FROM dbo.cpc_packing_tid_assets asset WITH (UPDLOCK, HOLDLOCK)
        WHERE asset.batch_id = @batchId
          AND asset.assigned_to IS NOT NULL
          AND asset.assigned_to <> @userId;

        IF @legacyAssigneeCount > 0
          THROW 54311, 'Work Order memiliki assignment packing legacy dari petugas lain. Supervisor CPC harus mengalihkan job terlebih dahulu.', 1;

        UPDATE dbo.cpc_packing_batches
        SET
          packing_owner_user_id = @userId,
          packing_claimed_at = SYSDATETIME(),
          updated_at = SYSDATETIME()
        WHERE id = @batchId
          AND packing_owner_user_id IS NULL;

        SELECT @ownerUserId = packing_owner_user_id
        FROM dbo.cpc_packing_batches WITH (UPDLOCK, HOLDLOCK)
        WHERE id = @batchId;
      END;

      SELECT @ownerName = users.full_name
      FROM dbo.users users
      WHERE users.id = @ownerUserId;

      IF @ownerUserId = @userId
      BEGIN
        UPDATE asset
        SET
          assigned_to = @userId,
          assigned_at = COALESCE(asset.assigned_at, SYSDATETIME()),
          assignment_status = CASE
            WHEN asset.assignment_status = 'PACKING_COMPLETE' THEN 'PACKING_COMPLETE'
            WHEN asset.started_at IS NOT NULL
              OR asset.reject_cassette_serial IS NOT NULL
              OR asset.reject_cassette_seal_no IS NOT NULL
              OR asset.departure_bag_seal_no IS NOT NULL
              OR asset.return_bag_seal_no IS NOT NULL
              OR EXISTS (
                SELECT 1
                FROM dbo.cpc_packing_cassettes cassette
                WHERE cassette.batch_id = asset.batch_id
                  AND cassette.work_order_point_id = asset.work_order_point_id
                  AND (cassette.cassette_serial IS NOT NULL OR cassette.seal_no IS NOT NULL)
              ) THEN 'IN_PROGRESS'
            ELSE 'ASSIGNED'
          END,
          updated_at = SYSDATETIME()
        FROM dbo.cpc_packing_tid_assets asset
        WHERE asset.batch_id = @batchId;
      END;

      SELECT
        @batchId AS batch_id,
        @ownerUserId AS packing_owner_user_id,
        @ownerName AS packing_owner_name,
        CASE WHEN @ownerUserId = @userId THEN CONVERT(BIT, 1) ELSE CONVERT(BIT, 0) END AS is_owner;
    `)

  const row = result.recordset[0] || null
  return row ? {
    batchId: Number(row.batch_id || 0) || null,
    packingOwnerUserId: Number(row.packing_owner_user_id || 0) || null,
    packingOwnerName: row.packing_owner_name || null,
    isOwner: Boolean(row.is_owner),
  } : null
}

export async function transferCpcPackingWorkOrder(executor, workOrderId, targetUserId) {
  const result = await createRequest(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("targetUserId", sql.Int, targetUserId)
    .query(`
      DECLARE @batchId BIGINT;
      DECLARE @previousOwnerUserId INT;
      DECLARE @activeWorkOrderId BIGINT;
      DECLARE @activeWorkOrderNo VARCHAR(40);
      DECLARE @activeErrorMessage NVARCHAR(2048);
      DECLARE @userLockResult INT;
      DECLARE @userLockResource NVARCHAR(255) = CONCAT(N'cpc-packing-user:', CONVERT(NVARCHAR(20), @targetUserId));

      EXEC @userLockResult = sys.sp_getapplock
        @Resource = @userLockResource,
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = 5000;

      IF @userLockResult < 0
        THROW 54314, 'Job CPC petugas tujuan sedang diproses transaksi lain. Coba kembali.', 1;

      SELECT TOP (1)
        @batchId = batch.id,
        @previousOwnerUserId = batch.packing_owner_user_id
      FROM dbo.cpc_packing_batches batch WITH (UPDLOCK, HOLDLOCK)
      WHERE batch.work_order_id = @workOrderId;

      IF @batchId IS NULL
        THROW 54310, 'Batch packing CPC belum tersedia.', 1;

      SELECT TOP (1)
        @activeWorkOrderId = other_batch.work_order_id,
        @activeWorkOrderNo = other_wo.work_order_no
      FROM dbo.cpc_packing_batches other_batch WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN dbo.replenish_work_orders other_wo WITH (UPDLOCK, HOLDLOCK)
        ON other_wo.id = other_batch.work_order_id
      WHERE other_batch.packing_owner_user_id = @targetUserId
        AND other_batch.work_order_id <> @workOrderId
        AND other_wo.status = 'KASET_DALAM_PERSIAPAN'
      ORDER BY other_batch.packing_claimed_at ASC, other_batch.id ASC;

      IF @activeWorkOrderId IS NOT NULL
      BEGIN
        SET @activeErrorMessage = CONCAT('Petugas tujuan masih mengerjakan ', @activeWorkOrderNo, '. Selesaikan job aktif tersebut sebelum menerima pengalihan Work Order lain.');
        THROW 54316, @activeErrorMessage, 1;
      END;

      UPDATE dbo.cpc_packing_batches
      SET
        packing_owner_user_id = @targetUserId,
        packing_claimed_at = SYSDATETIME(),
        updated_at = SYSDATETIME()
      WHERE id = @batchId;

      UPDATE asset
      SET
        assigned_to = @targetUserId,
        assigned_at = SYSDATETIME(),
        assignment_status = CASE
          WHEN asset.assignment_status = 'PACKING_COMPLETE' THEN 'PACKING_COMPLETE'
          WHEN asset.started_at IS NOT NULL
            OR asset.reject_cassette_serial IS NOT NULL
            OR asset.reject_cassette_seal_no IS NOT NULL
            OR asset.departure_bag_seal_no IS NOT NULL
            OR asset.return_bag_seal_no IS NOT NULL
            OR EXISTS (
              SELECT 1
              FROM dbo.cpc_packing_cassettes cassette
              WHERE cassette.batch_id = asset.batch_id
                AND cassette.work_order_point_id = asset.work_order_point_id
                AND (cassette.cassette_serial IS NOT NULL OR cassette.seal_no IS NOT NULL)
            ) THEN 'IN_PROGRESS'
          ELSE 'ASSIGNED'
        END,
        updated_at = SYSDATETIME()
      FROM dbo.cpc_packing_tid_assets asset
      WHERE asset.batch_id = @batchId;

      SELECT
        @batchId AS batch_id,
        @previousOwnerUserId AS previous_owner_user_id,
        @targetUserId AS packing_owner_user_id;
    `)

  const row = result.recordset[0] || null
  return row ? {
    batchId: Number(row.batch_id || 0) || null,
    previousOwnerUserId: Number(row.previous_owner_user_id || 0) || null,
    packingOwnerUserId: Number(row.packing_owner_user_id || 0) || null,
  } : null
}

export async function releaseCpcPackingWorkOrder(executor, workOrderId, userId) {
  const result = await createRequest(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("userId", sql.Int, userId)
    .query(`
      DECLARE @batchId BIGINT;
      DECLARE @ownerUserId INT;
      DECLARE @hasPackingData BIT = 0;

      SELECT TOP (1)
        @batchId = batch.id,
        @ownerUserId = batch.packing_owner_user_id
      FROM dbo.cpc_packing_batches batch WITH (UPDLOCK, HOLDLOCK)
      WHERE batch.work_order_id = @workOrderId;

      IF @batchId IS NULL
        THROW 54310, 'Batch packing CPC belum tersedia.', 1;

      IF @ownerUserId IS NULL OR @ownerUserId <> @userId
        THROW 54312, 'Work Order hanya dapat dikembalikan oleh petugas CPC yang sedang memilikinya.', 1;

      IF EXISTS (
        SELECT 1
        FROM dbo.cpc_packing_tid_assets asset WITH (UPDLOCK, HOLDLOCK)
        WHERE asset.batch_id = @batchId
          AND (
            asset.started_at IS NOT NULL
            OR asset.reject_cassette_serial IS NOT NULL
            OR asset.reject_cassette_seal_no IS NOT NULL
            OR asset.departure_bag_seal_no IS NOT NULL
            OR asset.return_bag_seal_no IS NOT NULL
          )
      ) OR EXISTS (
        SELECT 1
        FROM dbo.cpc_packing_cassettes cassette WITH (UPDLOCK, HOLDLOCK)
        WHERE cassette.batch_id = @batchId
          AND (cassette.cassette_serial IS NOT NULL OR cassette.seal_no IS NOT NULL)
      )
        SET @hasPackingData = 1;

      IF @hasPackingData = 1
        THROW 54313, 'Work Order yang sudah mulai discan tidak dapat dikembalikan ke antrean. Supervisor CPC dapat mengalihkan seluruh job ke petugas lain.', 1;

      UPDATE dbo.cpc_packing_batches
      SET
        packing_owner_user_id = NULL,
        packing_claimed_at = NULL,
        updated_at = SYSDATETIME()
      WHERE id = @batchId
        AND packing_owner_user_id = @userId;

      UPDATE dbo.cpc_packing_tid_assets
      SET
        assigned_to = NULL,
        assigned_at = NULL,
        assignment_status = 'UNASSIGNED',
        updated_at = SYSDATETIME()
      WHERE batch_id = @batchId;

      SELECT @batchId AS batch_id;
    `)

  return Number(result.recordset[0]?.batch_id || 0) || null
}

export async function getCpcPackingSnapshot(executor, workOrderId, { lock = false } = {}) {
  const hint = lock ? " WITH (UPDLOCK, HOLDLOCK)" : ""
  const result = await createRequest(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .query(`
      SELECT TOP (1)
        batch.id,
        batch.work_order_id,
        batch.status,
        batch.packing_notes,
        batch.packing_owner_user_id,
        packing_owner.full_name AS packing_owner_name,
        CONVERT(CHAR(19), batch.packing_claimed_at, 126) AS packing_claimed_at,
        batch.created_by,
        creator.full_name AS created_by_name,
        batch.submitted_by,
        submitter.full_name AS submitted_by_name,
        CONVERT(CHAR(19), batch.submitted_at, 126) AS submitted_at,
        batch.approved_by,
        approver.full_name AS approved_by_name,
        CONVERT(CHAR(19), batch.approved_at, 126) AS approved_at,
        batch.rejected_by,
        rejector.full_name AS rejected_by_name,
        CONVERT(CHAR(19), batch.rejected_at, 126) AS rejected_at,
        batch.approval_notes,
        CONVERT(CHAR(19), batch.created_at, 126) AS created_at,
        CONVERT(CHAR(19), batch.updated_at, 126) AS updated_at,
        CONVERT(VARCHAR(18), batch.row_version, 1) AS row_version
      FROM dbo.cpc_packing_batches batch${hint}
      LEFT JOIN dbo.users packing_owner ON packing_owner.id = batch.packing_owner_user_id
      LEFT JOIN dbo.users creator ON creator.id = batch.created_by
      LEFT JOIN dbo.users submitter ON submitter.id = batch.submitted_by
      LEFT JOIN dbo.users approver ON approver.id = batch.approved_by
      LEFT JOIN dbo.users rejector ON rejector.id = batch.rejected_by
      WHERE batch.work_order_id = @workOrderId;

      SELECT
        cassette.id,
        cassette.batch_id,
        cassette.work_order_point_id,
        point.sequence_no,
        point.activity_type,
        machine.tid,
        machine.sn,
        machine.lokasi,
        machine.kategori_mesin,
        cassette.cassette_no,
        cassette.spare_cassette_id,
        cassette.cassette_serial,
        cassette.denomination_value,
        cassette.sheets_count,
        CONVERT(DECIMAL(19,2), cassette.denomination_value * cassette.sheets_count) AS amount,
        cassette.seal_no,
        cassette.packed_by,
        packer.full_name AS packed_by_name,
        CONVERT(CHAR(19), cassette.packed_at, 126) AS packed_at,
        cassette.sealed_by,
        sealer.full_name AS sealed_by_name,
        CONVERT(CHAR(19), cassette.sealed_at, 126) AS sealed_at,
        cassette.spare_assigned_by,
        spare_allocator.full_name AS spare_assigned_by_name,
        CONVERT(CHAR(19), cassette.spare_assigned_at, 126) AS spare_assigned_at,
        CONVERT(CHAR(19), cassette.updated_at, 126) AS updated_at,
        CONVERT(VARCHAR(18), cassette.row_version, 1) AS row_version
      FROM dbo.cpc_packing_cassettes cassette${hint}
      INNER JOIN dbo.replenish_work_order_points point ON point.id = cassette.work_order_point_id
      INNER JOIN dbo.master_mesin machine ON machine.id = point.machine_id
      LEFT JOIN dbo.users packer ON packer.id = cassette.packed_by
      LEFT JOIN dbo.users sealer ON sealer.id = cassette.sealed_by
      LEFT JOIN dbo.users spare_allocator ON spare_allocator.id = cassette.spare_assigned_by
      WHERE point.work_order_id = @workOrderId
      ORDER BY point.sequence_no, cassette.cassette_no;

      SELECT
        asset.id,
        asset.batch_id,
        asset.work_order_point_id,
        point.sequence_no,
        point.activity_type,
        machine.tid,
        machine.sn,
        machine.lokasi,
        machine.kategori_mesin,
        asset.reject_cassette_serial,
        asset.reject_cassette_seal_no,
        asset.reject_denomination_value,
        asset.reject_sheets_count,
        CONVERT(DECIMAL(19,2), 0) AS reject_amount,
        asset.departure_bag_seal_no,
        asset.return_bag_seal_no,
        asset.prepared_by,
        preparer.full_name AS prepared_by_name,
        CONVERT(CHAR(19), asset.prepared_at, 126) AS prepared_at,
        asset.assigned_to,
        assignee.full_name AS assigned_to_name,
        asset.assignment_status,
        CONVERT(CHAR(19), asset.assigned_at, 126) AS assigned_at,
        asset.started_by,
        starter.full_name AS started_by_name,
        CONVERT(CHAR(19), asset.started_at, 126) AS started_at,
        asset.completed_by,
        completer.full_name AS completed_by_name,
        CONVERT(CHAR(19), asset.completed_at, 126) AS completed_at,
        CONVERT(CHAR(19), asset.updated_at, 126) AS updated_at,
        CONVERT(VARCHAR(18), asset.row_version, 1) AS row_version
      FROM dbo.cpc_packing_tid_assets asset${hint}
      INNER JOIN dbo.replenish_work_order_points point ON point.id = asset.work_order_point_id
      INNER JOIN dbo.master_mesin machine ON machine.id = point.machine_id
      LEFT JOIN dbo.users preparer ON preparer.id = asset.prepared_by
      LEFT JOIN dbo.users assignee ON assignee.id = asset.assigned_to
      LEFT JOIN dbo.users starter ON starter.id = asset.started_by
      LEFT JOIN dbo.users completer ON completer.id = asset.completed_by
      WHERE point.work_order_id = @workOrderId
      ORDER BY point.sequence_no, asset.id;
    `)

  const batch = result.recordsets?.[0]?.[0] || null
  const items = (result.recordsets?.[1] || []).map((item) => ({
    ...item,
    denomination_value: Number(item.denomination_value || 0),
    sheets_count: Number(item.sheets_count || 0),
    amount: Number(item.amount || 0),
    row_version: normalizeRowVersionToken(item.row_version),
  }))
  const tidAssets = (result.recordsets?.[2] || []).map((item) => ({
    ...item,
    reject_denomination_value: Number(item.reject_denomination_value || 0),
    reject_sheets_count: Number(item.reject_sheets_count || 0),
    reject_amount: Number(item.reject_amount || 0),
    row_version: normalizeRowVersionToken(item.row_version),
  }))

  const completed = items.filter((item) => item.cassette_serial && item.seal_no).length
  const sealed = items.filter((item) => item.seal_no).length
  const completedReject = tidAssets.filter((item) => item.reject_cassette_serial).length
  const completedRejectSeals = tidAssets.filter((item) => item.reject_cassette_seal_no).length
  const completedBagSeals = tidAssets.reduce((count, item) => (
    count
      + (item.departure_bag_seal_no ? 1 : 0)
      + (item.return_bag_seal_no ? 1 : 0)
  ), 0)
  const cashCompleteByPoint = new Map()
  for (const item of items) {
    const pointId = Number(item.work_order_point_id)
    const current = cashCompleteByPoint.get(pointId) || { expected: 0, completed: 0 }
    current.expected += 1
    if (item.cassette_serial && item.seal_no) current.completed += 1
    cashCompleteByPoint.set(pointId, current)
  }
  const completedTids = tidAssets.filter((asset) => {
    const cash = cashCompleteByPoint.get(Number(asset.work_order_point_id)) || { expected: 0, completed: 0 }
    return cash.completed === cash.expected
      && Boolean(asset.reject_cassette_serial)
      && Boolean(asset.reject_cassette_seal_no)
      && Boolean(asset.departure_bag_seal_no)
      && Boolean(asset.return_bag_seal_no)
  }).length
  const hasTidExtension = tidAssets.length > 0
  const legacyAllComplete = items.length > 0 && completed === items.length
  const allComplete = hasTidExtension
    ? completed === items.length && completedTids === tidAssets.length
    : legacyAllComplete

  return {
    batch: batch ? { ...batch, row_version: normalizeRowVersionToken(batch.row_version) } : null,
    items,
    tid_assets: tidAssets,
    summary: {
      expected_cassettes: items.length,
      completed_cassettes: completed,
      sealed_cassettes: sealed,
      expected_reject_cassettes: tidAssets.length,
      completed_reject_cassettes: completedReject,
      expected_reject_cassette_seals: tidAssets.length,
      completed_reject_cassette_seals: completedRejectSeals,
      expected_bag_seals: tidAssets.length * 2,
      completed_bag_seals: completedBagSeals,
      expected_tids: tidAssets.length,
      completed_tids: completedTids,
      unassigned_tids: tidAssets.filter((item) => item.assignment_status === "UNASSIGNED").length,
      assigned_tids: tidAssets.filter((item) => item.assignment_status === "ASSIGNED").length,
      in_progress_tids: tidAssets.filter((item) => item.assignment_status === "IN_PROGRESS").length,
      packing_complete_tids: tidAssets.filter((item) => item.assignment_status === "PACKING_COMPLETE").length,
      per_tid_enabled: hasTidExtension,
      all_complete: allComplete,
    },
  }
}

export async function getLockedCpcPackingBatch(executor, workOrderId) {
  const snapshot = await getCpcPackingSnapshot(executor, workOrderId, { lock: true })
  return snapshot
}


export async function listCpcPackingOperators(executor, scopeCodeUker = null) {
  const result = await createRequest(executor)
    .input("menuHref", sql.VarChar(200), CPC_MENU_HREF)
    .input("scopeCodeUker", sql.NVarChar(4), scopeCodeUker)
    .query(`
      SELECT
        users.id,
        users.username,
        users.full_name,
        users.codeuker,
        roles.role_code,
        roles.role_name,
        pegawai.jabatan AS pegawai_jabatan
      FROM dbo.users users
      INNER JOIN dbo.roles roles ON roles.id = users.role_id
      INNER JOIN dbo.role_sidebar_routes permission ON permission.role_id = users.role_id
      INNER JOIN dbo.sidebar_routes route ON route.id = permission.sidebar_route_id
      LEFT JOIN dbo.pegawai pegawai ON pegawai.id = users.pegawai_id
      WHERE users.is_active = 1
        AND roles.is_active = 1
        AND route.is_active = 1
        AND route.href = @menuHref
        AND permission.can_view = 1
        AND permission.can_update = 1
        AND (@scopeCodeUker IS NULL OR users.codeuker = @scopeCodeUker)
      ORDER BY users.full_name, users.id;
    `)

  return result.recordset.map((item) => ({
    id: Number(item.id),
    username: item.username,
    full_name: item.full_name,
    codeuker: item.codeuker,
    role_code: item.role_code,
    role_name: item.role_name,
    pegawai_jabatan: item.pegawai_jabatan,
  }))
}

export async function getLockedCpcPackingTidAsset(executor, workOrderId, workOrderPointId) {
  const result = await createRequest(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("workOrderPointId", sql.BigInt, workOrderPointId)
    .query(`
      SELECT TOP (1)
        asset.id,
        asset.batch_id,
        asset.work_order_point_id,
        asset.assigned_to,
        asset.assignment_status,
        asset.assigned_at,
        asset.started_by,
        asset.started_at,
        asset.completed_by,
        asset.completed_at,
        asset.reject_cassette_serial,
        asset.reject_cassette_seal_no,
        asset.departure_bag_seal_no,
        asset.return_bag_seal_no,
        machine.tid,
        machine.sn,
        machine.lokasi,
        assignee.full_name AS assigned_to_name
      FROM dbo.cpc_packing_tid_assets asset WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN dbo.cpc_packing_batches batch ON batch.id = asset.batch_id
      INNER JOIN dbo.replenish_work_order_points point ON point.id = asset.work_order_point_id
      INNER JOIN dbo.master_mesin machine ON machine.id = point.machine_id
      LEFT JOIN dbo.users assignee ON assignee.id = asset.assigned_to
      WHERE batch.work_order_id = @workOrderId
        AND point.work_order_id = @workOrderId
        AND asset.work_order_point_id = @workOrderPointId;
    `)

  return result.recordset[0] || null
}

export async function ensureCpcCassetteHandover(executor, workOrderId, userId) {
  const result = await createRequest(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .input("userId", sql.Int, userId)
    .query(`
      DECLARE @packingBatchId BIGINT = (
        SELECT TOP (1) id
        FROM dbo.cpc_packing_batches WITH (UPDLOCK, HOLDLOCK)
        WHERE work_order_id = @workOrderId
          AND status = 'DISETUJUI'
      );

      IF @packingBatchId IS NULL
        THROW 54010, 'Packing CPC belum disetujui.', 1;

      IF NOT EXISTS (
        SELECT 1
        FROM dbo.replenish_team_members WITH (UPDLOCK, HOLDLOCK)
        WHERE work_order_id = @workOrderId
          AND member_role = 'CUSTODY'
      )
        THROW 54011, 'Custody penerima belum ditetapkan pada Work Order.', 1;

      IF EXISTS (
        SELECT 1
        FROM dbo.cpc_packing_cassettes cassette
        WHERE cassette.batch_id = @packingBatchId
          AND (cassette.cassette_serial IS NULL OR cassette.seal_no IS NULL)
      )
        THROW 54012, 'Packing kaset belum lengkap.', 1;

      IF NOT EXISTS (
        SELECT 1
        FROM dbo.cpc_cassette_handovers WITH (UPDLOCK, HOLDLOCK)
        WHERE work_order_id = @workOrderId
      )
      BEGIN
        INSERT INTO dbo.cpc_cassette_handovers
          (work_order_id, packing_batch_id, custody_employee_id, status, created_by)
        SELECT TOP (1)
          @workOrderId,
          @packingBatchId,
          employee_id,
          'VERIFIKASI',
          @userId
        FROM dbo.replenish_team_members WITH (UPDLOCK, HOLDLOCK)
        WHERE work_order_id = @workOrderId
          AND member_role = 'CUSTODY'
        ORDER BY id;
      END;

      DECLARE @handoverId BIGINT = (
        SELECT TOP (1) id
        FROM dbo.cpc_cassette_handovers WITH (UPDLOCK, HOLDLOCK)
        WHERE work_order_id = @workOrderId
      );

      INSERT INTO dbo.cpc_cassette_handover_items
        (handover_id, packing_cassette_id, expected_seal_no)
      SELECT
        @handoverId,
        cassette.id,
        cassette.seal_no
      FROM dbo.cpc_packing_cassettes cassette
      WHERE cassette.batch_id = @packingBatchId
        AND cassette.seal_no IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM dbo.cpc_cassette_handover_items existing
          WHERE existing.handover_id = @handoverId
            AND existing.packing_cassette_id = cassette.id
        );

      SELECT @handoverId AS handover_id;
    `)

  return Number(result.recordset[0]?.handover_id || 0) || null
}

export async function getCpcCassetteHandoverSnapshot(executor, workOrderId, { lock = false } = {}) {
  const hint = lock ? " WITH (UPDLOCK, HOLDLOCK)" : ""
  const result = await createRequest(executor)
    .input("workOrderId", sql.BigInt, workOrderId)
    .query(`
      SELECT TOP (1)
        handover.id,
        handover.work_order_id,
        handover.packing_batch_id,
        handover.custody_employee_id,
        custody.nip AS custody_nip,
        custody.nama AS custody_name,
        custody.jabatan AS custody_jabatan,
        handover.status,
        handover.handover_notes,
        handover.created_by,
        creator.full_name AS created_by_name,
        handover.completed_by,
        completer.full_name AS completed_by_name,
        CONVERT(CHAR(19), handover.completed_at, 126) AS completed_at,
        handover.recipient_nip_snapshot,
        handover.recipient_name_snapshot,
        CONVERT(CHAR(19), handover.created_at, 126) AS created_at,
        CONVERT(CHAR(19), handover.updated_at, 126) AS updated_at,
        CONVERT(VARCHAR(18), handover.row_version, 1) AS row_version
      FROM dbo.cpc_cassette_handovers handover${hint}
      INNER JOIN dbo.pegawai custody ON custody.id = handover.custody_employee_id
      LEFT JOIN dbo.users creator ON creator.id = handover.created_by
      LEFT JOIN dbo.users completer ON completer.id = handover.completed_by
      WHERE handover.work_order_id = @workOrderId;

      SELECT
        item.id,
        item.handover_id,
        item.packing_cassette_id,
        point.sequence_no,
        machine.tid,
        machine.sn,
        machine.lokasi,
        cassette.cassette_no,
        cassette.cassette_serial,
        cassette.denomination_value,
        cassette.sheets_count,
        CONVERT(DECIMAL(19,2), cassette.denomination_value * cassette.sheets_count) AS amount,
        item.expected_seal_no,
        item.scanned_seal_no,
        item.verified_by,
        verifier.full_name AS verified_by_name,
        CONVERT(CHAR(19), item.verified_at, 126) AS verified_at,
        CONVERT(CHAR(19), item.updated_at, 126) AS updated_at,
        CONVERT(VARCHAR(18), item.row_version, 1) AS row_version
      FROM dbo.cpc_cassette_handover_items item${hint}
      INNER JOIN dbo.cpc_cassette_handovers handover ON handover.id = item.handover_id
      INNER JOIN dbo.cpc_packing_cassettes cassette ON cassette.id = item.packing_cassette_id
      INNER JOIN dbo.replenish_work_order_points point ON point.id = cassette.work_order_point_id
      INNER JOIN dbo.master_mesin machine ON machine.id = point.machine_id
      LEFT JOIN dbo.users verifier ON verifier.id = item.verified_by
      WHERE handover.work_order_id = @workOrderId
      ORDER BY point.sequence_no, cassette.cassette_no;
    `)

  const handover = result.recordsets?.[0]?.[0] || null
  const items = (result.recordsets?.[1] || []).map((item) => ({
    ...item,
    denomination_value: Number(item.denomination_value || 0),
    sheets_count: Number(item.sheets_count || 0),
    amount: Number(item.amount || 0),
    row_version: normalizeRowVersionToken(item.row_version),
  }))
  const verified = items.filter((item) => item.scanned_seal_no && item.scanned_seal_no === item.expected_seal_no).length

  return {
    handover: handover ? { ...handover, row_version: normalizeRowVersionToken(handover.row_version) } : null,
    items,
    summary: {
      expected_cassettes: items.length,
      verified_cassettes: verified,
      all_verified: items.length > 0 && verified === items.length,
      completed: handover?.status === "SELESAI",
    },
  }
}

export async function getLockedCpcCassetteHandover(executor, workOrderId) {
  return getCpcCassetteHandoverSnapshot(executor, workOrderId, { lock: true })
}

export async function listCpcPackingKpis(executor, {
  scopeUkerId = null,
  dateFrom,
  dateTo,
  searchPattern = "%",
  operatorUserId = null,
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
    .input("operatorUserId", sql.Int, operatorUserId)
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
        batch.id AS batch_id,
        batch.created_at AS batch_created_at,
        batch.submitted_by,
        submitter.full_name AS submitted_by_name,
        batch.submitted_at,
        batch.approved_by,
        approver.full_name AS approved_by_name,
        batch.approved_at,
        COALESCE(needs.total_cassettes, 0) AS total_cassettes
      INTO #eligible_cpc_kpi
      FROM dbo.cpc_packing_batches batch
      INNER JOIN dbo.replenish_work_orders wo ON wo.id = batch.work_order_id
      INNER JOIN dbo.master_uker uker ON uker.id = wo.uker_id
      LEFT JOIN dbo.users submitter ON submitter.id = batch.submitted_by
      LEFT JOIN dbo.users approver ON approver.id = batch.approved_by
      OUTER APPLY (
        SELECT COALESCE(SUM(CONVERT(BIGINT, point.required_cassettes)), 0) AS total_cassettes
        FROM dbo.replenish_work_order_points point
        WHERE point.work_order_id = wo.id
      ) needs
      WHERE batch.status = 'DISETUJUI'
        AND batch.approved_at IS NOT NULL
        AND batch.approved_at >= CONVERT(DATE, @dateFrom, 23)
        AND batch.approved_at < DATEADD(DAY, 1, CONVERT(DATE, @dateTo, 23))
        AND (@scopeUkerId IS NULL OR wo.uker_id = @scopeUkerId)
        AND (
          @search = '%'
          OR wo.work_order_no LIKE @search ESCAPE '\\'
          OR uker.codeuker LIKE @search ESCAPE '\\'
          OR uker.nama_uker LIKE @search ESCAPE '\\'
          OR submitter.full_name LIKE @search ESCAPE '\\'
          OR approver.full_name LIKE @search ESCAPE '\\'
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
        history.actor_user_id,
        history.created_at,
        LEAD(history.action) OVER (
          PARTITION BY history.work_order_id
          ORDER BY history.id
        ) AS next_action,
        LEAD(history.created_at) OVER (
          PARTITION BY history.work_order_id
          ORDER BY history.id
        ) AS next_created_at
      INTO #cpc_kpi_events
      FROM dbo.replenish_status_history history
      INNER JOIN #eligible_cpc_kpi eligible ON eligible.work_order_id = history.work_order_id
      WHERE history.action IN (
        'CPC_RECEIVE_REQUEST',
        'CPC_START_PREPARATION',
        'CPC_SUBMIT_APPROVAL',
        'CPC_APPROVE_PACKING',
        'CPC_REJECT_PACKING'
      );

      SELECT
        event.work_order_id,
        MIN(CASE
          WHEN event.action IN ('CPC_RECEIVE_REQUEST', 'CPC_START_PREPARATION')
            THEN event.created_at
        END) AS packing_started_at,
        SUM(CASE
          WHEN event.action IN ('CPC_RECEIVE_REQUEST', 'CPC_START_PREPARATION', 'CPC_REJECT_PACKING')
            AND event.next_action = 'CPC_SUBMIT_APPROVAL'
            THEN DATEDIFF_BIG(SECOND, event.created_at, event.next_created_at)
          ELSE CONVERT(BIGINT, 0)
        END) AS packing_duration_seconds,
        SUM(CASE
          WHEN event.action = 'CPC_SUBMIT_APPROVAL'
            AND event.next_action IN ('CPC_APPROVE_PACKING', 'CPC_REJECT_PACKING')
            THEN DATEDIFF_BIG(SECOND, event.created_at, event.next_created_at)
          ELSE CONVERT(BIGINT, 0)
        END) AS approval_duration_seconds,
        SUM(CASE WHEN event.action = 'CPC_REJECT_PACKING' THEN 1 ELSE 0 END) AS rejection_count
      INTO #cpc_kpi_event_metrics
      FROM #cpc_kpi_events event
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
        eligible.total_cassettes,
        eligible.submitted_by,
        eligible.submitted_by_name,
        eligible.approved_by,
        eligible.approved_by_name,
        COALESCE(metrics.packing_started_at, eligible.batch_created_at) AS packing_started_at,
        eligible.submitted_at AS packing_completed_at,
        eligible.approved_at,
        CASE
          WHEN COALESCE(metrics.packing_duration_seconds, 0) > 0
            THEN metrics.packing_duration_seconds
          WHEN eligible.submitted_at IS NOT NULL
            THEN DATEDIFF_BIG(SECOND, eligible.batch_created_at, eligible.submitted_at)
          ELSE CONVERT(BIGINT, 0)
        END AS packing_duration_seconds,
        CASE
          WHEN COALESCE(metrics.approval_duration_seconds, 0) > 0
            THEN metrics.approval_duration_seconds
          WHEN eligible.submitted_at IS NOT NULL
            THEN DATEDIFF_BIG(SECOND, eligible.submitted_at, eligible.approved_at)
          ELSE CONVERT(BIGINT, 0)
        END AS approval_duration_seconds,
        DATEDIFF_BIG(
          SECOND,
          COALESCE(metrics.packing_started_at, eligible.batch_created_at),
          eligible.approved_at
        ) AS total_duration_seconds,
        COALESCE(metrics.rejection_count, 0) AS rejection_count
      INTO #cpc_kpi
      FROM #eligible_cpc_kpi eligible
      LEFT JOIN #cpc_kpi_event_metrics metrics ON metrics.work_order_id = eligible.work_order_id;

      SELECT TOP (@take)
        work_order_id,
        work_order_no,
        codeuker,
        nama_uker,
        schedule_date,
        activity_type,
        priority,
        total_points,
        total_cassettes,
        submitted_by,
        submitted_by_name,
        approved_by,
        approved_by_name,
        CONVERT(CHAR(19), packing_started_at, 126) AS packing_started_at,
        CONVERT(CHAR(19), packing_completed_at, 126) AS packing_completed_at,
        CONVERT(CHAR(19), approved_at, 126) AS approved_at,
        packing_duration_seconds,
        approval_duration_seconds,
        total_duration_seconds,
        rejection_count
      FROM #cpc_kpi
      WHERE (@operatorUserId IS NULL OR submitted_by = @operatorUserId)
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
        COALESCE(AVG(CONVERT(DECIMAL(20,2), packing_duration_seconds)), 0) AS average_packing_seconds,
        COALESCE(AVG(CONVERT(DECIMAL(20,2), approval_duration_seconds)), 0) AS average_approval_seconds,
        COALESCE(AVG(CONVERT(DECIMAL(20,2), total_duration_seconds)), 0) AS average_total_seconds,
        COALESCE(MAX(total_duration_seconds), 0) AS longest_total_seconds,
        COALESCE(SUM(CONVERT(BIGINT, rejection_count)), 0) AS total_rejections
      FROM #cpc_kpi
      WHERE @operatorUserId IS NULL OR submitted_by = @operatorUserId;

      SELECT DISTINCT
        submitted_by AS user_id,
        submitted_by_name AS full_name
      FROM #cpc_kpi
      WHERE submitted_by IS NOT NULL
      ORDER BY submitted_by_name;

      DROP TABLE #cpc_kpi;
      DROP TABLE #cpc_kpi_event_metrics;
      DROP TABLE #cpc_kpi_events;
      DROP TABLE #eligible_cpc_kpi;
    `)

  const rows = result.recordsets?.[0] || []
  const hasMore = rows.length > pageSize
  const visibleRows = hasMore ? rows.slice(0, pageSize) : rows
  const items = visibleRows.map((item) => ({
    ...item,
    work_order_id: Number(item.work_order_id || 0),
    total_points: Number(item.total_points || 0),
    total_cassettes: Number(item.total_cassettes || 0),
    submitted_by: Number(item.submitted_by || 0) || null,
    approved_by: Number(item.approved_by || 0) || null,
    packing_duration_seconds: Number(item.packing_duration_seconds || 0),
    approval_duration_seconds: Number(item.approval_duration_seconds || 0),
    total_duration_seconds: Number(item.total_duration_seconds || 0),
    rejection_count: Number(item.rejection_count || 0),
  }))
  const summary = result.recordsets?.[1]?.[0] || {}
  const operators = (result.recordsets?.[2] || []).map((item) => ({
    user_id: Number(item.user_id || 0),
    full_name: item.full_name || "-",
  }))
  const lastItem = items.at(-1) || null

  return {
    items,
    summary: {
      total_jobs: Number(summary.total_jobs || 0),
      average_packing_seconds: Number(summary.average_packing_seconds || 0),
      average_approval_seconds: Number(summary.average_approval_seconds || 0),
      average_total_seconds: Number(summary.average_total_seconds || 0),
      longest_total_seconds: Number(summary.longest_total_seconds || 0),
      total_rejections: Number(summary.total_rejections || 0),
    },
    operators,
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
