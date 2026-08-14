import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { runInTransaction, isRetryableSqlError } from "@/lib/database/transaction"
import { readJsonBody, InvalidJsonBodyError, RequestBodyTooLargeError } from "@/lib/http/json-body"
import { connectDB, sql } from "@/lib/mssql"
import { insertAuditLog } from "@/lib/security/audit-log"
import { isCpcPackingApprover } from "@/modules/cpc/authorization"
import { CPC_MENU_HREF, CPC_PACKING_SHEETS_PER_CASSETTE } from "@/modules/cpc/constants"
import {
  acquireCpcPackingOperatorLock,
  claimCpcPackingWorkOrder,
  ensureCpcPackingBatch,
  getActiveCpcPackingWorkOrderForUser,
  getCpcCassetteRequestDetail,
  getLockedCpcPackingBatch,
  getLockedCpcWorkOrder,
  listCpcSpareCassettes,
  listCpcPackingOperators,
  resolveCpcScope,
} from "@/modules/cpc/database"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 128 * 1024
const MAX_ITEMS = 200
const MAX_TIDS = 50
const PACKING_CODE_LOCK = "cpc-packing-code-registry"

class CpcPackingError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = "CpcPackingError"
    this.status = status
  }
}

function normalizeId(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeCode(value, maxLength = 100) {
  const normalized = String(value || "").trim().toUpperCase()
  return normalized ? normalized.slice(0, maxLength) : null
}

function sqlErrorNumber(error) {
  return Number(error?.number || error?.originalError?.info?.number || error?.precedingErrors?.[0]?.number || 0)
}

function errorResponse(message, status = 400) {
  return NextResponse.json({ success: false, message }, { status })
}

function internalError(error, fallbackMessage) {
  console.error(fallbackMessage, error)
  if (isRetryableSqlError(error)) {
    return NextResponse.json(
      { success: false, message: "Data packing sedang diproses pengguna lain. Coba kembali beberapa saat lagi." },
      { status: 503, headers: { "Retry-After": "1" } }
    )
  }
  const number = sqlErrorNumber(error)
  if (number === 2601 || number === 2627) {
    return errorResponse(
      "Seluruh kode kaset dan segel packing harus unik dan tidak boleh dipakai pada field packing lain.",
      409
    )
  }
  return errorResponse(fallbackMessage, 500)
}

function registerUniqueCode(seen, value, label) {
  if (!value) return
  const registeredLabel = seen.get(value)
  if (registeredLabel) {
    throw new CpcPackingError(
      `Kode packing ${value} tidak boleh sama antara ${registeredLabel} dan ${label}.`
    )
  }
  seen.set(value, label)
}

function validatePayload(rawItems, rawTidAssets, expectedItems, expectedTidAssets) {
  if (!Array.isArray(rawItems)) throw new CpcPackingError("Daftar packing kaset wajib dikirim.")
  if (rawItems.length > MAX_ITEMS) throw new CpcPackingError(`Maksimal ${MAX_ITEMS} kaset per penyimpanan.`, 413)
  if (!Array.isArray(rawTidAssets)) throw new CpcPackingError("Daftar packing per TID wajib dikirim.")
  if (rawTidAssets.length === 0) throw new CpcPackingError("Tidak ada TID milik Anda yang berubah untuk disimpan.")
  if (rawTidAssets.length > MAX_TIDS) throw new CpcPackingError(`Maksimal ${MAX_TIDS} TID per penyimpanan.`, 413)

  const expectedById = new Map(expectedItems.map((item) => [Number(item.id), item]))
  const expectedAssetById = new Map(expectedTidAssets.map((item) => [Number(item.id), item]))
  const expectedAssetByPointId = new Map(expectedTidAssets.map((item) => [Number(item.work_order_point_id), item]))
  const seenIds = new Set()
  const seenAssetIds = new Set()
  const selectedPointIds = new Set()

  const tidAssets = rawTidAssets.map((rawAsset) => {
    const submittedId = normalizeId(rawAsset?.id)
    const submittedPointId = normalizeId(rawAsset?.work_order_point_id)
    const expected = submittedId
      ? expectedAssetById.get(submittedId)
      : expectedAssetByPointId.get(submittedPointId)
    const id = normalizeId(expected?.id)
    if (!id || !expected || seenAssetIds.has(id)) {
      throw new CpcPackingError("Packing per TID pada form tidak valid. Muat ulang form packing.", 409)
    }
    seenAssetIds.add(id)

    const workOrderPointId = Number(expected.work_order_point_id)
    selectedPointIds.add(workOrderPointId)

    const rejectCassetteSerial = normalizeCode(rawAsset?.reject_cassette_serial)
    const rejectCassetteSealNo = normalizeCode(rawAsset?.reject_cassette_seal_no)
    const departureBagSealNo = normalizeCode(rawAsset?.departure_bag_seal_no)
    const returnBagSealNo = normalizeCode(rawAsset?.return_bag_seal_no)

    if (rejectCassetteSealNo && !rejectCassetteSerial) {
      throw new CpcPackingError("Serial kaset reject wajib discan sebelum segel kaset reject.")
    }
    if (departureBagSealNo && (!rejectCassetteSerial || !rejectCassetteSealNo)) {
      throw new CpcPackingError("Kaset reject dan segel kaset reject wajib lengkap sebelum Segel BAG Berangkat.")
    }
    if (returnBagSealNo && !departureBagSealNo) {
      throw new CpcPackingError("Segel BAG Berangkat wajib discan sebelum Segel BAG Kembali.")
    }

    return {
      id,
      workOrderPointId,
      tid: expected.tid || expected.sn || String(expected.work_order_point_id),
      rejectCassetteSerial,
      rejectCassetteSealNo,
      departureBagSealNo,
      returnBagSealNo,
    }
  })

  const expectedSelectedItems = expectedItems.filter((item) => selectedPointIds.has(Number(item.work_order_point_id)))
  if (rawItems.length !== expectedSelectedItems.length) {
    throw new CpcPackingError("Jumlah slot kaset pada TID yang disimpan berubah. Muat ulang form packing.", 409)
  }

  const items = rawItems.map((rawItem) => {
    const id = normalizeId(rawItem?.id)
    const expected = expectedById.get(id)
    if (!id || !expected || seenIds.has(id) || !selectedPointIds.has(Number(expected.work_order_point_id))) {
      throw new CpcPackingError("Slot kaset pada form tidak valid. Muat ulang form packing.", 409)
    }
    seenIds.add(id)

    const spareCassetteId = normalizeId(rawItem?.spare_cassette_id)
    const cassetteSerial = normalizeCode(rawItem?.cassette_serial)
    const sealNo = normalizeCode(rawItem?.seal_no)
    if (sealNo && !cassetteSerial) {
      throw new CpcPackingError("Serial kaset wajib diisi sebelum nomor segel discan.")
    }

    return {
      id,
      workOrderPointId: Number(expected.work_order_point_id),
      cassetteNo: Number(expected.cassette_no || 0),
      denominationValue: Number(expected.denomination_value || 0),
      spareCassetteId,
      cassetteSerial,
      sealNo,
    }
  })

  if (seenIds.size !== expectedSelectedItems.length) {
    throw new CpcPackingError("Semua slot kaset pada TID yang disimpan wajib dikirim.", 409)
  }

  for (const pointId of selectedPointIds) {
    const pointItems = items
      .filter((item) => item.workOrderPointId === pointId)
      .sort((left, right) => left.cassetteNo - right.cassetteNo)

    let previousPairComplete = true
    for (const item of pointItems) {
      const hasCurrentValue = Boolean(item.spareCassetteId || item.cassetteSerial || item.sealNo)
      if (hasCurrentValue && !previousPairComplete) {
        throw new CpcPackingError("Selesaikan scan kaset dan segel kaset sebelumnya sebelum melanjutkan ke kaset berikutnya.")
      }
      previousPairComplete = previousPairComplete && Boolean(
        item.spareCassetteId || (item.cassetteSerial && item.sealNo)
      )
    }

    const asset = tidAssets.find((item) => item.workOrderPointId === pointId)
    const hasAssetScan = Boolean(
      asset?.rejectCassetteSerial
      || asset?.rejectCassetteSealNo
      || asset?.departureBagSealNo
      || asset?.returnBagSealNo
    )
    const cashComplete = pointItems.length > 0 && pointItems.every((item) =>
      item.spareCassetteId || (item.cassetteSerial && item.sealNo)
    )
    if (hasAssetScan && !cashComplete) {
      throw new CpcPackingError("Selesaikan seluruh scan kaset uang dan segel kaset pada TID sebelum memproses Kaset Reject.")
    }
  }

  return { items, tidAssets, selectedPointIds }
}

async function resolveSpareCassetteSelections(executor, packing, payload, userId) {
  if (payload.items.length === 0) return payload

  const selectedSpareIds = payload.items.map((item) => item.spareCassetteId).filter(Boolean)
  if (new Set(selectedSpareIds).size !== selectedSpareIds.length) {
    throw new CpcPackingError("Satu spare kaset hanya boleh dipilih untuk satu slot kaset pada Work Order.", 409)
  }

  const selectedBySpareId = new Map()
  if (selectedSpareIds.length > 0) {
    const selectionRequest = new sql.Request(executor)
    const selectionValues = payload.items.filter((item) => item.spareCassetteId).map((item, index) => {
      selectionRequest.input(`selectedSpare${index}`, sql.BigInt, item.spareCassetteId)
      selectionRequest.input(`selectedPacking${index}`, sql.BigInt, item.id)
      return `(@selectedSpare${index}, @selectedPacking${index})`
    })

    const selectedResult = await selectionRequest.query(`
      SELECT
        spare.id,
        source.packing_cassette_id,
        spare.cassette_serial,
        spare.denomination_value,
        spare.sheets_count,
        spare.rubber_seal_no,
        spare.status,
        spare.prepared_by,
        spare.prepared_at,
        spare.allocated_packing_cassette_id
      FROM dbo.cpc_spare_cassettes spare WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN (VALUES ${selectionValues.join(",")}) source(spare_cassette_id, packing_cassette_id)
        ON source.spare_cassette_id = spare.id
      WHERE spare.status = 'READY'
         OR (
           spare.status = 'ALLOCATED'
           AND spare.allocated_packing_cassette_id = source.packing_cassette_id
         );
    `)

    for (const spare of selectedResult.recordset || []) {
      selectedBySpareId.set(Number(spare.id), spare)
    }
    if (selectedBySpareId.size !== selectedSpareIds.length) {
      throw new CpcPackingError("Spare kaset yang dipilih sudah dipakai Work Order lain atau belum selesai disortir.", 409)
    }
  }

  const expectedById = new Map(packing.items.map((item) => [Number(item.id), item]))
  const resolvedItems = payload.items.map((item) => {
    if (!item.spareCassetteId) {
      const expected = expectedById.get(item.id)
      const isLegacyComplete = Boolean(
        !expected?.spare_cassette_id
        && expected?.cassette_serial
        && expected?.seal_no
        && normalizeCode(expected.cassette_serial) === item.cassetteSerial
        && normalizeCode(expected.seal_no) === item.sealNo
      )
      return {
        ...item,
        cassetteSerial: isLegacyComplete ? item.cassetteSerial : null,
        sealNo: isLegacyComplete ? item.sealNo : null,
      }
    }

    const spare = selectedBySpareId.get(item.spareCassetteId)
    if (!spare || !spare.rubber_seal_no || !spare.prepared_by || !spare.prepared_at) {
      throw new CpcPackingError("Spare kaset belum memiliki 2.000 lembar dan segel karet yang lengkap.", 409)
    }
    if (Number(spare.sheets_count) !== CPC_PACKING_SHEETS_PER_CASSETTE) {
      throw new CpcPackingError(`Spare kaset ${spare.cassette_serial} tidak berisi tepat 2.000 lembar.`, 409)
    }
    if (Number(spare.denomination_value) !== Number(item.denominationValue)) {
      throw new CpcPackingError(
        `Spare kaset ${spare.cassette_serial} denom ${Number(spare.denomination_value).toLocaleString("id-ID")} tidak sesuai kebutuhan denom ${Number(item.denominationValue).toLocaleString("id-ID")}.`,
        409
      )
    }

    return {
      ...item,
      cassetteSerial: normalizeCode(spare.cassette_serial),
      sealNo: normalizeCode(spare.rubber_seal_no),
    }
  })

  const allocationRequest = new sql.Request(executor)
    .input("batchId", sql.BigInt, packing.batch.id)
    .input("userId", sql.Int, userId)
  const allocationValues = resolvedItems.map((item, index) => {
    allocationRequest.input(`allocationPacking${index}`, sql.BigInt, item.id)
    allocationRequest.input(`allocationSpare${index}`, sql.BigInt, item.spareCassetteId)
    return `(@allocationPacking${index}, @allocationSpare${index})`
  })

  await allocationRequest.query(`
    DECLARE @selection TABLE (
      packing_cassette_id BIGINT NOT NULL PRIMARY KEY,
      spare_cassette_id BIGINT NULL
    );

    INSERT INTO @selection (packing_cassette_id, spare_cassette_id)
    VALUES ${allocationValues.join(",")};

    INSERT INTO dbo.cpc_spare_cassette_history
      (spare_cassette_id, action, denomination_value, sheets_count, rubber_seal_no, packing_cassette_id, actor_user_id)
    SELECT
      spare.id, 'RELEASED', spare.denomination_value, spare.sheets_count,
      spare.rubber_seal_no, cassette.id, @userId
    FROM dbo.cpc_packing_cassettes cassette WITH (UPDLOCK, HOLDLOCK)
    INNER JOIN @selection selection ON selection.packing_cassette_id = cassette.id
    INNER JOIN dbo.cpc_spare_cassettes spare WITH (UPDLOCK, HOLDLOCK)
      ON spare.id = cassette.spare_cassette_id
    WHERE cassette.batch_id = @batchId
      AND (selection.spare_cassette_id IS NULL OR selection.spare_cassette_id <> cassette.spare_cassette_id);

    UPDATE spare
    SET
      status = 'READY',
      allocated_packing_cassette_id = NULL,
      allocated_by = NULL,
      allocated_at = NULL,
      updated_at = SYSDATETIME()
    FROM dbo.cpc_spare_cassettes spare
    INNER JOIN dbo.cpc_packing_cassettes cassette ON cassette.spare_cassette_id = spare.id
    INNER JOIN @selection selection ON selection.packing_cassette_id = cassette.id
    WHERE cassette.batch_id = @batchId
      AND (selection.spare_cassette_id IS NULL OR selection.spare_cassette_id <> cassette.spare_cassette_id);

    INSERT INTO dbo.cpc_spare_cassette_history
      (spare_cassette_id, action, denomination_value, sheets_count, rubber_seal_no, packing_cassette_id, actor_user_id)
    SELECT
      spare.id, 'ALLOCATED', spare.denomination_value, spare.sheets_count,
      spare.rubber_seal_no, selection.packing_cassette_id, @userId
    FROM @selection selection
    INNER JOIN dbo.cpc_spare_cassettes spare WITH (UPDLOCK, HOLDLOCK)
      ON spare.id = selection.spare_cassette_id
    WHERE selection.spare_cassette_id IS NOT NULL
      AND (
        spare.status <> 'ALLOCATED'
        OR spare.allocated_packing_cassette_id <> selection.packing_cassette_id
      );

    UPDATE spare
    SET
      status = 'ALLOCATED',
      allocated_packing_cassette_id = selection.packing_cassette_id,
      allocated_by = @userId,
      allocated_at = CASE
        WHEN spare.allocated_packing_cassette_id = selection.packing_cassette_id
          AND spare.allocated_at IS NOT NULL THEN spare.allocated_at
        ELSE SYSDATETIME()
      END,
      updated_at = SYSDATETIME()
    FROM dbo.cpc_spare_cassettes spare
    INNER JOIN @selection selection ON selection.spare_cassette_id = spare.id
    WHERE selection.spare_cassette_id IS NOT NULL;
  `)

  return { ...payload, items: resolvedItems }
}

function validateProspectiveCodes(packing, payload) {
  const itemChanges = new Map(payload.items.map((item) => [item.id, item]))
  const assetChanges = new Map(payload.tidAssets.map((item) => [item.id, item]))
  const seenCodes = new Map()

  for (const item of packing.items) {
    const change = itemChanges.get(Number(item.id))
    const serial = change ? change.cassetteSerial : normalizeCode(item.cassette_serial)
    const seal = change ? change.sealNo : normalizeCode(item.seal_no)
    const identity = item.tid || item.sn || `Point ${item.work_order_point_id}`
    registerUniqueCode(seenCodes, serial, `Kaset Uang ${item.cassette_no} TID ${identity}`)
    registerUniqueCode(seenCodes, seal, `Segel Kaset Uang ${item.cassette_no} TID ${identity}`)
  }

  for (const asset of packing.tid_assets) {
    const change = assetChanges.get(Number(asset.id))
    const rejectSerial = change ? change.rejectCassetteSerial : normalizeCode(asset.reject_cassette_serial)
    const rejectSeal = change ? change.rejectCassetteSealNo : normalizeCode(asset.reject_cassette_seal_no)
    const departureSeal = change ? change.departureBagSealNo : normalizeCode(asset.departure_bag_seal_no)
    const returnSeal = change ? change.returnBagSealNo : normalizeCode(asset.return_bag_seal_no)
    const identity = asset.tid || asset.sn || `Point ${asset.work_order_point_id}`
    registerUniqueCode(seenCodes, rejectSerial, `Kaset Reject TID ${identity}`)
    registerUniqueCode(seenCodes, rejectSeal, `Segel Kaset Reject TID ${identity}`)
    registerUniqueCode(seenCodes, departureSeal, `Segel BAG Berangkat TID ${identity}`)
    registerUniqueCode(seenCodes, returnSeal, `Segel BAG Kembali TID ${identity}`)
  }

  return payload.items.map((item) => item.sealNo)
    .concat(payload.tidAssets.flatMap((item) => [item.rejectCassetteSealNo, item.departureBagSealNo, item.returnBagSealNo]))
    .filter(Boolean)
}

async function acquirePackingCodeLock(executor) {
  const result = await new sql.Request(executor)
    .input("resource", sql.NVarChar(255), PACKING_CODE_LOCK)
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
    throw new CpcPackingError("Registrasi nomor segel sedang diproses pengguna lain. Coba kembali.", 503)
  }
}

async function assertSealCodesAvailable(executor, batchId, sealCodes) {
  if (sealCodes.length === 0) return

  const request = new sql.Request(executor)
    .input("batchId", sql.BigInt, batchId)

  const values = sealCodes.map((seal, index) => {
    request.input(`seal${index}`, sql.VarChar(100), seal)
    return `(@seal${index})`
  })

  const result = await request.query(`
    WITH submitted(seal_no) AS (
      SELECT source.seal_no
      FROM (VALUES ${values.join(",")}) source(seal_no)
    ), used_seals AS (
      SELECT cassette.seal_no
      FROM dbo.cpc_packing_cassettes cassette WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN submitted ON submitted.seal_no = cassette.seal_no
      WHERE cassette.batch_id <> @batchId

      UNION ALL

      SELECT asset.reject_cassette_seal_no
      FROM dbo.cpc_packing_tid_assets asset WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN submitted ON submitted.seal_no = asset.reject_cassette_seal_no
      WHERE asset.batch_id <> @batchId

      UNION ALL

      SELECT asset.departure_bag_seal_no
      FROM dbo.cpc_packing_tid_assets asset WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN submitted ON submitted.seal_no = asset.departure_bag_seal_no
      WHERE asset.batch_id <> @batchId

      UNION ALL

      SELECT asset.return_bag_seal_no
      FROM dbo.cpc_packing_tid_assets asset WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN submitted ON submitted.seal_no = asset.return_bag_seal_no
      WHERE asset.batch_id <> @batchId
    )
    SELECT TOP (1) seal_no
    FROM used_seals;
  `)

  const duplicate = normalizeCode(result.recordset[0]?.seal_no)
  if (duplicate) {
    throw new CpcPackingError(`Nomor segel ${duplicate} sudah digunakan pada packing CPC lain.`, 409)
  }
}

async function buildResponse(db, workOrderId, scopeCodeUker, user) {
  const detail = await getCpcCassetteRequestDetail(db, workOrderId, scopeCodeUker)
  const canManageAssignments = isCpcPackingApprover(user)
  const packingOwnerUserId = Number(detail?.cpc_packing?.batch?.packing_owner_user_id || 0) || null
  const packingOwnerIsMe = packingOwnerUserId === Number(user?.id)
  const activePackingJob = canManageAssignments
    ? null
    : await getActiveCpcPackingWorkOrderForUser(db, user?.id, { excludeWorkOrderId: workOrderId })
  const packingOperators = canManageAssignments
    ? (await listCpcPackingOperators(db, detail?.codeuker || scopeCodeUker))
      .filter((candidate) => !isCpcPackingApprover(candidate))
    : []
  const spareCassettes = await listCpcSpareCassettes(db)

  return {
    request: detail,
    capabilities: {
      can_approve_packing: canManageAssignments,
      can_manage_packing_assignments: canManageAssignments,
      can_claim_packing_work_order: !canManageAssignments
        && (!packingOwnerUserId || packingOwnerIsMe)
        && (!activePackingJob || packingOwnerIsMe),
      can_edit_packing: !canManageAssignments && packingOwnerIsMe,
      packing_owner_is_me: packingOwnerIsMe,
      active_packing_work_order_id: activePackingJob?.workOrderId || null,
      active_packing_work_order_no: activePackingJob?.workOrderNo || null,
    },
    packing_operators: packingOperators,
    spare_cassettes: spareCassettes.items,
    spare_cassette_summary: spareCassettes.summary,
  }
}

export async function PUT(request, context) {
  const authorization = await authorizeApiRequest(request, CPC_MENU_HREF, "update")
  if (!authorization.authorized) return authorization.response

  const { id } = await context.params
  const workOrderId = normalizeId(id)
  if (!workOrderId) return errorResponse("ID work order tidak valid.")

  let body
  try {
    body = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return errorResponse("Data packing terlalu besar.", 413)
    if (error instanceof InvalidJsonBodyError) return errorResponse(error.message, 400)
    return internalError(error, "Gagal membaca data packing CPC.")
  }

  const notes = String(body?.notes || "").trim().slice(0, 1000)
  const db = await connectDB()
  const scope = getUserDataScope(authorization.user)

  try {
    const resolvedScope = await resolveCpcScope(db, scope)
    if (resolvedScope.error) return errorResponse(resolvedScope.error, 403)

    const result = await runInTransaction(db, async (transaction) => {
      await acquireCpcPackingOperatorLock(transaction, authorization.user.id)

      const workOrder = await getLockedCpcWorkOrder(transaction, workOrderId, resolvedScope.codeUker)
      if (!workOrder) throw new CpcPackingError("Permintaan CPC tidak ditemukan.", 404)
      if (workOrder.status !== "KASET_DALAM_PERSIAPAN") {
        throw new CpcPackingError("Packing hanya dapat diubah saat status KASET_DALAM_PERSIAPAN.", 409)
      }

      await ensureCpcPackingBatch(transaction, workOrderId, authorization.user.id)
      const claim = await claimCpcPackingWorkOrder(transaction, workOrderId, authorization.user.id)
      if (!claim?.isOwner) {
        throw new CpcPackingError(
          `Work Order ${workOrder.work_order_no} sedang dikerjakan ${claim?.packingOwnerName || "petugas CPC lain"}. Pilih Work Order lain.`,
          409
        )
      }
      const packing = await getLockedCpcPackingBatch(transaction, workOrderId)
      if (!packing.batch) throw new CpcPackingError("Batch packing tidak dapat dibentuk.", 500)
      // Otorisasi edit berada di level owner Work Order. claimCpcPackingWorkOrder di atas
      // sudah mengunci batch secara eksklusif ke user ini dan menyinkronkan seluruh TID.
      // Karena itu penyimpanan tidak boleh lagi bergantung pada snapshot assigned_to per-TID
      // dari browser yang dapat stale/legacy. Semua ID tetap diverifikasi milik batch ini.
      if (packing.tid_assets.length === 0) {
        throw new CpcPackingError("Work Order ini tidak memiliki TID yang dapat dipersiapkan.", 409)
      }

      let payload = validatePayload(
        body?.items,
        body?.tid_assets,
        packing.items,
        packing.tid_assets
      )

      await acquirePackingCodeLock(transaction)
      payload = await resolveSpareCassetteSelections(
        transaction,
        packing,
        payload,
        authorization.user.id
      )
      const sealCodes = validateProspectiveCodes(packing, payload)
      await assertSealCodesAvailable(transaction, packing.batch.id, sealCodes)

      if (payload.items.length > 0) {
        const updateRequest = new sql.Request(transaction)
          .input("userId", sql.Int, authorization.user.id)
          .input("batchId", sql.BigInt, packing.batch.id)

        const values = payload.items.map((item, index) => {
          updateRequest.input(`id${index}`, sql.BigInt, item.id)
          updateRequest.input(`spareId${index}`, sql.BigInt, item.spareCassetteId)
          updateRequest.input(`serial${index}`, sql.VarChar(100), item.cassetteSerial)
          updateRequest.input(`seal${index}`, sql.VarChar(100), item.sealNo)
          return `(@id${index}, @spareId${index}, @serial${index}, @seal${index})`
        })

        await updateRequest.query(`
          UPDATE cassette
          SET
            spare_cassette_id = source.spare_cassette_id,
            cassette_serial = COALESCE(spare.cassette_serial, source.cassette_serial),
            seal_no = COALESCE(spare.rubber_seal_no, source.seal_no),
            packed_by = CASE
              WHEN COALESCE(spare.cassette_serial, source.cassette_serial) IS NULL THEN NULL
              ELSE COALESCE(spare.prepared_by, @userId)
            END,
            packed_at = CASE
              WHEN COALESCE(spare.cassette_serial, source.cassette_serial) IS NULL THEN NULL
              ELSE COALESCE(spare.prepared_at, cassette.packed_at, SYSDATETIME())
            END,
            sealed_by = CASE
              WHEN COALESCE(spare.rubber_seal_no, source.seal_no) IS NULL THEN NULL
              ELSE COALESCE(spare.prepared_by, @userId)
            END,
            sealed_at = CASE
              WHEN COALESCE(spare.rubber_seal_no, source.seal_no) IS NULL THEN NULL
              ELSE COALESCE(spare.prepared_at, cassette.sealed_at, SYSDATETIME())
            END,
            spare_assigned_by = CASE WHEN source.spare_cassette_id IS NULL THEN NULL ELSE @userId END,
            spare_assigned_at = CASE
              WHEN source.spare_cassette_id IS NULL THEN NULL
              WHEN cassette.spare_cassette_id = source.spare_cassette_id
                AND cassette.spare_assigned_at IS NOT NULL THEN cassette.spare_assigned_at
              ELSE SYSDATETIME()
            END,
            updated_at = SYSDATETIME()
          FROM dbo.cpc_packing_cassettes cassette
          INNER JOIN (VALUES ${values.join(",\n")}) source(id, spare_cassette_id, cassette_serial, seal_no)
            ON source.id = cassette.id
          LEFT JOIN dbo.cpc_spare_cassettes spare ON spare.id = source.spare_cassette_id
          INNER JOIN dbo.cpc_packing_tid_assets asset
            ON asset.batch_id = cassette.batch_id
           AND asset.work_order_point_id = cassette.work_order_point_id
          WHERE cassette.batch_id = @batchId;
        `)
      }

      const assetUpdateRequest = new sql.Request(transaction)
        .input("userId", sql.Int, authorization.user.id)
        .input("batchId", sql.BigInt, packing.batch.id)

      const assetValues = payload.tidAssets.map((item, index) => {
        assetUpdateRequest.input(`assetId${index}`, sql.BigInt, item.id)
        assetUpdateRequest.input(`rejectSerial${index}`, sql.VarChar(100), item.rejectCassetteSerial)
        assetUpdateRequest.input(`rejectSeal${index}`, sql.VarChar(100), item.rejectCassetteSealNo)
        assetUpdateRequest.input(`departureSeal${index}`, sql.VarChar(100), item.departureBagSealNo)
        assetUpdateRequest.input(`returnSeal${index}`, sql.VarChar(100), item.returnBagSealNo)
        return `(@assetId${index}, @rejectSerial${index}, @rejectSeal${index}, @departureSeal${index}, @returnSeal${index})`
      })

      await assetUpdateRequest.query(`
        UPDATE asset
        SET
          reject_cassette_serial = source.reject_cassette_serial,
          reject_cassette_seal_no = source.reject_cassette_seal_no,
          reject_denomination_value = CONVERT(DECIMAL(19,2), 0),
          reject_sheets_count = 0,
          departure_bag_seal_no = source.departure_bag_seal_no,
          return_bag_seal_no = source.return_bag_seal_no,
          prepared_by = CASE
            WHEN source.reject_cassette_serial IS NULL
              AND source.reject_cassette_seal_no IS NULL
              AND source.departure_bag_seal_no IS NULL
              AND source.return_bag_seal_no IS NULL THEN NULL
            ELSE @userId
          END,
          prepared_at = CASE
            WHEN source.reject_cassette_serial IS NULL
              AND source.reject_cassette_seal_no IS NULL
              AND source.departure_bag_seal_no IS NULL
              AND source.return_bag_seal_no IS NULL THEN NULL
            WHEN asset.reject_cassette_serial = source.reject_cassette_serial
              AND asset.reject_cassette_seal_no = source.reject_cassette_seal_no
              AND asset.departure_bag_seal_no = source.departure_bag_seal_no
              AND asset.return_bag_seal_no = source.return_bag_seal_no
              AND asset.prepared_at IS NOT NULL THEN asset.prepared_at
            ELSE SYSDATETIME()
          END,
          started_by = COALESCE(asset.started_by, @userId),
          started_at = COALESCE(asset.started_at, SYSDATETIME()),
          updated_at = SYSDATETIME()
        FROM dbo.cpc_packing_tid_assets asset
        INNER JOIN (VALUES ${assetValues.join(",\n")}) source(
          id,
          reject_cassette_serial,
          reject_cassette_seal_no,
          departure_bag_seal_no,
          return_bag_seal_no
        ) ON source.id = asset.id
        WHERE asset.batch_id = @batchId;
      `)

      const statusRequest = new sql.Request(transaction)
        .input("userId", sql.Int, authorization.user.id)
        .input("batchId", sql.BigInt, packing.batch.id)
      const statusValues = payload.tidAssets.map((item, index) => {
        statusRequest.input(`statusAssetId${index}`, sql.BigInt, item.id)
        return `(@statusAssetId${index})`
      })

      await statusRequest.query(`
        UPDATE asset
        SET
          assignment_status = CASE
            WHEN asset.reject_cassette_serial IS NOT NULL
              AND asset.reject_cassette_seal_no IS NOT NULL
              AND asset.departure_bag_seal_no IS NOT NULL
              AND asset.return_bag_seal_no IS NOT NULL
              AND NOT EXISTS (
                SELECT 1
                FROM dbo.cpc_packing_cassettes cassette
                WHERE cassette.batch_id = asset.batch_id
                  AND cassette.work_order_point_id = asset.work_order_point_id
                  AND (cassette.cassette_serial IS NULL OR cassette.seal_no IS NULL)
              ) THEN 'PACKING_COMPLETE'
            ELSE 'IN_PROGRESS'
          END,
          completed_by = CASE
            WHEN asset.reject_cassette_serial IS NOT NULL
              AND asset.reject_cassette_seal_no IS NOT NULL
              AND asset.departure_bag_seal_no IS NOT NULL
              AND asset.return_bag_seal_no IS NOT NULL
              AND NOT EXISTS (
                SELECT 1
                FROM dbo.cpc_packing_cassettes cassette
                WHERE cassette.batch_id = asset.batch_id
                  AND cassette.work_order_point_id = asset.work_order_point_id
                  AND (cassette.cassette_serial IS NULL OR cassette.seal_no IS NULL)
              ) THEN @userId
            ELSE NULL
          END,
          completed_at = CASE
            WHEN asset.reject_cassette_serial IS NOT NULL
              AND asset.reject_cassette_seal_no IS NOT NULL
              AND asset.departure_bag_seal_no IS NOT NULL
              AND asset.return_bag_seal_no IS NOT NULL
              AND NOT EXISTS (
                SELECT 1
                FROM dbo.cpc_packing_cassettes cassette
                WHERE cassette.batch_id = asset.batch_id
                  AND cassette.work_order_point_id = asset.work_order_point_id
                  AND (cassette.cassette_serial IS NULL OR cassette.seal_no IS NULL)
              ) THEN CASE
                WHEN asset.assignment_status = 'PACKING_COMPLETE' AND asset.completed_at IS NOT NULL THEN asset.completed_at
                ELSE SYSDATETIME()
              END
            ELSE NULL
          END,
          updated_at = SYSDATETIME()
        FROM dbo.cpc_packing_tid_assets asset
        INNER JOIN (VALUES ${statusValues.join(",")}) source(id) ON source.id = asset.id
        WHERE asset.batch_id = @batchId;
      `)

      await new sql.Request(transaction)
        .input("batchId", sql.BigInt, packing.batch.id)
        .input("notes", sql.NVarChar(1000), notes || null)
        .query(`
          UPDATE dbo.cpc_packing_batches
          SET
            status = 'PACKING',
            packing_notes = COALESCE(@notes, packing_notes),
            updated_at = SYSDATETIME()
          WHERE id = @batchId;
        `)

      const refreshed = await getLockedCpcPackingBatch(transaction, workOrderId)

      await insertAuditLog(transaction, {
        request,
        userId: authorization.user.id,
        action: "CPC_SAVE_PACKING",
        module: "transactions.cpc",
        entityType: "cpc_packing_batch",
        entityId: packing.batch.id,
        metadata: {
          work_order_id: workOrderId,
          work_order_no: workOrder.work_order_no,
          work_order_point_ids: payload.tidAssets.map((item) => item.workOrderPointId),
          tids: payload.tidAssets.map((item) => item.tid),
          sheets_per_cassette: CPC_PACKING_SHEETS_PER_CASSETTE,
          spare_cassette_ids: payload.items.map((item) => item.spareCassetteId).filter(Boolean),
          expected_cassettes: refreshed.summary.expected_cassettes,
          completed_cassettes: refreshed.summary.completed_cassettes,
          sealed_cassettes: refreshed.summary.sealed_cassettes,
          expected_tids: refreshed.summary.expected_tids,
          completed_tids: refreshed.summary.completed_tids,
          completed_reject_cassettes: refreshed.summary.completed_reject_cassettes,
          completed_reject_cassette_seals: refreshed.summary.completed_reject_cassette_seals,
          completed_bag_seals: refreshed.summary.completed_bag_seals,
        },
      })

      return refreshed.summary
    }, {
      isolationLevel: sql.ISOLATION_LEVEL.READ_COMMITTED,
      maxRetries: 2,
    })

    const responseData = await buildResponse(db, workOrderId, resolvedScope.codeUker, authorization.user)
    return NextResponse.json({
      success: true,
      message: `Packing milik Anda tersimpan. ${result.completed_tids}/${result.expected_tids} TID lengkap, ${result.completed_cassettes}/${result.expected_cassettes} kaset uang lengkap, ${result.completed_reject_cassette_seals}/${result.expected_reject_cassette_seals} segel kaset reject, dan ${result.completed_bag_seals}/${result.expected_bag_seals} segel BAG terdaftar.`,
      data: responseData,
    })
  } catch (error) {
    if (error instanceof CpcPackingError) return errorResponse(error.message, error.status)
    const number = sqlErrorNumber(error)
    if ([54311, 54312, 54313, 54314, 54315, 54316].includes(number)) {
      return errorResponse(error?.message || "Job packing Work Order sedang digunakan petugas CPC lain.", 409)
    }
    return internalError(error, "Gagal menyimpan packing dan nomor segel CPC.")
  }
}
