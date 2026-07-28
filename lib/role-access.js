export const ROLE_STORAGE_KEYS = {
  roles: "bgi_rbac_roles",
  permissions: "bgi_rbac_permissions",
  currentRole: "bgi_rbac_current_role",
}

export const DEFAULT_ROLES = [
  {
    code: "SUPER_ADMIN",
    name: "Super Admin",
  },
  {
    code: "PINCA",
    name: "Pinca",
  },
  {
    code: "MANAGER_CRO",
    name: "Manager CRO",
  },
  {
    code: "MANAGER_CPC",
    name: "Manager CPC",
  },
  {
    code: "ADMIN",
    name: "Admin",
  },
  {
    code: "CPC",
    name: "CPC",
  },
]

function isBrowser() {
  return typeof window !== "undefined"
}

function safeParse(value, fallbackValue) {
  if (!value) {
    return fallbackValue
  }

  try {
    return JSON.parse(value)
  } catch {
    return fallbackValue
  }
}

function normalizeMenuIds(menuIds = []) {
  return [
    ...new Set(
      menuIds
        .map((menuId) => Number(menuId))
        .filter(
          (menuId) =>
            Number.isInteger(menuId) &&
            menuId > 0
        )
    ),
  ]
}

export function initializeRoleAccess(menuIds = []) {
  if (!isBrowser()) {
    return
  }

  const savedRoles = safeParse(
    window.localStorage.getItem(
      ROLE_STORAGE_KEYS.roles
    ),
    []
  )

  if (!Array.isArray(savedRoles) || savedRoles.length === 0) {
    window.localStorage.setItem(
      ROLE_STORAGE_KEYS.roles,
      JSON.stringify(DEFAULT_ROLES)
    )
  }

  const savedPermissions = safeParse(
    window.localStorage.getItem(
      ROLE_STORAGE_KEYS.permissions
    ),
    {}
  )

  const permissions = {
    ...savedPermissions,
  }

  for (const role of DEFAULT_ROLES) {
    if (!Array.isArray(permissions[role.code])) {
      permissions[role.code] = []
    }
  }

  permissions.SUPER_ADMIN =
    normalizeMenuIds(menuIds)

  window.localStorage.setItem(
    ROLE_STORAGE_KEYS.permissions,
    JSON.stringify(permissions)
  )

  const currentRole =
    window.localStorage.getItem(
      ROLE_STORAGE_KEYS.currentRole
    )

  const roleExists = DEFAULT_ROLES.some(
    (role) => role.code === currentRole
  )

  if (!roleExists) {
    window.localStorage.setItem(
      ROLE_STORAGE_KEYS.currentRole,
      "SUPER_ADMIN"
    )
  }
}

export function getRoles() {
  if (!isBrowser()) {
    return DEFAULT_ROLES
  }

  const roles = safeParse(
    window.localStorage.getItem(
      ROLE_STORAGE_KEYS.roles
    ),
    DEFAULT_ROLES
  )

  return Array.isArray(roles)
    ? roles
    : DEFAULT_ROLES
}

export function getCurrentRoleCode() {
  if (!isBrowser()) {
    return "SUPER_ADMIN"
  }

  return (
    window.localStorage.getItem(
      ROLE_STORAGE_KEYS.currentRole
    ) || "SUPER_ADMIN"
  )
}

export function setCurrentRoleCode(roleCode) {
  if (!isBrowser()) {
    return false
  }

  const roleExists = DEFAULT_ROLES.some(
    (role) => role.code === roleCode
  )

  if (!roleExists) {
    return false
  }

  window.localStorage.setItem(
    ROLE_STORAGE_KEYS.currentRole,
    roleCode
  )

  window.dispatchEvent(
    new CustomEvent("bgi-role-changed", {
      detail: {
        roleCode,
      },
    })
  )

  return true
}

export function getAllRolePermissions() {
  if (!isBrowser()) {
    return {}
  }

  const permissions = safeParse(
    window.localStorage.getItem(
      ROLE_STORAGE_KEYS.permissions
    ),
    {}
  )

  return permissions &&
    typeof permissions === "object"
    ? permissions
    : {}
}

export function getRolePermissions(roleCode) {
  const permissions =
    getAllRolePermissions()

  return normalizeMenuIds(
    permissions[roleCode] || []
  )
}

export function saveRolePermissions(
  roleCode,
  menuIds
) {
  if (!isBrowser()) {
    return false
  }

  const roleExists = DEFAULT_ROLES.some(
    (role) => role.code === roleCode
  )

  if (!roleExists) {
    return false
  }

  const permissions =
    getAllRolePermissions()

  permissions[roleCode] =
    normalizeMenuIds(menuIds)

  window.localStorage.setItem(
    ROLE_STORAGE_KEYS.permissions,
    JSON.stringify(permissions)
  )

  window.dispatchEvent(
    new CustomEvent(
      "bgi-role-permissions-updated",
      {
        detail: {
          roleCode,
          menuIds:
            permissions[roleCode],
        },
      }
    )
  )

  return true
}

export function roleHasMenuAccess(
  roleCode,
  menuId
) {
  if (roleCode === "SUPER_ADMIN") {
    return true
  }

  const allowedMenuIds =
    getRolePermissions(roleCode)

  return allowedMenuIds.includes(
    Number(menuId)
  )
}

export function resetRoleAccess(menuIds = []) {
  if (!isBrowser()) {
    return
  }

  window.localStorage.removeItem(
    ROLE_STORAGE_KEYS.roles
  )

  window.localStorage.removeItem(
    ROLE_STORAGE_KEYS.permissions
  )

  window.localStorage.removeItem(
    ROLE_STORAGE_KEYS.currentRole
  )

  initializeRoleAccess(menuIds)

  window.dispatchEvent(
    new Event("bgi-role-access-reset")
  )
}