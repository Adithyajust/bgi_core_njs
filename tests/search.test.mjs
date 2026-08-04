import test from "node:test"
import assert from "node:assert/strict"

import { createSearchPatterns, escapeLikePattern } from "../modules/master-mesin/search.js"

test("escapes SQL LIKE wildcard characters", () => {
  assert.equal(escapeLikePattern("A%_[]\\B"), "A\\%\\_\\[\\]\\\\B")
})

test("creates exact, prefix, and contains patterns", () => {
  assert.deepEqual(createSearchPatterns(" ATM% "), {
    normalized: "ATM%",
    exact: "ATM%",
    prefix: "ATM\\%%",
    contains: "%ATM\\%%",
  })
})
