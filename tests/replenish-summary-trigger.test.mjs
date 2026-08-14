import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

test("replenish summary trigger materializes delta for all trigger statements", async () => {
  const migration = await read("scripts/migrations/033-fix-replenish-summary-trigger.sql")

  assert.match(migration, /CREATE OR ALTER TRIGGER dbo\.TR_replenish_work_orders_summary/i)
  assert.match(migration, /DECLARE @delta TABLE/i)
  assert.match(migration, /INSERT INTO @delta/i)
  assert.match(migration, /INNER JOIN @delta source/i)
  assert.match(migration, /FROM @delta source/i)
  assert.match(migration, /INNER JOIN @delta affected/i)
  assert.doesNotMatch(migration, /\),\s*delta\s+AS\s*\(/i)
})

test("replenish summary repair rebuilds aggregate data before replacing trigger", async () => {
  const migration = await read("scripts/migrations/033-fix-replenish-summary-trigger.sql")

  const rebuildIndex = migration.indexOf("DELETE FROM dbo.replenish_work_order_summary")
  const triggerIndex = migration.indexOf("CREATE OR ALTER TRIGGER")

  assert.ok(rebuildIndex >= 0)
  assert.ok(triggerIndex > rebuildIndex)
  assert.match(migration, /FROM dbo\.replenish_work_orders\s+GROUP BY uker_id/i)
})


test("replenish create captures inserted id through OUTPUT INTO when trigger is enabled", async () => {
  const route = await read("app/api/transactions/replenish/route.js")

  assert.match(route, /DECLARE @insertedWorkOrder TABLE/i)
  assert.match(route, /OUTPUT inserted\.id INTO @insertedWorkOrder \(id\)/i)
  assert.match(route, /SELECT id\s+FROM @insertedWorkOrder/i)
  assert.doesNotMatch(route, /OUTPUT inserted\.id\s+VALUES/i)
})
