const CPC_PACKING_APPROVER_IDENTITIES = new Set([
  "SUPER_ADMIN",
  "ASISTEN_MANAGER_CPC",
])

export function normalizeCpcIdentity(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export function getCpcPackingApproverIdentity(user = {}) {
  const candidates = [
    user.role_code,
    user.roleCode,
    user.role_name,
    user.roleName,
    user.pegawai_jabatan,
    user.pegawai?.jabatan,
  ]

  for (const candidate of candidates) {
    const normalized = normalizeCpcIdentity(candidate)
    if (CPC_PACKING_APPROVER_IDENTITIES.has(normalized)) return normalized
  }

  return null
}

export function isCpcPackingApprover(user = {}) {
  return Boolean(getCpcPackingApproverIdentity(user))
}
