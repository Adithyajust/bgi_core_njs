export const PERMISSION_ACTIONS = Object.freeze({
  VIEW: "view",
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
})

const ACTION_COLUMN_MAP = Object.freeze({
  [PERMISSION_ACTIONS.VIEW]: "can_view",
  [PERMISSION_ACTIONS.CREATE]: "can_create",
  [PERMISSION_ACTIONS.UPDATE]: "can_update",
  [PERMISSION_ACTIONS.DELETE]: "can_delete",
})

export function normalizePermissionAction(action) {
  const normalized = String(action || PERMISSION_ACTIONS.VIEW)
    .trim()
    .toLowerCase()

  return ACTION_COLUMN_MAP[normalized]
    ? normalized
    : PERMISSION_ACTIONS.VIEW
}

export function getPermissionColumn(action) {
  return ACTION_COLUMN_MAP[normalizePermissionAction(action)]
}

export function actionForHttpMethod(method) {
  switch (String(method || "GET").toUpperCase()) {
    case "POST":
      return PERMISSION_ACTIONS.CREATE
    case "PUT":
    case "PATCH":
      return PERMISSION_ACTIONS.UPDATE
    case "DELETE":
      return PERMISSION_ACTIONS.DELETE
    default:
      return PERMISSION_ACTIONS.VIEW
  }
}
