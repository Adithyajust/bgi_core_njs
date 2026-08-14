import assert from "node:assert/strict"
import test from "node:test"

import {
  getReplenishApproverIdentity,
  isReplenishFieldCustody,
  isReplenishFieldDriver,
  isReplenishFieldSupervisor,
  isReplenishAdmin,
  isReplenishKeyHandoverPrinter,
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

test("field roles separate Custody, Driver, and supervisor capabilities", () => {
  assert.equal(isReplenishFieldCustody({ pegawai_jabatan: "Custody" }), true)
  assert.equal(isReplenishFieldCustody({ pegawai_jabatan: "Driver" }), false)
  assert.equal(isReplenishFieldDriver({ roleCode: "PENGEMUDI" }), true)
  assert.equal(isReplenishFieldDriver({ pegawai: { jabatan: "Driver" } }), true)
  assert.equal(isReplenishFieldSupervisor({ roleCode: "MANAGER_OPERASIONAL" }), true)
  assert.equal(isReplenishFieldSupervisor({ roleCode: "CUSTODY" }), false)
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

test("approval is limited to Manager Operasional and Asisten Manager CRO", () => {
  assert.equal(isReplenishTeamApprover({ roleCode: "MANAGER" }), false)
  assert.equal(isReplenishTeamApprover({ roleCode: "MANAGER_CRO" }), false)
  assert.equal(isReplenishTeamApprover({ roleCode: "ASISTEN_MANAGER_OPERASIONAL" }), false)
  assert.equal(isReplenishTeamApprover({ roleCode: "MANAGER_OPERASIONAL" }), true)
  assert.equal(isReplenishTeamApprover({ roleCode: "ASISTEN_MANAGER_CRO" }), true)
})


test("key handover printing recognizes admin and manager aliases used by legacy and current databases", () => {
  assert.equal(isReplenishAdmin({ roleCode: "OPERATOR", roleName: "Admin CRO" }), true)
  assert.equal(isReplenishAdmin({ pegawai: { jabatan: "Admin CRO" } }), true)
  assert.equal(isReplenishKeyHandoverPrinter({ roleCode: "ADMIN_CRO" }), true)
  assert.equal(isReplenishKeyHandoverPrinter({ roleCode: "USER_ADMIN" }), true)
  assert.equal(isReplenishKeyHandoverPrinter({ roleCode: "MANAGER" }), true)
  assert.equal(isReplenishKeyHandoverPrinter({ roleCode: "MANAGER_CRO" }), true)
  assert.equal(isReplenishKeyHandoverPrinter({ roleCode: "MANAGER_OPERASIONAL" }), true)
  assert.equal(isReplenishKeyHandoverPrinter({ roleCode: "ASISTEN_MANAGER_OPERASIONAL" }), true)
  assert.equal(isReplenishKeyHandoverPrinter({ roleCode: "AUDITOR" }), false)
})
