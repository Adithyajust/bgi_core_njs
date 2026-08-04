import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

test("replenish list normalizes row-version tokens before JSON serialization", async () => {
  const route = await read("app/api/transactions/replenish/route.js")

  assert.match(route, /import \{ normalizeRowVersionToken \}/)
  assert.match(route, /pagedRows\.map/)
  assert.match(route, /row_version: normalizeRowVersionToken\(item\.row_version\)/)
})

test("replenish action UI does not send browser row-version tokens", async () => {
  const page = await read("app/transactions/replenish/page.jsx")

  assert.match(page, /body: JSON\.stringify\(\{ action, reason \}\)/)
  assert.doesNotMatch(page, /body: JSON\.stringify\(\{ action, reason, row_version/)
})

test("replenish PATCH uses the binary row-version from the locked SQL row", async () => {
  const route = await read("app/api/transactions/replenish/[id]/route.js")

  assert.match(route, /wo\.row_version AS row_version/)
  assert.match(route, /const lockedRowVersion = normalizeBinaryRowVersion\(current\.row_version\)/)
  assert.match(route, /input\("rowVersion", sql\.Binary\(8\), lockedRowVersion\)/)
  assert.match(route, /AND row_version = @rowVersion;/)
  assert.match(route, /X-Replenish-Action-Protocol/)
  assert.match(route, /SERVER_LOCKED_V2/)
  assert.doesNotMatch(route, /const requestedRowVersion = normalizeRowVersionToken/)
  assert.match(route, /ISOLATION_LEVEL\.SERIALIZABLE/)
  assert.match(route, /UPDLOCK, HOLDLOCK/)
})


test("replenish edit UI and PUT do not depend on browser row-version tokens", async () => {
  const page = await read("app/transactions/replenish/page.jsx")
  const route = await read("app/api/transactions/replenish/[id]/route.js")

  assert.doesNotMatch(page, /normalizeRowVersionToken/)
  assert.doesNotMatch(page, /form\.row_version/)
  assert.doesNotMatch(page, /row_version:\s*form/)
  assert.doesNotMatch(page, /savedWorkOrder\.row_version/)
  assert.doesNotMatch(route, /Versi data work order tidak valid/)

  const putSection = route.slice(
    route.indexOf("export async function PUT"),
    route.indexOf("export async function PATCH")
  )

  assert.match(putSection, /const lockedRowVersion = normalizeBinaryRowVersion\(current\.row_version\)/)
  assert.match(putSection, /input\("rowVersion", sql\.Binary\(8\), lockedRowVersion\)/)
  assert.match(putSection, /AND row_version = @rowVersion;/)
  assert.match(putSection, /SERVER_LOCKED_V3/)
  assert.doesNotMatch(putSection, /parsedBody\.body\.row_version/)
  assert.doesNotMatch(putSection, /CONVERT\(BINARY\(8\), @rowVersion, 1\)/)
})

test("all replenish mutation protocols are server locked", async () => {
  const route = await read("app/api/transactions/replenish/[id]/route.js")

  assert.match(route, /X-Replenish-Update-Protocol/)
  assert.match(route, /X-Replenish-Action-Protocol/)
  assert.equal((route.match(/UPDLOCK, HOLDLOCK/g) || []).length, 1)
  assert.match(route, /ISOLATION_LEVEL\.SERIALIZABLE/)
})
