import test from "node:test"
import assert from "node:assert/strict"

import {
  buildCursorPagination,
  normalizeCursor,
  normalizePositiveInteger,
} from "../lib/database/pagination.js"

test("normalizes bounded positive integers", () => {
  assert.equal(normalizePositiveInteger("20", 10, 50), 20)
  assert.equal(normalizePositiveInteger("100", 10, 50), 50)
  assert.equal(normalizePositiveInteger("invalid", 10, 50), 10)
})

test("builds a stable cursor response", () => {
  const result = buildCursorPagination([{ id: 10 }, { id: 9 }, { id: 8 }], 2)
  assert.deepEqual(result.items, [{ id: 10 }, { id: 9 }])
  assert.equal(result.pagination.has_more, true)
  assert.equal(result.pagination.next_cursor, "9")
  assert.equal(normalizeCursor("9"), 9)
})
