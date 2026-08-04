const REPLENISH_APPROVER_IDENTITIES = new Set([
  "SUPER_ADMIN",
  "MANAGER",
  "MANAGER_CRO",
  "ASISTEN_MANAGER_CRO",
  "MANAGER_OPERASIONAL",
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
