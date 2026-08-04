import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

const auditedCrudRoutes = [
  ["masters/kanwil", "masters.kanwil", "master_kanwil"],
  ["masters/cabang", "masters.cabang", "master_cabang"],
  ["masters/uker", "masters.uker", "master_uker"],
  ["masters/pegawai", "masters.pegawai", "pegawai"],
  ["masters/merk", "masters.merk", "master_merk"],
  ["masters/tipe-mesin", "masters.tipe_mesin", "master_tipe_mesin"],
  ["masters/project", "masters.project", "master_project"],
  ["masters/mesin", "masters.mesin", "master_mesin"],
  ["masters/kendaraan", "masters.kendaraan", "master_kendaraan"],
  ["settings/side-menu", "settings.side_menu", "sidebar_route"],
]

function extractExportedMethod(source, method) {
  const signature = `export async function ${method}(request)`
  const start = source.indexOf(signature)

  assert.notEqual(start, -1, `${method} handler is missing`)

  const openingBrace = source.indexOf("{", start + signature.length)
  let depth = 0
  let quote = null
  let escaped = false

  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index]

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (character === "\\") {
        escaped = true
      } else if (character === quote) {
        quote = null
      }
      continue
    }

    if (["\"", "'", "`"].includes(character)) {
      quote = character
    } else if (character === "{") {
      depth += 1
    } else if (character === "}") {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }

  assert.fail(`${method} handler has unbalanced braces`)
}

test("all CRUD menu handlers write the matching audit action", async () => {
  for (const [routeName, moduleName, entityType] of auditedCrudRoutes) {
    const routePath = new URL(`../app/api/${routeName}/route.js`, import.meta.url)
    const source = await fs.readFile(routePath, "utf8")

    assert.match(source, /import \{ writeAuditLog \}/, routeName)

    for (const [method, action] of [
      ["POST", "CREATE"],
      ["PUT", "UPDATE"],
      ["DELETE", "DELETE"],
    ]) {
      const handler = extractExportedMethod(source, method)
      assert.match(handler, new RegExp(`action: "${action}"`), `${routeName} ${method}`)
      assert.match(
        handler,
        new RegExp(`module: "${moduleName.replaceAll(".", "\\.")}"`),
        `${routeName} ${method}`
      )
      assert.match(
        handler,
        new RegExp(`entityType: "${entityType}"`),
        `${routeName} ${method}`
      )
    }
  }
})

test("user-role mutations and administrative actions are audited without passwords", async () => {
  const routePath = new URL(
    "../app/api/settings/user-role/route.js",
    import.meta.url
  )
  const source = await fs.readFile(routePath, "utf8")

  for (const [method, action] of [
    ["POST", "CREATE"],
    ["PUT", "UPDATE"],
    ["DELETE", "DELETE"],
  ]) {
    const handler = extractExportedMethod(source, method)
    assert.match(handler, new RegExp(`action: "${action}"`), `${method} ${action}`)
    assert.match(handler, /module: "settings\.user_role"/)
  }

  const patchHandler = extractExportedMethod(source, "PATCH")
  for (const action of ["UNLOCK_USER", "RESET_PASSWORD", "UPDATE_PERMISSIONS"]) {
    assert.match(patchHandler, new RegExp(`action: "${action}"`), action)
  }

  assert.doesNotMatch(source, /metadata:\s*\{[\s\S]{0,300}password_hash/)
  assert.doesNotMatch(source, /metadata:\s*\{[\s\S]{0,300}\bpassword\s*:/)
})

test("audit metadata serialization handles non-JSON values and redacts secrets", async () => {
  const helperPath = new URL(
    "../lib/security/audit-log.js",
    import.meta.url
  )
  const source = await fs.readFile(helperPath, "utf8")

  assert.match(source, /typeof value === "bigint"/)
  assert.match(source, /Buffer\.isBuffer\(value\)/)
  assert.match(source, /"\[Circular\]"/)
  assert.match(source, /SENSITIVE_METADATA_KEYS/)
  assert.match(source, /"\[REDACTED\]"/)
  assert.match(source, /userId === null/)
  assert.match(source, /normalizedUserId <= 0/)
})

test("audit user foreign key preserves logs when a user is deleted", async () => {
  const migrationPath = new URL(
    "../scripts/migrations/014-audit-log-all-menus.sql",
    import.meta.url
  )
  const source = await fs.readFile(migrationPath, "utf8")

  assert.match(source, /FOREIGN KEY \(user_id\)/)
  assert.match(source, /ON DELETE SET NULL/)
  assert.match(source, /CREATE VIEW dbo\.audit_log/)
  assert.match(source, /SET @dropAuditForeignKeySql[\s\S]*QUOTENAME\(@auditUserForeignKey\)/)
  assert.match(source, /EXEC sys\.sp_executesql @dropAuditForeignKeySql/)
  assert.doesNotMatch(source, /EXEC\s*\([\s\S]{0,120}QUOTENAME\(/)
})

test("authentication events are written to the audit log", async () => {
  const loginPath = new URL(
    "../app/api/auth/login/route.js",
    import.meta.url
  )
  const loginSource = await fs.readFile(loginPath, "utf8")
  const loginHandler = extractExportedMethod(loginSource, "POST")

  assert.match(loginSource, /import \{ writeAuditLog \}/)
  assert.match(loginHandler, /action: "LOGIN_SUCCESS"/)
  assert.match(loginHandler, /action: "LOGIN_FAILED"/)
  assert.match(loginHandler, /action: "LOGIN_DENIED"/)
  assert.match(loginHandler, /action: "LOGIN_THROTTLED"/)
  assert.match(loginHandler, /module: "auth\.login"/)
  assert.doesNotMatch(loginHandler, /metadata:\s*\{[\s\S]{0,300}\bpassword\s*:/)

  const logoutPath = new URL(
    "../app/api/auth/logout/route.js",
    import.meta.url
  )
  const logoutSource = await fs.readFile(logoutPath, "utf8")
  const logoutHandler = extractExportedMethod(logoutSource, "POST")

  assert.match(logoutSource, /import \{ writeAuditLog \}/)
  assert.match(logoutHandler, /action: "LOGOUT"/)
  assert.match(logoutHandler, /module: "auth\.logout"/)
})
