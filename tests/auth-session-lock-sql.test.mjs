import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const authSource = await readFile(
  new URL("../lib/auth.js", import.meta.url),
  "utf8"
)

test("session applock resource is prepared before EXEC", () => {
  assert.match(
    authSource,
    /DECLARE\s+@sessionLockResource\s+NVARCHAR\(255\)/i
  )
  assert.match(
    authSource,
    /SET\s+@sessionLockResource\s*=\s*CONCAT\(/i
  )
  assert.match(
    authSource,
    /@Resource\s*=\s*@sessionLockResource/i
  )
  assert.doesNotMatch(
    authSource,
    /@Resource\s*=\s*CONCAT\(/i
  )
})
