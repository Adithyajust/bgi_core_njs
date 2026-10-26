import { authorize, errorResponse, json } from "@/modules/rpl-terjadwal/http"
import { getUserDataScope } from "@/lib/access-control"
import { resolveReportingUker } from "@/modules/rpl-terjadwal/database"
import { runIncrementalDSR } from "@/modules/rpl-terjadwal/incremental-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request) {
  try {
    const auth = await authorize(request, "create")
    if (!auth.authorized) return auth.response

    const body = await request.json()
    const selectedUker = await resolveReportingUker(body.ukerId, getUserDataScope(auth.user))

    if (!selectedUker) throw new Error("Unit pelaporan tidak ditemukan.")

    const result = await runIncrementalDSR({
      period: body.period,
      branch: selectedUker.nama_uker.trim(),
      ukerId: Number(selectedUker.id),
      userId: auth.user.id,
      today: new Date().toISOString().substring(0,10)
    })

    return json({success:true,data:result})
  } catch(error) {
    console.error("[RPL DSR SYNC ERROR]", error)
    return errorResponse(error)
  }
}
