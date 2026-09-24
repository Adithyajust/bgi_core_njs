import test from "node:test"
import assert from "node:assert/strict"
import * as nodeModule from "node:module"
import { readFile } from "node:fs/promises"
import { DEFAULT_SETTINGS } from "../modules/rpl-terjadwal/calculations.js"
import { PARAMETER_HEADERS, PARAMETER_SHEET } from "../modules/rpl-terjadwal/parameters.js"
import { DETAIL_HEADERS, SHEETS } from "../modules/rpl-terjadwal/workbook.js"
import { xlsxFixture } from "./helpers/rpl-xlsx.mjs"

const state = { role: "SUPER_ADMIN", actions: [], writes: 0, reports: 0, deny: false, master: {revision: 0, items: []}, lastWrite: null }
globalThis.__rplApiTest = state
const asModule = source => `data:text/javascript,${encodeURIComponent(source)}`
const mockAuth = asModule(`
  export const isSuperAdmin = user => user?.role_code === 'SUPER_ADMIN';
  export async function authorizeApiRequest(request, route, action) {
    const s = globalThis.__rplApiTest; s.actions.push(action);
    return s.deny ? {authorized:false,response:Response.json({success:false},{status:401})} : {authorized:true,user:{id:1,role_code:s.role}};
  }`)
const mockDb = asModule(`
  export async function listUploads(){ return {items:[],has_more:false} }
  export async function getUploadRows(){ return {items:[],has_more:false} }
  export async function saveUpload(data,options){ globalThis.__rplApiTest.lastWrite={data,options};globalThis.__rplApiTest.writes++; return 1 }
  export async function saveReportEdit(data){ globalThis.__rplApiTest.writes++; return {revision:data.revision+1} }
  export async function getReportData(id){ globalThis.__rplApiTest.reports++; return {id,period:'2026-08',planning:[],dsr:[],parameters:[],settings:{}} }
  export async function listReportingUkerOptions(){ return [] }
  export async function resolveReportingUker(id){ return Number(id) === 10 ? {id:10,nama_uker:"BG UJI"} : null }
`)
const mockParameters = asModule(`
  export async function getParameterMaster(){return globalThis.__rplApiTest.master}
  export async function saveParameterMaster(rows, options){const s=globalThis.__rplApiTest;s.lastWrite={rows,options}; if(options.revision!==s.master.revision) { const e=new Error('conflict'); e.number=2627;throw e };s.writes++;return {revision:options.revision+1,inserted:rows.length,updated:0}}
  export async function applyMasterToBatch(data){globalThis.__rplApiTest.writes++;return {revision:data.revision+1,matched:1,unmatched:0}}
`)
const supported = typeof nodeModule.registerHooks === "function"
const hooks = supported ? nodeModule.registerHooks({ resolve(specifier, context, next) {
  if (specifier === "next/server") return { url: asModule("export const NextResponse={json:(data,options)=>Response.json(data,options)}"), shortCircuit: true }
  if (specifier === "@/lib/access-control") return { url: mockAuth, shortCircuit: true }
  if (specifier === "@/modules/rpl-terjadwal/database") return { url: mockDb, shortCircuit: true }
  if (specifier === "@/modules/rpl-terjadwal/parameter-database") return { url: mockParameters, shortCircuit: true }
  if (specifier.startsWith("@/modules/rpl-terjadwal/")) return { url: new URL(`../${specifier.slice(2)}.js`, import.meta.url).href, shortCircuit: true }
  return next(specifier, context)
} }) : null
const api = supported ? await import("../app/api/rpl-terjadwal/route.js") : null
const parameterApi = supported ? await import("../app/api/rpl-terjadwal/parameters/route.js") : null
hooks?.deregister()
const apiTest = (name, run) => test(name, { skip: !supported && "Module hooks require Node 22.15+ or Node 24." }, run)
const request = (query, method = "GET", data) => new Request(`http://localhost/api/rpl-terjadwal${query}`, { method, headers: method !== "GET" ? { "Content-Type": "application/json", Origin: "http://localhost" } : {}, ...(data ? { body: JSON.stringify(data) } : {}) })

apiTest("every endpoint including template denies non-superadmins before accessing data", async () => {
  state.role = "STAFF"; state.writes = 0; state.reports = 0
  for (const [method, query] of [["GET", "?template=1"], ["GET", "?batch=1&view=schedule"], ["POST", "?mode=preview"], ["PATCH", ""]]) {
    assert.equal((await api[method](request(query, method, method === "PATCH" ? {} : null))).status, 403)
  }
  assert.equal(state.writes, 0); assert.equal(state.reports, 0)
  state.role = "SUPER_ADMIN"
})
apiTest("missing session is rejected before template or reporting", async () => {
  state.deny = true
  assert.equal((await api.GET(request("?template=1"))).status, 401)
  state.deny = false
})
apiTest("PATCH requires update authorization and validates before any write", async () => {
  state.actions = []; state.writes = 0
  const edit = { type: "settings", batch: 1, revision: 0, settings: { ...DEFAULT_SETTINGS } }
  const invalid = await api.PATCH(request("", "PATCH", { ...edit, settings: { ...DEFAULT_SETTINGS, team_capacity: 0 } }))
  assert.equal(invalid.status, 422); assert.equal(state.writes, 0)
  const response = await api.PATCH(request("", "PATCH", edit))
  assert.equal(response.status, 200); assert.equal(state.writes, 1)
  assert.deepEqual(state.actions, ["update", "update"])
  assert.equal((await response.json()).data.revision, 1)
})
apiTest("report filter validation blocks unexpected views, invalid paging and injected identifiers", async () => {
  state.reports = 0
  for (const q of ["?batch=1&view=other", "?batch=-1&view=schedule", "?batch=1&view=schedule&page=900", "?batch=1&view=dsr&machine=DELETE"]) assert.equal((await api.GET(request(q))).status, 400)
  assert.equal(state.reports, 0)
  const response = await api.GET(request("?batch=1&view=schedule"))
  const body = await response.json()
  assert.equal(response.status, 200); assert.equal(body.data.days, 31)
})
apiTest("PATCH rejects oversized body before mutation", async () => {
  state.writes = 0
  const response = await api.PATCH(request("", "PATCH", { note: "x".repeat(70000) }))
  assert.equal(response.status, 413); assert.equal(state.writes, 0)
})
apiTest("template download returns real XLSX bytes with attachment headers", async () => {
  const response = await api.GET(request("?template=1"))
  assert.equal(response.status, 200)
  assert.match(response.headers.get("Content-Disposition"), /attachment/)
  const expected = await readFile(new URL("../modules/rpl-terjadwal/templates/RPL-Template-Upload.xlsx", import.meta.url))
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected)
})

const parameterRow = ["001", "Lokasi", "BG UJI", "ATM", "50000", "FLM", "RPL", "SUB"]
const parameterBytes = () => xlsxFixture({ [PARAMETER_SHEET]: [PARAMETER_HEADERS, parameterRow] })
const postBytes = (query, bytes) => new Request(`http://localhost/api/rpl-terjadwal${query}`, { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/octet-stream" }, body: bytes })

apiTest("standalone parameter endpoints all enforce superadmin before any read or write", async () => {
  state.role = "STAFF"; state.writes = 0
  for (const [method, query] of [["GET", "?template=1"], ["GET", "?uker_id=10"], ["POST", "?mode=preview&uker_id=10"], ["PATCH", ""]]) {
    assert.equal((await parameterApi[method](request(query, method, method === "PATCH" ? {} : null))).status, 403)
  }
  assert.equal(state.writes, 0); state.role = "SUPER_ADMIN"
})
apiTest("parameter preview and commit work without a period, require update, and validate the file hash", async () => {
  state.writes = 0; state.actions = []; state.master = { revision: 3, items: [] }
  const bytes = parameterBytes(), query = "?uker_id=10&file_name=params.xlsx&mode="
  const preview = await parameterApi.POST(postBytes(`${query}preview`, bytes))
  assert.equal(preview.status, 200)
  const data = (await preview.json()).data
  assert.equal(data.total, 1); assert.equal(data.inserted, 1); assert.equal(data.revision, 3); assert.equal(state.writes, 0)
  assert.equal((await parameterApi.POST(postBytes(`${query}commit&revision=3&preview_hash=wrong`, bytes))).status, 409)
  assert.equal((await parameterApi.POST(postBytes(`${query}commit&preview_hash=${data.file_hash}`, bytes))).status, 409)
  const response = await parameterApi.POST(postBytes(`${query}commit&revision=3&preview_hash=${data.file_hash}`, bytes))
  assert.equal(response.status, 200); assert.equal(state.writes, 1)
  assert.ok(state.actions.every(a => a === "update"))
  assert.equal(state.lastWrite.options.ukerId, 10); assert.equal(state.lastWrite.rows[0].tid, "001")
})
apiTest("parameter validation blocks duplicate TIDs and invalid units before mutation", async () => {
  state.writes = 0
  const duplicate = xlsxFixture({ [PARAMETER_SHEET]: [PARAMETER_HEADERS, parameterRow, parameterRow] })
  const response = await parameterApi.POST(postBytes("?uker_id=10&file_name=p.xlsx&mode=commit", duplicate))
  assert.equal(response.status, 422); assert.equal((await response.json()).data.error_count, 1)
  assert.equal((await parameterApi.POST(postBytes("?uker_id=999&file_name=p.xlsx&mode=preview", parameterBytes()))).status, 422)
  assert.equal(state.writes, 0)
})
apiTest("parameter GET paginates, filters and validates page input", async () => {
  state.master = { revision: 9, items: Array.from({ length: 55 }, (_, i) => ({ tid: `TID${i}`, location: "Lokasi", branch: "BG", cluster: "RPL", cluster_flm: "", sub_cluster_rpl: "" })) }
  const result = await parameterApi.GET(request("?uker_id=10&page=1"))
  const data = (await result.json()).data
  assert.equal(data.items.length, 5); assert.equal(data.total, 55); assert.equal(data.revision, 9)
  assert.equal((await parameterApi.GET(request("?uker_id=10&page=-1"))).status, 400)
  const filtered = await parameterApi.GET(request("?uker_id=10&search=TID54"))
  assert.equal((await filtered.json()).data.total, 1)
})
apiTest("parameter PATCH rejects malformed JSON, invalid edit/apply requests and oversized bodies", async () => {
  state.writes = 0
  for (const input of [null, [], {}, { type: "apply", uker_id: 10, revision: 0, batch: 1 }, { type: "apply", uker_id: 10, revision: 0, batch: -1, parameter_revision: 0 }, { type: "edit", uker_id: 10, revision: 0, parameter: {} }]) {
    const response = await parameterApi.PATCH(new Request("http://localhost/api/rpl-terjadwal/parameters", { method: "PATCH", body: JSON.stringify(input) }))
    assert.equal(response.status, 422)
  }
  assert.equal((await parameterApi.PATCH(request("", "PATCH", { x: "x".repeat(70000) }))).status, 413)
  assert.equal(state.writes, 0)
})
apiTest("standalone parameter template downloads the separate workbook", async () => {
  const result = await parameterApi.GET(request("?template=1"))
  assert.equal(result.status, 200)
  const bytes = await readFile(new URL("../modules/rpl-terjadwal/templates/RPL-Template-Parameter.xlsx", import.meta.url))
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes)
})
apiTest("RPL preview applies master denominations and commit rejects a stale parameter revision", async () => {
  const row = ["1", "001", "Lokasi", "ATM", "RPL", "4000", "Ya", "", "", ""]
  const bytes = xlsxFixture({ [SHEETS[0]]: [DETAIL_HEADERS.planning, row], [SHEETS[1]]: [DETAIL_HEADERS.dsr, row] })
  state.master = { revision: 5, items: [{ tid: "001", location: "Lokasi", branch: "BG", machine_type: "ATM", denom: "100000", cluster: "RPL", cluster_flm: "", sub_cluster_rpl: "" }] }
  state.writes = 0
  const query = "?uker_id=10&period=2026-08&file_name=rpl.xlsx&mode="
  const response = await api.POST(postBytes(`${query}preview`, bytes)), data = (await response.json()).data
  assert.equal(response.status, 200); assert.equal(data.planning[0].denom, "100000"); assert.equal(data.missing_denom, 0)
  const commit = `${query}commit&preview_hash=${data.file_hash}`
  assert.equal((await api.POST(postBytes(commit, bytes))).status, 409)
  assert.equal((await api.POST(postBytes(`${commit}&parameter_revision=4`, bytes))).status, 409)
  assert.equal(state.writes, 0)
  assert.equal((await api.POST(postBytes(`${commit}&parameter_revision=5`, bytes))).status, 201)
  assert.equal(state.writes, 1); assert.equal(state.lastWrite.data.parameter_revision, 5)
  assert.equal(state.lastWrite.options.ukerId, 10)
})
