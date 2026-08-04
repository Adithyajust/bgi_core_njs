import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { connectDB, sql } from "@/lib/mssql"
import {
  getPegawaiPhotoMimeType,
  isSafePegawaiPhotoFileName,
  PEGAWAI_PHOTO_PRIVATE_PREFIX,
  readManagedPegawaiPhoto,
} from "@/lib/pegawai-photo"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request, context) {
  const authorization = await authorizeApiRequest(request, "/masters", "view")

  if (!authorization.authorized) {
    return authorization.response
  }

  const { fileName } = await context.params
  if (!isSafePegawaiPhotoFileName(fileName)) {
    return Response.json(
      { success: false, message: "Nama file foto tidak valid." },
      { status: 400 }
    )
  }

  const scope = getUserDataScope(authorization.user)
  if (!scope.isSuperAdmin && !scope.codeUker) {
    return Response.json(
      { success: false, message: "Scope unit kerja tidak tersedia." },
      { status: 403 }
    )
  }

  const photoPath = `${PEGAWAI_PHOTO_PRIVATE_PREFIX}${fileName}`
  const db = await connectDB()
  const result = await db
    .request()
    .input("photoPath", sql.VarChar(255), photoPath)
    .input("codeUker", sql.NVarChar(20), scope.codeUker)
    .query(`
      SELECT TOP 1 p.id
      FROM dbo.pegawai p
      INNER JOIN dbo.master_uker mu ON mu.id = p.uker_id
      WHERE p.foto = @photoPath
        AND (@codeUker IS NULL OR mu.codeuker = @codeUker);
    `)

  if (result.recordset.length === 0) {
    return Response.json(
      { success: false, message: "Foto tidak ditemukan." },
      { status: 404 }
    )
  }

  try {
    const buffer = await readManagedPegawaiPhoto(fileName)
    const contentType = getPegawaiPhotoMimeType(fileName)

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType || "application/octet-stream",
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, max-age=300, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    if (error?.code === "ENOENT") {
      return Response.json(
        { success: false, message: "Berkas foto tidak ditemukan." },
        { status: 404 }
      )
    }

    console.error("GET private pegawai photo error:", error)
    return Response.json(
      { success: false, message: "Gagal membaca foto pegawai." },
      { status: 500 }
    )
  }
}
