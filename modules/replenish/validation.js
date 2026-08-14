import {
  MAX_REPLENISH_POINTS,
  REPLENISH_ACTIVITY_TYPES,
  REPLENISH_PAGU_OPTIONS,
  REPLENISH_PRIORITIES,
} from "./constants.js"
import { deriveWorkOrderActivityType } from "./calculation.js"

const ACTIVITY_TYPES = new Set(REPLENISH_ACTIVITY_TYPES)
const PAGU_OPTIONS = new Set(REPLENISH_PAGU_OPTIONS)
const PRIORITIES = new Set(REPLENISH_PRIORITIES)
const MAX_ESCORT_NAME_LENGTH = 200

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeNullableText(value, maximumLength) {
  const normalized = normalizeText(value)
  if (!normalized) return null
  return normalized.slice(0, maximumLength)
}

function normalizePositiveId(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizePagu(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && PAGU_OPTIONS.has(parsed) ? parsed : null
}

function normalizeDate(value) {
  const normalized = normalizeText(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null

  const [year, month, day] = normalized.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? normalized
    : null
}

function normalizeTime(value) {
  const normalized = normalizeText(value)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) return null
  return normalized
}

function normalizePoint(point, index, legacyActivityType) {
  const machineId = normalizePositiveId(point?.machine_id)
  const activityType = normalizeText(point?.activity_type || legacyActivityType).toUpperCase()
  const pagu = activityType === "PENGOSONGAN" ? null : normalizePagu(point?.pagu)
  const notes = normalizeNullableText(point?.notes, 500)

  if (!machineId) {
    return { error: `ATM/CRM pada urutan ${index + 1} tidak valid.` }
  }

  if (!ACTIVITY_TYPES.has(activityType)) {
    return {
      error: `Jenis aktivitas pada ATM/CRM urutan ${index + 1} tidak valid.`,
    }
  }

  if (activityType !== "PENGOSONGAN" && !pagu) {
    return {
      error: `Pagu pada ATM/CRM urutan ${index + 1} wajib dipilih untuk Replenish Normal atau Pengisian Perdana dari 2000, 4000, 6000, atau 8000.`,
    }
  }

  return {
    error: null,
    value: {
      machineId,
      sequenceNo: index + 1,
      activityType,
      pagu,
      notes,
    },
  }
}

export function validateReplenishPayload(body = {}) {
  const normalizedLegacyActivity = normalizeText(body.activity_type).toUpperCase()
  const legacyActivityType = ACTIVITY_TYPES.has(normalizedLegacyActivity)
    ? normalizedLegacyActivity
    : null
  const priority = normalizeText(body.priority || "NORMAL").toUpperCase()
  const scheduleDate = normalizeDate(body.schedule_date)
  const departureTime = normalizeTime(body.departure_time)
  const estimatedFinishTime = normalizeTime(body.estimated_finish_time)
  const ukerId = normalizePositiveId(body.uker_id)
  const vehicleId = normalizePositiveId(body.vehicle_id)
  const custodyId = normalizePositiveId(body.custody_id)
  const driverId = normalizePositiveId(body.driver_id)
  const escortName = normalizeText(body.escort_name)
  const routeNotes = normalizeNullableText(body.route_notes, 1000)
  const notes = normalizeNullableText(body.notes, 1000)
  const rawPoints = Array.isArray(body.points) ? body.points : []

  if (!PRIORITIES.has(priority)) {
    return { error: "Prioritas work order tidak valid.", data: null }
  }

  if (!scheduleDate) {
    return { error: "Tanggal kegiatan wajib diisi dan harus valid.", data: null }
  }

  if (!departureTime) {
    return { error: "Jam keberangkatan wajib diisi.", data: null }
  }

  if (!estimatedFinishTime) {
    return { error: "Estimasi selesai wajib diisi.", data: null }
  }

  if (!vehicleId) {
    return { error: "Kendaraan operasional wajib dipilih.", data: null }
  }

  if (!custodyId || !driverId) {
    return {
      error: "Tim wajib memiliki Custody dan Pengemudi dari master pegawai.",
      data: null,
    }
  }

  if (custodyId === driverId) {
    return {
      error: "Custody dan Pengemudi harus orang yang berbeda.",
      data: null,
    }
  }

  if (!escortName) {
    return {
      error: "Nama Petugas Pengawalan wajib diisi.",
      data: null,
    }
  }

  if (escortName.length > MAX_ESCORT_NAME_LENGTH) {
    return {
      error: `Nama Petugas Pengawalan maksimal ${MAX_ESCORT_NAME_LENGTH} karakter.`,
      data: null,
    }
  }

  if (rawPoints.length === 0) {
    return { error: "Minimal satu ATM/CRM harus dipilih.", data: null }
  }

  if (rawPoints.length > MAX_REPLENISH_POINTS) {
    return {
      error: `Maksimal ${MAX_REPLENISH_POINTS} ATM/CRM dalam satu work order.`,
      data: null,
    }
  }

  const points = []
  for (let index = 0; index < rawPoints.length; index += 1) {
    const result = normalizePoint(rawPoints[index], index, legacyActivityType)
    if (result.error) return { error: result.error, data: null }
    points.push(result.value)
  }

  const machineIds = points.map((point) => point.machineId)
  if (new Set(machineIds).size !== machineIds.length) {
    return { error: "ATM/CRM yang sama tidak boleh dipilih lebih dari sekali.", data: null }
  }

  return {
    error: null,
    data: {
      activityType: deriveWorkOrderActivityType(points),
      priority,
      scheduleDate,
      departureTime,
      estimatedFinishTime,
      ukerId,
      vehicleId,
      custodyId,
      driverId,
      escortName,
      routeNotes,
      notes,
      points,
    },
  }
}

export function normalizeReplenishAction(value) {
  return normalizeText(value).toUpperCase()
}

export function normalizeRejectionReason(value) {
  return normalizeNullableText(value, 1000)
}
