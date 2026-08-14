import {
  REPLENISH_DEFAULT_SHEETS_PER_CASSETTE,
  REPLENISH_PAGU_OPTIONS,
} from "./constants.js"

const PAGU_SET = new Set(REPLENISH_PAGU_OPTIONS)
const MAX_DENOMINATION = 999_999_999_999

export function parseReplenishDenomination(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 && value <= MAX_DENOMINATION
      ? value
      : null
  }

  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/^(?:RP|IDR)\s*/i, "")

  if (!normalized) return null
  if (!/^(?:\d+|\d{1,3}(?:[.,]\d{3})+)$/.test(normalized)) return null

  const parsed = Number(normalized.replace(/[.,]/g, ""))
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_DENOMINATION
    ? parsed
    : null
}

export function calculatePointRequirements(paguValue, denominationValue) {
  const pagu = Number(paguValue)
  if (!Number.isSafeInteger(pagu) || !PAGU_SET.has(pagu)) {
    return { error: "Pagu harus dipilih dari 2000, 4000, 6000, atau 8000 lembar." }
  }

  const denomination = parseReplenishDenomination(denominationValue)
  if (!denomination) {
    return {
      error:
        "Denom ATM/CRM harus berupa satu nilai nominal numerik, misalnya 50000 atau 100000.",
    }
  }

  const requestedAmount = pagu * denomination
  if (!Number.isSafeInteger(requestedAmount)) {
    return { error: "Hasil perhitungan nominal kebutuhan berada di luar batas aman." }
  }

  return {
    error: null,
    pagu,
    denomination,
    requestedAmount,
    cassetteCount: pagu / REPLENISH_DEFAULT_SHEETS_PER_CASSETTE,
  }
}

export function materializeReplenishPoints(points, machines) {
  const machineById = new Map(
    (machines || []).map((machine) => [String(machine.id), machine])
  )

  const calculatedPoints = []
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    const machine = machineById.get(String(point.machineId))
    if (!machine) {
      return {
        error: `ATM/CRM pada urutan ${index + 1} tidak ditemukan saat menghitung kebutuhan kas.`,
        points: null,
      }
    }

    if (point.activityType === "PENGOSONGAN") {
      calculatedPoints.push({
        ...point,
        pagu: null,
        denominationValue: null,
        requestedAmount: null,
        cassetteCount: null,
      })
      continue
    }

    const calculation = calculatePointRequirements(point.pagu, machine.denom)
    if (calculation.error) {
      return {
        error: `ATM/CRM ${machine.tid || machine.sn || point.machineId}: ${calculation.error}`,
        points: null,
      }
    }

    calculatedPoints.push({
      ...point,
      denominationValue: calculation.denomination,
      requestedAmount: calculation.requestedAmount,
      cassetteCount: calculation.cassetteCount,
    })
  }

  return { error: null, points: calculatedPoints }
}

export function deriveWorkOrderActivityType(points) {
  const values = new Set((points || []).map((point) => point.activityType))
  return values.size === 1 ? values.values().next().value : "CAMPURAN"
}

export function calculateRequestedAmount(points) {
  return (points || []).reduce(
    (total, point) => total + Number(point.requestedAmount || 0),
    0
  )
}
