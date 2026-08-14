const REPLENISH_APPROVER_IDENTITIES = new Set([
  "SUPER_ADMIN",
  "ASISTEN_MANAGER_CRO",
  "MANAGER_OPERASIONAL",
])

const REPLENISH_ADMIN_IDENTITIES = new Set([
  "ADMIN",
  "ADMIN_CRO",
  "CRO_ADMIN",
  "OPERATOR",
  "USER_ADMIN",
  "ADMIN_USER",
  "ADMINISTRATOR",
])

const REPLENISH_FIELD_CUSTODY_IDENTITIES = new Set([
  "CUSTODY",
  "PETUGAS_CUSTODY",
])

const REPLENISH_FIELD_DRIVER_IDENTITIES = new Set([
  "DRIVER",
  "PENGEMUDI",
  "PETUGAS_PENGEMUDI",
])

// Hak cetak Serah Terima Kunci sengaja lebih luas daripada hak approval tim.
// Database legacy project menggunakan role generik MANAGER/OPERATOR, sedangkan
// instalasi baru dapat memakai nama jabatan/role yang lebih spesifik. Semua alias
// di bawah hanya berlaku untuk pencetakan dokumen setelah WO DISETUJUI; fungsi
// isReplenishTeamApprover tetap mempertahankan aturan maker-checker yang ketat.
const REPLENISH_KEY_HANDOVER_PRINTER_IDENTITIES = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "ADMIN_CRO",
  "CRO_ADMIN",
  "OPERATOR",
  "USER_ADMIN",
  "ADMIN_USER",
  "ADMINISTRATOR",
  "MANAGER",
  "MANAGER_CRO",
  "MANAGER_OPERASIONAL",
  "ASISTEN_MANAGER_CRO",
  "ASISTEN_MANAGER_OPERASIONAL",
])

export function normalizeReplenishIdentity(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export function getReplenishApproverIdentity(user = {}) {
  const candidates = [
    user.role_code,
    user.roleCode,
    user.role_name,
    user.roleName,
    user.pegawai_jabatan,
    user.pegawai?.jabatan,
  ]

  for (const candidate of candidates) {
    const normalized = normalizeReplenishIdentity(candidate)
    if (REPLENISH_APPROVER_IDENTITIES.has(normalized)) return normalized
  }

  return null
}

export function isReplenishTeamApprover(user = {}) {
  return Boolean(getReplenishApproverIdentity(user))
}

export function getReplenishAdminIdentity(user = {}) {
  const candidates = [
    user.role_code,
    user.roleCode,
    user.role_name,
    user.roleName,
    user.pegawai_jabatan,
    user.pegawai?.jabatan,
  ]

  for (const candidate of candidates) {
    const normalized = normalizeReplenishIdentity(candidate)
    if (REPLENISH_ADMIN_IDENTITIES.has(normalized)) return normalized
  }

  return null
}

export function isReplenishAdmin(user = {}) {
  return Boolean(getReplenishAdminIdentity(user))
}

function hasReplenishIdentity(user, allowedIdentities) {
  const candidates = [
    user.role_code,
    user.roleCode,
    user.role_name,
    user.roleName,
    user.pegawai_jabatan,
    user.pegawai?.jabatan,
  ]

  return candidates.some((candidate) =>
    allowedIdentities.has(normalizeReplenishIdentity(candidate))
  )
}

export function isReplenishFieldCustody(user = {}) {
  return hasReplenishIdentity(user, REPLENISH_FIELD_CUSTODY_IDENTITIES)
}

export function isReplenishFieldDriver(user = {}) {
  return hasReplenishIdentity(user, REPLENISH_FIELD_DRIVER_IDENTITIES)
}

export function isReplenishFieldSupervisor(user = {}) {
  return isReplenishTeamApprover(user)
}

export function isReplenishKeyHandoverPrinter(user = {}) {
  const candidates = [
    user.role_code,
    user.roleCode,
    user.role_name,
    user.roleName,
    user.pegawai_jabatan,
    user.pegawai?.jabatan,
  ]

  return candidates.some((candidate) =>
    REPLENISH_KEY_HANDOVER_PRINTER_IDENTITIES.has(normalizeReplenishIdentity(candidate))
  )
}
