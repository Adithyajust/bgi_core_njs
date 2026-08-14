import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { connectDB, sql } from "@/lib/mssql"
import { isReplenishFieldSupervisor } from "@/modules/replenish/authorization"
import { REPLENISH_FIELD_MENU_HREF } from "@/modules/replenish/constants"
import { readFieldEvidence } from "@/modules/replenish/field-evidence-storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function normalizeId(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export async function GET(request, context) {
  const authorization = await authorizeApiRequest(request, REPLENISH_FIELD_MENU_HREF, "view")
  if (!authorization.authorized) return authorization.response
  const { evidenceId } = await context.params
  const id = normalizeId(evidenceId)
  if (!id) return Response.json({ success: false, message: "ID bukti tidak valid." }, { status: 400 })

  const scope = getUserDataScope(authorization.user)
  const supervisor = isReplenishFieldSupervisor(authorization.user)
  try {
    const db = await connectDB()
    const result = await db.request()
      .input("evidenceId", sql.BigInt, id)
      .input("employeeId", sql.BigInt, authorization.user.pegawai_id || null)
      .input("scopeCodeUker", sql.NVarChar(4), scope.isSuperAdmin ? null : scope.codeUker)
      .input("supervisor", sql.Bit, supervisor ? 1 : 0)
      .query(`
        SELECT TOP (1)
          evidence.stored_file_name,
          evidence.mime_type,
          evidence.file_size
        FROM dbo.replenish_field_exception_evidence evidence
        INNER JOIN dbo.replenish_field_exceptions exception ON exception.id = evidence.exception_id
        INNER JOIN dbo.replenish_work_orders wo ON wo.id = exception.work_order_id
        INNER JOIN dbo.master_uker unit ON unit.id = wo.uker_id
        WHERE evidence.id = @evidenceId
          AND (@scopeCodeUker IS NULL OR unit.codeuker = @scopeCodeUker)
          AND (
            @supervisor = 1
            OR EXISTS (
              SELECT 1 FROM dbo.replenish_team_members member
              WHERE member.work_order_id = wo.id AND member.employee_id = @employeeId
            )
          );
      `)
    const evidence = result.recordset[0]
    if (!evidence) return Response.json({ success: false, message: "Bukti tidak ditemukan." }, { status: 404 })
    const buffer = await readFieldEvidence(evidence.stored_file_name)
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": evidence.mime_type,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, max-age=60, must-revalidate",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    if (error?.code === "ENOENT") {
      return Response.json({ success: false, message: "File bukti tidak ditemukan." }, { status: 404 })
    }
    console.error("Gagal membaca bukti Replenish Lapangan.", error)
    return Response.json({ success: false, message: "Gagal membaca bukti lapangan." }, { status: 500 })
  }
}
