import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"

const root = process.cwd()

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8")
}

test("Master Mesin uses keyset pagination and no OFFSET", async () => {
  const source = await read("app/api/masters/mesin/route.js")
  assert.match(source, /after_id/)
  assert.match(source, /ms\.id < @afterId/)
  assert.doesNotMatch(source, /\bOFFSET\b/i)
})

test("mutating Master Mesin endpoints request action permissions", async () => {
  const source = await read("app/api/masters/mesin/route.js")
  assert.match(source, /authorizeMaster\(request, "create"\)/)
  assert.match(source, /authorizeMaster\(request, "update"\)/)
  assert.match(source, /authorizeMaster\(request, "delete"\)/)
})

test("database initialization does not seed static passwords", async () => {
  const source = await read("scripts/init-db.mjs")
  assert.doesNotMatch(source, /123456|passwordHash|seedUsers/i)
  assert.match(source, /migrate\.mjs/)
})

test("employee photos are stored outside public directory", async () => {
  const source = await read("lib/pegawai-photo.js")
  assert.match(source, /storage["'], ["']private/)
  assert.doesNotMatch(source, /public["'], ["']uploads/)
  assert.match(source, /\/api\/masters\/pegawai\/photo\//)
})

test("migration runner uses an application lock and checksum", async () => {
  const source = await read("scripts/migrate.mjs")
  assert.match(source, /sp_getapplock/)
  assert.match(source, /createHash\("sha256"\)/)
  assert.match(source, /ISOLATION_LEVEL\.SERIALIZABLE/)
})

test("mandatory password change is enforced by server authorization", async () => {
  const accessControl = await read("lib/access-control.js")
  const changePassword = await read("app/api/auth/change-password/route.js")
  assert.match(accessControl, /PASSWORD_CHANGE_REQUIRED/)
  assert.match(accessControl, /redirect\("\/change-password"\)/)
  assert.match(changePassword, /must_change_password = 0/)
  assert.match(changePassword, /session_token_hash <> @currentSessionHash/)
})

test("liveness and readiness endpoints do not expose database errors", async () => {
  const readiness = await read("app/api/health/ready/route.js")
  assert.match(readiness, /status: "not_ready"/)
  assert.doesNotMatch(readiness, /error\.message/)
})

test("repository has no employee photos under public uploads", async () => {
  await assert.rejects(
    fs.access(path.join(root, "public", "uploads", "pegawai")),
    /ENOENT/
  )
})

test("legacy navigation bridge runs before core schema and repairs timestamp columns", async () => {
  const migrationsDirectory = path.join(root, "scripts", "migrations")
  const files = (await fs.readdir(migrationsDirectory))
    .filter((file) => /^\d+.*\.sql$/i.test(file))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))

  const bridgeName = "000-01-legacy-navigation-bridge.sql"
  const coreName = "000-core-schema.sql"
  assert.ok(files.indexOf(bridgeName) >= 0)
  assert.ok(files.indexOf(bridgeName) < files.indexOf(coreName))

  const bridge = await read(`scripts/migrations/${bridgeName}`)
  assert.match(bridge, /dbo\.sidebar_routes[\s\S]*updated_at/i)
  assert.match(bridge, /dbo\.navbar_routes[\s\S]*updated_at/i)
  assert.match(bridge, /dbo\.role_sidebar_routes[\s\S]*can_create/i)
  assert.match(bridge, /dbo\.role_sidebar_routes[\s\S]*can_update/i)
  assert.match(bridge, /dbo\.role_sidebar_routes[\s\S]*can_delete/i)
})


test("legacy role defaults bridge runs before core schema", async () => {
  const migrationsDirectory = path.join(root, "scripts", "migrations")
  const files = (await fs.readdir(migrationsDirectory))
    .filter((file) => /^\d+.*\.sql$/i.test(file))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))

  const bridgeName = "000-02-legacy-role-defaults.sql"
  const coreName = "000-core-schema.sql"
  assert.ok(files.indexOf(bridgeName) >= 0)
  assert.ok(files.indexOf(bridgeName) < files.indexOf(coreName))

  const bridge = await read(`scripts/migrations/${bridgeName}`)
  assert.match(bridge, /dbo\.roles[\s\S]*is_active/i)
  assert.match(bridge, /DEFAULT \(1\) FOR is_active/i)
  assert.match(bridge, /DEFAULT \(SYSDATETIME\(\)\) FOR created_at/i)
  assert.match(bridge, /DEFAULT \(SYSDATETIME\(\)\) FOR updated_at/i)
  assert.match(bridge, /sys\.default_constraints/i)
})
