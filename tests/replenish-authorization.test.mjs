import assert from "node:assert/strict"
import test from "node:test"

import {
  getReplenishApproverIdentity,
  isReplenishTeamApprover,
} from "../modules/replenish/authorization.js"

test("recognizes Manager Operasional from linked pegawai job title", () => {
  const user = {
    roleCode: "OPERATOR",
    roleName: "Operator",
    pegawai: { jabatan: "Manager Operasional" },
  }

  assert.equal(isReplenishTeamApprover(user), true)
  assert.equal(getReplenishApproverIdentity(user), "MANAGER_OPERASIONAL")
})

test("recognizes Asisten Manager CRO from server-side user shape", () => {
  const user = {
    role_code: "OPERATOR",
    role_name: "Operator",
    pegawai_jabatan: "Asisten Manager CRO",
  }

  assert.equal(isReplenishTeamApprover(user), true)
})

test("does not grant team approval to Asisten Manager CPC or Admin CRO", () => {
  assert.equal(
    isReplenishTeamApprover({ pegawai: { jabatan: "Asisten Manager CPC" } }),
    false
  )
  assert.equal(
    isReplenishTeamApprover({ roleCode: "OPERATOR", roleName: "Admin CRO" }),
    false
  )
})
