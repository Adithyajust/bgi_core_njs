import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const routeSource = await readFile(
  new URL("../app/api/masters/mesin/import/route.js", import.meta.url),
  "utf8"
)

test("import preflight wraps CHECK values with SQL quote characters", () => {
  const quoteExpressionCount = (
    routeSource.match(/NCHAR\(39\)\s*\+/g) || []
  ).length

  assert.equal(quoteExpressionCount, 2)
  assert.doesNotMatch(
    routeSource,
    /\bN\s*\+\s*LTRIM\(RTRIM\(source\.waktu_ops\)\)\s*\+\s*N\b/
  )
})
