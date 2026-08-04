import test from "node:test"
import assert from "node:assert/strict"

import {
  actionForHttpMethod,
  getPermissionColumn,
  normalizePermissionAction,
} from "../lib/permissions.js"

test("maps HTTP methods to CRUD permission actions", () => {
  assert.equal(actionForHttpMethod("GET"), "view")
  assert.equal(actionForHttpMethod("POST"), "create")
  assert.equal(actionForHttpMethod("PUT"), "update")
  assert.equal(actionForHttpMethod("PATCH"), "update")
  assert.equal(actionForHttpMethod("DELETE"), "delete")
})

test("rejects arbitrary permission column injection", () => {
  assert.equal(normalizePermissionAction("can_view OR 1=1"), "view")
  assert.equal(getPermissionColumn("can_view OR 1=1"), "can_view")
  assert.equal(getPermissionColumn("delete"), "can_delete")
})
