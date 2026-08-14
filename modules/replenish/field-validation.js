import { REPLENISH_FIELD_ACTIONS } from "./constants.js"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class ReplenishFieldValidationError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message)
    this.name = "ReplenishFieldValidationError"
    this.status = status
    this.extra = extra
  }
}

export function normalizeFieldCode(value, maxLength = 100) {
  const normalized = String(value || "").trim().toUpperCase()
  return normalized ? normalized.slice(0, maxLength) : null
}

export function normalizeFieldEvent(raw = {}) {
  const clientEventId = String(raw.client_event_id || "").trim().toLowerCase()
  if (!UUID_PATTERN.test(clientEventId)) {
    throw new ReplenishFieldValidationError("ID event perangkat tidak valid.")
  }

  const action = String(raw.action || "").trim().toUpperCase()
  if (!Object.values(REPLENISH_FIELD_ACTIONS).includes(action)) {
    throw new ReplenishFieldValidationError("Aksi lapangan tidak dikenali.")
  }

  const pointId = Number(raw.work_order_point_id)
  const recordedAt = new Date(raw.recorded_at)
  if (Number.isNaN(recordedAt.getTime())) {
    throw new ReplenishFieldValidationError("Waktu event perangkat tidak valid.")
  }

  const location = raw.location && typeof raw.location === "object" ? raw.location : null
  const latitude = Number(location?.latitude)
  const longitude = Number(location?.longitude)
  const accuracy = Number(location?.accuracy)
  const hasLocation = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100000

  return {
    clientEventId,
    action,
    pointId: Number.isSafeInteger(pointId) && pointId > 0 ? pointId : null,
    recordedAt,
    location: hasLocation ? { latitude, longitude, accuracy } : null,
    offlineCreated: Boolean(raw.offline_created),
    payload: raw.payload && typeof raw.payload === "object" ? raw.payload : {},
  }
}

export function requireFieldLocation(event) {
  if (!event.location) {
    throw new ReplenishFieldValidationError(
      "GPS wajib aktif untuk tahapan utama Replenish Lapangan.",
      422,
      { code: "GPS_REQUIRED" }
    )
  }
}

function registerCode(seen, value, label) {
  if (!value) throw new ReplenishFieldValidationError(`${label} wajib discan.`)
  const existing = seen.get(value)
  if (existing) {
    throw new ReplenishFieldValidationError(
      `Kode ${value} tidak boleh sama antara ${existing} dan ${label}.`,
      409,
      { code: "DUPLICATE_SCAN_CODE" }
    )
  }
  seen.set(value, label)
}

export function normalizePointScan(payload, expectedCassetteCount) {
  const cassettes = Array.isArray(payload?.cassettes) ? payload.cassettes : []
  if (!Number.isSafeInteger(expectedCassetteCount) || expectedCassetteCount < 1) {
    throw new ReplenishFieldValidationError(
      "TID belum mempunyai kaset packing CPC yang dapat diverifikasi.",
      409
    )
  }
  if (cassettes.length !== expectedCassetteCount) {
    throw new ReplenishFieldValidationError(
      "Jumlah kaset yang discan tidak sesuai dengan packing CPC. Muat ulang job.",
      409
    )
  }

  const seenSlots = new Set()
  const seenCodes = new Map()
  const normalized = cassettes.map((item) => {
    const cassetteNo = Number(item?.cassette_no)
    if (!Number.isSafeInteger(cassetteNo) || cassetteNo < 1 || seenSlots.has(cassetteNo)) {
      throw new ReplenishFieldValidationError("Nomor slot kaset pada hasil scan tidak valid.")
    }
    seenSlots.add(cassetteNo)

    const result = {
      cassetteNo,
      oldCassetteSerial: normalizeFieldCode(item?.old_cassette_serial),
      oldSealNo: normalizeFieldCode(item?.old_seal_no),
      newCassetteSerial: normalizeFieldCode(item?.new_cassette_serial),
      newSealNo: normalizeFieldCode(item?.new_seal_no),
    }
    registerCode(seenCodes, result.oldCassetteSerial, `serial kaset lama slot ${cassetteNo}`)
    registerCode(seenCodes, result.oldSealNo, `segel kaset lama slot ${cassetteNo}`)
    registerCode(seenCodes, result.newCassetteSerial, `serial kaset baru slot ${cassetteNo}`)
    registerCode(seenCodes, result.newSealNo, `segel kaset baru slot ${cassetteNo}`)
    return result
  }).sort((left, right) => left.cassetteNo - right.cassetteNo)

  for (let index = 0; index < expectedCassetteCount; index += 1) {
    if (normalized[index]?.cassetteNo !== index + 1) {
      throw new ReplenishFieldValidationError("Semua slot kaset wajib discan berurutan.")
    }
  }

  const assets = {
    departureBagSealNo: normalizeFieldCode(payload?.departure_bag_seal_no),
    rejectCassetteSerial: normalizeFieldCode(payload?.reject_cassette_serial),
    rejectCassetteSealNo: normalizeFieldCode(payload?.reject_cassette_seal_no),
    returnBagSealNo: normalizeFieldCode(payload?.return_bag_seal_no),
  }
  registerCode(seenCodes, assets.departureBagSealNo, "Segel BAG Berangkat")
  registerCode(seenCodes, assets.rejectCassetteSerial, "serial kaset reject")
  registerCode(seenCodes, assets.rejectCassetteSealNo, "segel kaset reject")
  registerCode(seenCodes, assets.returnBagSealNo, "Segel BAG Kembali")

  return { cassettes: normalized, assets, codes: [...seenCodes.keys()] }
}

export function comparePointScan(scan, expected) {
  const mismatches = []
  const expectedBySlot = new Map(expected.cassettes.map((item) => [Number(item.cassette_no), item]))
  for (const cassette of scan.cassettes) {
    const expectedCassette = expectedBySlot.get(cassette.cassetteNo)
    if (cassette.newCassetteSerial !== normalizeFieldCode(expectedCassette?.cassette_serial)) {
      mismatches.push({ field: `new_cassette_serial_${cassette.cassetteNo}`, label: `Serial kaset baru slot ${cassette.cassetteNo}`, expected: normalizeFieldCode(expectedCassette?.cassette_serial), actual: cassette.newCassetteSerial })
    }
    if (cassette.newSealNo !== normalizeFieldCode(expectedCassette?.seal_no)) {
      mismatches.push({ field: `new_seal_no_${cassette.cassetteNo}`, label: `Segel kaset baru slot ${cassette.cassetteNo}`, expected: normalizeFieldCode(expectedCassette?.seal_no), actual: cassette.newSealNo })
    }
  }

  const assetComparisons = [
    ["departure_bag_seal_no", "Segel BAG Berangkat", expected.departure_bag_seal_no, scan.assets.departureBagSealNo],
    ["reject_cassette_serial", "Serial kaset reject", expected.reject_cassette_serial, scan.assets.rejectCassetteSerial],
    ["reject_cassette_seal_no", "Segel kaset reject", expected.reject_cassette_seal_no, scan.assets.rejectCassetteSealNo],
    ["return_bag_seal_no", "Segel BAG Kembali", expected.return_bag_seal_no, scan.assets.returnBagSealNo],
  ]
  for (const [field, label, expectedValue, actualValue] of assetComparisons) {
    if (actualValue !== normalizeFieldCode(expectedValue)) {
      mismatches.push({ field, label, expected: normalizeFieldCode(expectedValue), actual: actualValue })
    }
  }

  return mismatches
}
