import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

import {
  calculatePointRequirements,
  materializeReplenishPoints,
  parseReplenishDenomination,
} from "../modules/replenish/calculation.js"

async function read(relativePath) {
  return fs.readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
}

function stripTsqlLiteralsAndComments(sqlText) {
  let result = ""
  let index = 0
  let state = "normal"

  while (index < sqlText.length) {
    const char = sqlText[index]
    const next = sqlText[index + 1] || ""

    if (state === "normal") {
      if (char === "'") {
        result += " "
        state = "string"
        index += 1
        continue
      }
      if (char === "-" && next === "-") {
        result += "  "
        state = "line-comment"
        index += 2
        continue
      }
      if (char === "/" && next === "*") {
        result += "  "
        state = "block-comment"
        index += 2
        continue
      }

      result += char
      index += 1
      continue
    }

    if (state === "string") {
      if (char === "'" && next === "'") {
        result += "  "
        index += 2
        continue
      }
      if (char === "'") {
        result += " "
        state = "normal"
        index += 1
        continue
      }

      result += char === "\n" ? "\n" : " "
      index += 1
      continue
    }

    if (state === "line-comment") {
      if (char === "\n") {
        result += "\n"
        state = "normal"
      } else {
        result += " "
      }
      index += 1
      continue
    }

    if (char === "*" && next === "/") {
      result += "  "
      state = "normal"
      index += 2
      continue
    }

    result += char === "\n" ? "\n" : " "
    index += 1
  }

  return result
}

test("parses a single numeric ATM denomination", () => {
  assert.equal(parseReplenishDenomination("50000"), 50000)
  assert.equal(parseReplenishDenomination("50.000"), 50000)
  assert.equal(parseReplenishDenomination("Rp 100.000"), 100000)
  assert.equal(parseReplenishDenomination("50.000 / 100.000"), null)
})

test("calculates nominal requirement and cassette requirement from pagu", () => {
  const result = calculatePointRequirements(4000, "50.000")

  assert.equal(result.error, null)
  assert.equal(result.requestedAmount, 200000000)
  assert.equal(result.cassetteCount, 2)
  assert.equal(result.denomination, 50000)
})

test("only accepts the configured pagu values", () => {
  assert.match(calculatePointRequirements(3000, 50000).error, /2000, 4000, 6000, atau 8000/i)
})

test("server materializes point amounts from master-machine denom instead of client amount", () => {
  const result = materializeReplenishPoints(
    [{ machineId: 10, sequenceNo: 1, activityType: "NORMAL", pagu: 8000, notes: null }],
    [{ id: 10, tid: "123456", sn: "SN-1", denom: "100000" }]
  )

  assert.equal(result.error, null)
  assert.equal(result.points[0].requestedAmount, 800000000)
  assert.equal(result.points[0].cassetteCount, 4)
  assert.equal(result.points[0].denominationValue, 100000)
})


test("server stores PENGOSONGAN without pagu, nominal, denomination, or cassette", () => {
  const result = materializeReplenishPoints(
    [{ machineId: 10, sequenceNo: 1, activityType: "PENGOSONGAN", pagu: 8000, notes: "Tarik seluruh kas" }],
    [{ id: 10, tid: "123456", sn: "SN-1", denom: "100000" }]
  )

  assert.equal(result.error, null)
  assert.equal(result.points[0].pagu, null)
  assert.equal(result.points[0].denominationValue, null)
  assert.equal(result.points[0].requestedAmount, null)
  assert.equal(result.points[0].cassetteCount, null)
  assert.equal(result.points[0].notes, "Tarik seluruh kas")
})

test("migration and UI persist point-level activity, pagu, and cassette calculation", async () => {
  const migration = await read("scripts/migrations/032-replenish-point-activity-pagu-cassette.sql")
  const page = await read("app/transactions/replenish/page.jsx")
  const database = await read("modules/replenish/database.js")
  const route = await read("app/api/transactions/replenish/route.js")

  assert.match(migration, /ADD activity_type VARCHAR\(20\)/i)
  assert.match(migration, /ADD pagu INT/i)
  assert.match(migration, /required_cassettes AS/i)
  assert.match(migration, /pagu \/ 2000/i)
  assert.match(migration, /requested_amount[\s\S]*pagu[\s\S]*denomination_value/i)
  assert.match(migration, /CAMPURAN/i)
  assert.match(migration, /SET @dropWoActivityConstraintSql[\s\S]*QUOTENAME\(@woActivityConstraint\)/i)
  assert.match(migration, /EXEC sys\.sp_executesql @dropWoActivityConstraintSql/i)
  assert.doesNotMatch(migration, /EXEC\s*\([\s\S]{0,160}QUOTENAME\(/i)

  const outerMigrationBatch = stripTsqlLiteralsAndComments(migration)
  assert.doesNotMatch(
    outerMigrationBatch,
    /\b(?:activity_type|pagu|denomination_value|required_cassettes)\b/i,
    "Kolom baru tidak boleh direferensikan langsung di outer batch migration SQL Server."
  )

  assert.match(page, /Pagu \/ jumlah lembar \*/)
  assert.match(page, /Kebutuhan kaset/)
  assert.match(page, /point\.activity_type === "PENGOSONGAN"/)
  assert.match(page, /pagu: point\.activity_type === "PENGOSONGAN" \? null : point\.pagu/)
  assert.match(page, /Keterangan pengosongan ATM\/CRM/)
  assert.match(page, /calculatePointRequirements/)
  assert.match(page, /activity_type: point\.activity_type/)
  assert.doesNotMatch(page, /activity_type: form\.activity_type/)
  assert.match(database, /parsed\.activity_type, parsed\.pagu, parsed\.denomination_value/)
  assert.match(route, /activity_point\.activity_type = @activityType/)
})
