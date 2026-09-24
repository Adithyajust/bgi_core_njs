import test from "node:test"
import assert from "node:assert/strict"
import * as nodeModule from "node:module"

// Exercise transaction control with an adapter. SQL execution still needs SQL Server in staging.
const state = { events: [], master: { revision: 2, items: [] }, batch: { report_revision: 4, reporting_uker_id: 10 }, tids: [], failChunk: 0, auditFails: false }
globalThis.__rplParameterTx = state
const moduleUrl = source => `data:text/javascript,${encodeURIComponent(source)}`
const mockSql = moduleUrl(`
  class Transaction {
    async begin(){globalThis.__rplParameterTx.events.push('begin')}
    async commit(){globalThis.__rplParameterTx.events.push('commit')}
    async rollback(){globalThis.__rplParameterTx.events.push('rollback')}
  }
  class Request {
    constructor(){this.values={}}
    input(name,type,value){this.values[name]=value;return this}
    async query(text){return globalThis.__rplParameterTx.query(text,this.values)}
  }
  export const sql={Transaction,Request,Int:'int',BigInt:'bigint',MAX:'max',NVarChar:n=>'nvarchar',VarChar:n=>'varchar',Char:n=>'char',Decimal:()=> 'decimal'};
  export async function connectDB(){return {}}
`)
const mockAudit = moduleUrl(`export async function insertAuditLog(tx,event){const s=globalThis.__rplParameterTx;s.events.push('audit');s.audit=event;if(s.auditFails)throw new Error('audit unavailable')}`)
const supported = typeof nodeModule.registerHooks === "function"
const hooks = supported ? nodeModule.registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@/lib/mssql") return { url: mockSql, shortCircuit: true }
  if (specifier === "@/lib/security/audit-log") return { url: mockAudit, shortCircuit: true }
  return next(specifier, context)
} }) : null
const { saveParameterMaster, applyMasterToBatch } = supported ? await import("../modules/rpl-terjadwal/parameter-database.js") : {}
const { saveUpload } = supported ? await import("../modules/rpl-terjadwal/database.js") : {}
hooks?.deregister()
const txTest = (name, run) => test(name, { skip: !supported && "Requires Node 22.15+ or Node 24." }, run)

function reset() {
  Object.assign(state, { events: [], master: { revision: 2, items: [] }, batch: { report_revision: 4, reporting_uker_id: 10 }, tids: [], failChunk: 0, auditFails: false, chunks: [], units: [] })
  state.query = async (query, values) => {
    if (query.includes("sp_getapplock")) { state.events.push(`lock:${values.mode}:${values.resource}`); return { recordset: [{ lock_result: 0 }] } }
    if (query.includes("SELECT revision FROM")) { state.units.push(values.uker); return { recordsets: [[{ revision: state.master.revision }], state.master.items] } }
    if (query.includes("SELECT report_revision,reporting_uker_id")) { state.events.push(`batch:${values.batch}`); return { recordsets: [[state.batch], state.tids.map(tid => ({ tid }))] } }
    if (values.rows) {
      const rows = JSON.parse(values.rows); state.chunks.push(rows); state.events.push(`rows:${rows.length}`)
      if (state.failChunk === state.chunks.length) throw new Error("write failed")
    } else state.events.push("write")
    return { recordset: [] }
  }
}
const row = tid => ({ tid, location: "Lokasi", branch: "BG", machine_type: "ATM", denom: "50000", cluster_flm: "FLM", cluster: "RPL", sub_cluster_rpl: "SUB" })
const options = () => ({ ukerId: 10, revision: 2, user: { id: 1 }, request: new Request("http://localhost") })
const apply = () => ({ batch: 11, revision: 4, ukerId: 10, parameterRevision: 2 })

txTest("stale master revision rolls back before any mutation or audit", async () => {
  reset()
  await assert.rejects(saveParameterMaster([row("1")], { ...options(), revision: 1 }), e => e.status === 409)
  assert.deepEqual(state.events, ["begin", "lock:Exclusive:rpl-tid-parameters:10", "rollback"])
})
txTest("upsert counts new/existing rows, scopes by unit and commits after its audit", async () => {
  reset(); state.master.items = [row("1")]
  const result = await saveParameterMaster([row("1"), row("2")], options())
  assert.deepEqual(result, { revision: 3, inserted: 1, updated: 1, total: 2 })
  assert.deepEqual(state.units, [10]); assert.deepEqual(state.events.slice(-2), ["audit", "commit"])
  assert.equal(state.audit.entityType, "rpl_tid_parameter_master")
})
txTest("failure in a later import chunk rolls back the complete operation", async () => {
  reset(); state.failChunk = 2
  await assert.rejects(saveParameterMaster(Array.from({ length: 501 }, (_, i) => row(String(i))), options()), /write failed/)
  assert.equal(state.chunks[0].length, 500); assert.equal(state.chunks[1].length, 1)
  assert.equal(state.events.at(-1), "rollback"); assert.ok(!state.events.includes("commit")); assert.ok(!state.events.includes("audit"))
})
txTest("audit failure rolls back the parameter write", async () => {
  reset(); state.auditFails = true
  await assert.rejects(saveParameterMaster([row("1")], options()), /audit unavailable/)
  assert.deepEqual(state.events.slice(-2), ["audit", "rollback"]); assert.ok(!state.events.includes("commit"))
})
txTest("single-row edit cannot silently create a missing TID", async () => {
  reset()
  await assert.rejects(saveParameterMaster([row("1")], { ...options(), editOnly: true }), e => e.status === 404)
  assert.equal(state.chunks.length, 0); assert.equal(state.events.at(-1), "rollback")
})
txTest("applying a master checks both revisions and unit ownership before changes", async () => {
  for (const change of [{ parameterRevision: 1 }, { revision: 3 }, { ukerId: 20 }]) {
    reset(); state.master.items = [row("1")]; state.tids = ["1"]
    await assert.rejects(applyMasterToBatch({ ...apply(), ...change }, options()), e => [409, 422].includes(e.status))
    assert.equal(state.chunks.length, 0); assert.equal(state.events.at(-1), "rollback")
  }
})
txTest("apply updates only matching TIDs of the selected batch and reports unmatched TIDs", async () => {
  reset(); state.master.items = [row("1"), row("OTHER")]; state.tids = ["1", "2"]
  const result = await applyMasterToBatch(apply(), options())
  assert.deepEqual(result, { revision: 5, matched: 1, unmatched: 1 })
  assert.deepEqual(state.chunks.flat().map(p => p.tid), ["1"])
  assert.ok(state.events.indexOf("lock:Shared:rpl-tid-parameters:10") < state.events.indexOf("batch:11"))
  assert.equal(state.audit.entityId, 11); assert.deepEqual(state.events.slice(-2), ["audit", "commit"])
})
txTest("RPL commit catches a master change after API preview before inserting the batch", async () => {
  reset()
  await assert.rejects(saveUpload({ parameter_revision: 1 }, options()), e => e.status === 409)
  assert.deepEqual(state.events, ["begin", "lock:Shared:rpl-tid-parameters:10", "rollback"])
})
