import { readFile } from "node:fs/promises"
import { getUserDataScope } from "@/lib/access-control"
import path from "node:path"
import { authorize, errorResponse, json, readBytes } from "@/modules/rpl-terjadwal/http"
import { UploadError } from "@/modules/rpl-terjadwal/workbook"
import { parseParameterWorkbook, validateParameter, validateRevision } from "@/modules/rpl-terjadwal/parameters"
import { getParameterMaster, saveParameterMaster, applyMasterToBatch } from "@/modules/rpl-terjadwal/parameter-database"
import { resolveReportingUker } from "@/modules/rpl-terjadwal/database"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function unitId(value, user) {
  const unit = await resolveReportingUker(value, getUserDataScope(user))
  if (!unit) throw new UploadError("Pilih unit pelaporan yang valid dari Master Uker.")
  return Number(unit.id)
}

export async function GET(request) {
  try {
    const auth = await authorize(request, "view")
    if (!auth.authorized) return auth.response
    const params = new URL(request.url).searchParams
    if (params.get("template") === "1") {
      const bytes = await readFile(path.join(process.cwd(), "modules/rpl-terjadwal/templates/RPL-Template-Parameter.xlsx"))
      return new Response(bytes, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="RPL-Template-Parameter.xlsx"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } })
    }
    const ukerId = await unitId(params.get("uker_id"), auth.user)
    const page = Number(params.get("page") || 0)
    if (!Number.isInteger(page) || page < 0 || page > 400) throw new UploadError("Halaman parameter tidak valid.", 400)
    const data = await getParameterMaster(ukerId)
    const search = (params.get("search") || "").trim().toLowerCase().slice(0, 250)
    const items = data.items.filter(p => !search || [p.tid, p.location, p.branch, p.cluster, p.cluster_flm, p.sub_cluster_rpl].some(v => v.toLowerCase().includes(search)))
    return json({ success: true, data: { revision: data.revision, items: items.slice(page * 50, (page + 1) * 50), total: items.length, master_total: data.items.length, page } })
  } catch (error) { return errorResponse(error) }
}

export async function POST(request) {
  try {
    // An import can overwrite existing parameters, so update permission is required.
    const auth = await authorize(request, "update")
    if (!auth.authorized) return auth.response
    const params = new URL(request.url).searchParams
    const mode = params.get("mode")
    if (!["preview", "commit"].includes(mode)) throw new UploadError("Mode upload parameter tidak valid.")
    const ukerId = await unitId(params.get("uker_id"), auth.user)
    const fileName = (params.get("file_name") || "").split(/[\\/]/).pop()
    if (!fileName || fileName.length > 255 || !/\.xlsx$/i.test(fileName)) throw new UploadError("Pilih file parameter .xlsx.")
    const data = parseParameterWorkbook(await readBytes(request))
    const master = await getParameterMaster(ukerId)
    const tids = new Set(master.items.map(p => p.tid.toUpperCase()))
    const inserted = data.rows.filter(p => !tids.has(p.tid)).length
    const preview = { ...data, rows: data.rows.slice(0, 50), total: data.rows.length, inserted, updated: data.rows.length - inserted, revision: master.revision }
    if (data.error_count) return json({ success: false, message: "Perbaiki seluruh parameter tidak valid sebelum menyimpan.", data: preview }, 422)
    if (mode === "preview") return json({ success: true, data: preview })
    if (params.get("preview_hash") !== data.file_hash) throw new UploadError("File parameter berubah. Lakukan preview kembali.", 409)
    if (!params.has("revision")) throw new UploadError("Lakukan preview parameter sebelum menyimpan.", 409)
    const result = await saveParameterMaster(data.rows, { ukerId, revision: validateRevision(Number(params.get("revision"))), fileName, fileHash: data.file_hash, user: auth.user, request })
    return json({ success: true, data: result })
  } catch (error) { return errorResponse(error) }
}

export async function PATCH(request) {
  try {
    const auth = await authorize(request, "update")
    if (!auth.authorized) return auth.response
    let input
    const bytes = await readBytes(request, 64 * 1024)
    try { input = JSON.parse(bytes.toString("utf8")) } catch { throw new UploadError("Data perubahan bukan JSON yang valid.") }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new UploadError("Data perubahan parameter tidak valid.")
    const ukerId = await unitId(input.uker_id, auth.user)
    const revision = validateRevision(input.revision)
    let data
    if (input.type === "apply") {
      if (!Number.isInteger(input.batch) || input.batch < 1 || input.batch > 2147483647) throw new UploadError("Versi laporan tidak valid.")
      data = await applyMasterToBatch({ batch: input.batch, revision, ukerId, parameterRevision: validateRevision(input.parameter_revision) }, { user: auth.user, request })
    } else if (input.type === "edit") {
      data = await saveParameterMaster([validateParameter(input.parameter)], { ukerId, revision, user: auth.user, request, editOnly: true })
    } else throw new UploadError("Jenis perubahan parameter tidak valid.")
    return json({ success: true, data })
  } catch (error) { return errorResponse(error) }
}
