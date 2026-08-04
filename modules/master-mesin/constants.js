export const SITE_VALUES = new Set(["ONSITE", "OFFSITE"])
export const WARRANTY_VALUES = new Set(["IN WARRANTY", "OUT WARRANTY"])
export const OPERATION_DAY_VALUES = new Set(["WEEKDAYS", "ALL DAYS"])
export const OPERATION_HOUR_VALUES = new Set(["24 JAM", "NON 24 JAM"])
export const OPERATION_TIME_VALUES = new Set([
  "00:00 - 23:59",
  "06:00 - 15:00",
  "06:00 - 18:00",
  "06:00 - 21:00",
  "09:00 - 15:00",
  "09:00 - 18:00",
  "09:00 - 21:00",
])

export const LOCATION_CATEGORY_LIST = [
  "ALFAMART",
  "ALFAMIDI",
  "APARTEMEN",
  "APOTEK",
  "BANDARA",
  "BIKE THRU",
  "BRI AGRO",
  "DRIVE THRU",
  "GTI",
  "HOTEL",
  "INDOMARET",
  "INSTANSI BUMN/BUMD",
  "INSTANSI MILITER",
  "INSTANSI PEMERINTAHAN",
  "KANINS",
  "KANTOR PUSAT",
  "KANWIL",
  "KC",
  "KCP",
  "KEPOLISIAN",
  "KK",
  "KLINIK",
  "MALL",
  "MINI MARKET",
  "PABRIK",
  "PANGKALAN MILITER",
  "PASAR",
  "PELABUHAN",
  "PERKANTORAN",
  "PERKEBUNAN",
  "PERTAMBANGAN",
  "PERTOKOAN",
  "PERUMAHAN",
  "PLAZA",
  "RUMAH MAKAN",
  "RUMAH SAKIT",
  "SPBU",
  "STASIUN",
  "SWALAYAN",
  "TEMPAT HIBURAN",
  "TEMPAT IBADAH",
  "TEMPAT OLAHRAGA",
  "TEMPAT PENDIDIKAN",
  "TEMPAT WISATA",
  "TERAS BRI",
  "TERMINAL",
  "UNIT BRI",
]

export const LOCATION_CATEGORY_VALUES = new Set(LOCATION_CATEGORY_LIST)

function normalizeLookupText(value) {
  if (value === null || value === undefined) return ""

  return String(value)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/[\s_-]+/g, " ")
    .trim()
    .toUpperCase()
}

export function normalizeOperationTime(value) {
  if (value === null || value === undefined) return ""

  const normalized = String(value)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[.]/g, ":")
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()

  const match = normalized.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/)
  if (!match) return normalized

  const [, startHour, startMinute, endHour, endMinute] = match
  return `${startHour.padStart(2, "0")}:${startMinute} - ${endHour.padStart(2, "0")}:${endMinute}`
}

const LOCATION_CATEGORY_ALIASES = new Map([
  ["ALFA MART", "ALFAMART"],
  ["ALFA MIDI", "ALFAMIDI"],
  ["APOTIK", "APOTEK"],
  ["INDO MARET", "INDOMARET"],
  ["MINIMARKET", "MINI MARKET"],
  ["RUMAHSAKIT", "RUMAH SAKIT"],
  ["RS", "RUMAH SAKIT"],
  ["INSTANSI PEMERINTAH", "INSTANSI PEMERINTAHAN"],
  ["PEMERINTAHAN", "INSTANSI PEMERINTAHAN"],
  ["BUMN/BUMD", "INSTANSI BUMN/BUMD"],
  ["INSTANSI BUMN BUMD", "INSTANSI BUMN/BUMD"],
  ["MILITER", "INSTANSI MILITER"],
  ["TEMPAT OLAH RAGA", "TEMPAT OLAHRAGA"],
  ["PENDIDIKAN", "TEMPAT PENDIDIKAN"],
  ["WISATA", "TEMPAT WISATA"],
  ["HIBURAN", "TEMPAT HIBURAN"],
  ["KANTORPUSAT", "KANTOR PUSAT"],
  ["TERASBRI", "TERAS BRI"],
  ["TOKO", "PERTOKOAN"],
  ["AREA TOKO", "PERTOKOAN"],
  ["AREA PERTOKOAN", "PERTOKOAN"],
  ["BRI UNIT", "UNIT BRI"],
  ["BIKETHRU", "BIKE THRU"],
  ["BRIAGRO", "BRI AGRO"],
  ["DRIVETHRU", "DRIVE THRU"],
  ["PANGKALANMILITER", "PANGKALAN MILITER"],
  ["RUMAHMAKAN", "RUMAH MAKAN"],
  ["TEMPATIBADAH", "TEMPAT IBADAH"],
])

export function normalizeLocationCategory(value) {
  const normalized = normalizeLookupText(value)
  return LOCATION_CATEGORY_ALIASES.get(normalized) || normalized
}

function compactCategoryKey(value) {
  return normalizeLookupText(value).replace(/[^A-Z0-9]/g, "")
}

function levenshteinDistance(leftValue, rightValue) {
  const left = compactCategoryKey(leftValue)
  const right = compactCategoryKey(rightValue)

  if (!left) return right.length
  if (!right) return left.length

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1

      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      )
    }

    previous.splice(0, previous.length, ...current)
  }

  return previous[right.length]
}

export function suggestLocationCategory(value) {
  const normalized = normalizeLocationCategory(value)
  if (!normalized) return null
  if (LOCATION_CATEGORY_VALUES.has(normalized)) return normalized

  let bestCategory = null
  let bestDistance = Number.POSITIVE_INFINITY

  LOCATION_CATEGORY_LIST.forEach((category) => {
    const distance = levenshteinDistance(normalized, category)
    if (distance < bestDistance) {
      bestCategory = category
      bestDistance = distance
    }
  })

  const normalizedLength = compactCategoryKey(normalized).length
  const allowedDistance = Math.max(1, Math.min(4, Math.floor(normalizedLength * 0.25)))

  return bestDistance <= allowedDistance ? bestCategory : null
}
