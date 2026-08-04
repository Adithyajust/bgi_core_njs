import test from "node:test"
import assert from "node:assert/strict"

import { validatePasswordPolicy } from "../lib/security/password-policy.js"

test("accepts a password that satisfies the policy", () => {
  assert.equal(validatePasswordPolicy("StrongPass1!"), null)
})

test("rejects weak passwords", () => {
  assert.match(validatePasswordPolicy("short"), /minimal 10/i)
  assert.match(validatePasswordPolicy("alllowercase1!"), /huruf besar/i)
  assert.match(validatePasswordPolicy("ALLUPPERCASE1!"), /huruf kecil/i)
  assert.match(validatePasswordPolicy("NoNumberHere!"), /angka/i)
  assert.match(validatePasswordPolicy("NoSpecial123"), /karakter khusus/i)
})
