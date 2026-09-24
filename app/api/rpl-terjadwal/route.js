import { readFile } from "node:fs/promises"
import path from "node:path"
import { parseWorkbook, UploadError } from "@/modules/rpl-terjadwal/workbook"
import { saveUpload, listUploads, getUploadRows, getReportData, saveReportEdit, listReportingUkerOptions, resolveReportingUker } from "@/modules/rpl-terjadwal/database"
import { buildReport, STATUSES, validateEdit } from "@/modules/rpl-terjadwal/calculations"

import { authorize, errorResponse, json, readBytes } from "@/modules/rpl-terjadwal/http"
import { getParameterMaster } from "@/modules/rpl-terjadwal/parameter-database"
import { applyParameterSnapshot, validateRevision } from "@/modules/rpl-terjadwal/parameters"
import { getDSRFromCRO } from "@/modules/rpl-terjadwal/cro-query"
import { mapCROToDSR } from "@/modules/rpl-terjadwal/cro-mapper"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function POST(request) {
  try {
    const auth = await authorize(request, "create")
    if (!auth.authorized) return auth.response
    const params = new URL(request.url).searchParams
    const mode = params.get("mode")
    if (!["preview", "commit"].includes(mode)) throw new UploadError("Mode upload tidak valid.")
    const selectedUker = await resolveReportingUker(params.get("uker_id"))
    const unit = (selectedUker?.nama_uker || "").trim()
    const fileName = (params.get("file_name") || "").split(/[\\/]/).pop()
    if (!unit || unit.length > 150) throw new UploadError("Pilih unit pelaporan yang valid dari Master Uker.")
    if (!fileName || fileName.length > 255 || !/\.xlsx$/i.test(fileName)) throw new UploadError("Pilih file .xlsx, bukan .xls atau .xlsm.")
    const parsed = parseWorkbook(await readBytes(request), params.get("period"))
    const master = await getParameterMaster(Number(selectedUker.id))
    const data = applyParameterSnapshot(parsed, master)
    // const croDSR = await getDSRFromCRO({
    //   startDate: `${data.period}-01`,
    //   endDate: `${data.period}-31`,
    //   branch: unit
    // })

    // data.dsr = mapCROToDSR(croDSR)
    console.log("CRO FILTER:", {
        startDate: `${data.period}-01`,
        endDate: `${data.period}-31`,
        branch: unit
    });

   const [year, month] = data.period.split("-")

    const lastDay = new Date(
        Number(year),
        Number(month),
        0
    ).getDate()

    const croDSR = await getDSRFromCRO({
        startDate: `${data.period}-01`,
        endDate: `${data.period}-${String(lastDay).padStart(2,"0")}`,
        branch: unit
    })

    console.log("CRO RAW RESULT:", croDSR.length)
    console.log("CRO SAMPLE:", croDSR.slice(0,3))


    data.dsr = mapCROToDSR(croDSR)


    console.log("DSR MAPPED RESULT:", data.dsr.length)
    console.log("DSR SAMPLE:", data.dsr.slice(0,3))

    const preview = { period: data.period, period_label: data.period_label, file_hash: data.file_hash, parameter_revision: master.revision, summary: data.summary, warnings: data.warnings, errors: data.errors, error_count: data.error_count, planning: data.planning.slice(0, 50), dsr: data.dsr.slice(0, 50), parameter_count: data.parameters.length, missing_denom: data.parameters.filter(r => !r.denom).length }
    if (data.error_count) return json({ success: false, message: "Perbaiki seluruh baris tidak valid sebelum menyimpan. Belum ada data yang disimpan.", data: preview }, 422)
    if (mode === "preview") return json({ success: true, data: preview })
    if (params.get("preview_hash") !== data.file_hash) throw new UploadError("File berubah. Lakukan preview kembali.", 409)
    if (!params.has("parameter_revision") || validateRevision(Number(params.get("parameter_revision"))) !== master.revision) throw new UploadError("Parameter berubah. Lakukan preview kembali.", 409)
    const id = await saveUpload(data, { fileName, unit, ukerId: Number(selectedUker.id), user: auth.user, request })
    return json({ success: true, message: "Perencanaan berhasil disimpan dan DSR diambil dari CRO sebagai satu versi upload.", data: { id, ...data.summary } }, 201)
  } catch (error) { return errorResponse(error) }
}

export async function GET(request) {
  try {
    const auth = await authorize(request, "view")
    if (!auth.authorized) return auth.response
    const params = new URL(request.url).searchParams
    if (params.get("uker_options") === "1") return json({ success: true, data: { options: await listReportingUkerOptions(params.get("search")) } })
    if (params.get("template") === "1") {
      const bytes = await readFile(path.join(process.cwd(), "modules/rpl-terjadwal/templates/RPL-Template-Upload.xlsx"))
      return new Response(bytes, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="RPL-Template-Upload.xlsx"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } })
    }
    const integer = (name, fallback, min) => {
      const n = params.has(name) ? Number(params.get(name)) : fallback
      if (!Number.isInteger(n) || n < min || n > 2147483647) throw new UploadError(`Parameter ${name} tidak valid.`, 400)
      return n
    }
    if (!params.has("batch")) return json({ success: true, data: await listUploads(integer("after", 2147483647, 1)) })
    if (params.has("view")) {
      const view = params.get("view"), machine = params.get("machine") || "", status = params.get("status") || ""
      if (!["guide", "planning", "dsr", "daily", "kpi", "management", "schedule", "edit"].includes(view) || !["", "ATM", "CRM"].includes(machine) || (status && !STATUSES.includes(status))) throw new UploadError("Filter laporan tidak valid.", 400)
      const page = integer("page", 0, 0)
      if (page > 800) throw new UploadError("Halaman melebihi batas data.", 400)
      const data = await getReportData(integer("batch", 0, 1))
      return json({ success: true, data: buildReport(data, { view, page, machine, status, search: (params.get("search") || "").trim().slice(0, 250), cluster: (params.get("cluster") || "").trim().slice(0, 100) }) })
    }
    const kind = params.get("kind")
    if (!["planning", "dsr"].includes(kind)) throw new UploadError("Jenis sheet tidak valid.", 400)
    return json({ success: true, data: await getUploadRows({ batch: integer("batch", 0, 1), kind, after: integer("after", 0, 0), search: (params.get("search") || "").trim().slice(0, 250) }) })
  } catch (error) { return errorResponse(error) }
}

export async function PATCH(request) {
  try {
    const auth = await authorize(request, "update")
    if (!auth.authorized) return auth.response
    let edit
    try { edit = validateEdit(JSON.parse((await readBytes(request, 64 * 1024)).toString("utf8"))) }
    catch (error) { if (error instanceof UploadError) throw error; throw new UploadError(error.message, 422) }
    const data = await saveReportEdit(edit, { user: auth.user, request })
    return json({ success: true, data })
  } catch (error) { return errorResponse(error) }
}
