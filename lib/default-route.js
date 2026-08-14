const CUSTODY_IDENTITIES = new Set(["CUSTODY", "PETUGAS_CUSTODY"])

function normalizeIdentity(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export function getAuthenticatedHomePath(user = {}) {
  const identities = [
    user.roleCode,
    user.role_code,
    user.roleName,
    user.role_name,
    user.pegawai?.jabatan,
    user.pegawai_jabatan,
  ]

  return identities.some((identity) => CUSTODY_IDENTITIES.has(normalizeIdentity(identity)))
    ? "/field_replenish"
    : "/dashboard"
}
