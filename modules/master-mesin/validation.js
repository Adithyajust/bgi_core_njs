import {
  LOCATION_CATEGORY_VALUES,
  normalizeLocationCategory,
  normalizeOperationTime,
  suggestLocationCategory,
  OPERATION_DAY_VALUES,
  OPERATION_HOUR_VALUES,
  OPERATION_TIME_VALUES,
  SITE_VALUES,
  WARRANTY_VALUES,
} from "./constants.js"

function normalizeText(value) {
  if (value === null || value === undefined) return ""

  return String(value)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeUpperText(value) {
  return normalizeText(value).toUpperCase()
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value)
  return normalized || null
}

function normalizeId(value) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback
  if ([true, 1, "1", "true"].includes(value)) return true
  if ([false, 0, "0", "false"].includes(value)) return false
  return fallback
}

function parseCoordinate(value, label, minimum, maximum) {
  if (value === undefined || value === null || value === "") {
    return { value: null, error: null }
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return { value: null, error: `${label} harus berupa angka.` }
  }
  if (parsed < minimum || parsed > maximum) {
    return {
      value: null,
      error: `${label} harus berada pada rentang ${minimum} sampai ${maximum}.`,
    }
  }

  return { value: Number(parsed.toFixed(6)), error: null }
}

export function validateMachinePayload(body) {
  const tid = normalizeUpperText(body?.tid)
  const sn = normalizeUpperText(body?.sn)
  const dbValue = normalizeNullableText(body?.db)
  const cabangId = normalizeId(body?.cabang_id)
  const projectId = normalizeId(body?.project_id)
  const lokasi = normalizeText(body?.lokasi)
  const site = normalizeUpperText(body?.site)
  const tipeMesinId = normalizeId(body?.tipe_mesin_id)
  const kategoriMesin = normalizeUpperText(body?.kategori_mesin)
  const kategoriLokasi = normalizeLocationCategory(
    body?.kategori_lokasi ?? body?.kategori
  )
  const garansi = normalizeUpperText(body?.garansi)
  const hariOps = normalizeUpperText(body?.hari_ops)
  const jamOps = normalizeUpperText(body?.jam_ops)
  const waktuOps = normalizeOperationTime(body?.waktu_ops)
  const longitude = parseCoordinate(body?.longitude, "Longitude", -180, 180)
  const latitude = parseCoordinate(body?.latitude, "Latitude", -90, 90)
  const isActive = normalizeBoolean(body?.is_active, true)

  const kategoriLokasiSuggestion = suggestLocationCategory(kategoriLokasi)
  const kategoriLokasiError = !kategoriLokasi
    ? "Kategori Lokasi wajib dipilih."
    : !LOCATION_CATEGORY_VALUES.has(kategoriLokasi)
      ? kategoriLokasiSuggestion
        ? `Kategori Lokasi tidak valid. Gunakan "${kategoriLokasiSuggestion}".`
        : `Kategori Lokasi "${kategoriLokasi}" tidak valid.`
      : null

  const validations = [
    [!tid, "TID wajib diisi."],
    [tid.length > 50, "TID maksimal 50 karakter."],
    [!sn, "SN wajib diisi."],
    [sn.length > 100, "SN maksimal 100 karakter."],
    [tid && sn && tid === sn, "TID dan SN tidak boleh memiliki nilai yang sama."],
    [dbValue && dbValue.length > 100, "DB maksimal 100 karakter."],
    [!cabangId, "Cabang pengelola wajib dipilih."],
    [!projectId, "Project wajib dipilih."],
    [!lokasi, "Lokasi fisik mesin wajib diisi."],
    [lokasi.length > 500, "Lokasi maksimal 500 karakter."],
    [!SITE_VALUES.has(site), "Site tidak valid."],
    [!tipeMesinId, "Tipe Mesin wajib dipilih."],
    [kategoriMesin.length > 100, "Kategori Mesin maksimal 100 karakter."],
    [Boolean(kategoriLokasiError), kategoriLokasiError],
    [!WARRANTY_VALUES.has(garansi), "Status garansi tidak valid."],
    [!OPERATION_DAY_VALUES.has(hariOps), "Hari operasional tidak valid."],
    [!OPERATION_HOUR_VALUES.has(jamOps), "Jam operasional tidak valid."],
    [!OPERATION_TIME_VALUES.has(waktuOps), "Waktu operasional tidak valid."],
  ]

  for (const [invalid, message] of validations) {
    if (invalid) return { error: message, data: null }
  }

  if (jamOps === "24 JAM" && waktuOps !== "00:00 - 23:59") {
    return {
      error: "Mesin dengan Jam Operasional 24 JAM harus memakai waktu 00:00 - 23:59.",
      data: null,
    }
  }

  if (jamOps === "NON 24 JAM" && waktuOps === "00:00 - 23:59") {
    return {
      error: "Mesin NON 24 JAM harus memakai rentang waktu selain 00:00 - 23:59.",
      data: null,
    }
  }

  if (longitude.error) return { error: longitude.error, data: null }
  if (latitude.error) return { error: latitude.error, data: null }

  return {
    error: null,
    data: {
      tid,
      sn,
      dbValue,
      cabangId,
      projectId,
      lokasi,
      site,
      tipeMesinId,
      kategoriMesin,
      kategoriLokasi,
      garansi,
      hariOps,
      jamOps,
      waktuOps,
      longitude: longitude.value,
      latitude: latitude.value,
      isActive,
    },
  }
}
