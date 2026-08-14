import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const machineKeyRouteSource = await readFile(
  new URL("../app/api/masters/kunci-mesin/route.js", import.meta.url),
  "utf8"
)
const machineRouteSource = await readFile(
  new URL("../app/api/masters/mesin/route.js", import.meta.url),
  "utf8"
)

const validEscapeLiteral = String.raw`ESCAPE '\\'`
const invalidEscapeLiteral = String.raw`ESCAPE '\'`

function countOccurrences(source, value) {
  return source.split(value).length - 1
}

test("SQL LIKE clauses preserve a one-character backslash escape at runtime", () => {
  assert.equal(countOccurrences(machineKeyRouteSource, validEscapeLiteral), 7)
  assert.equal(countOccurrences(machineRouteSource, validEscapeLiteral) >= 11, true)

  assert.equal(machineKeyRouteSource.includes(invalidEscapeLiteral), false)
  assert.equal(machineRouteSource.includes(invalidEscapeLiteral), false)
})
