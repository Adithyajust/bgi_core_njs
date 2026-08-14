import { NextResponse } from "next/server"

import { authorizeApiRequest, getUserDataScope } from "@/lib/access-control"
import { connectDB, sql } from "@/lib/mssql"
import { resolveReplenishUker } from "@/modules/replenish/database"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SOURCES = new Set(["uker", "machine", "employee", "vehicle"])
const EMPLOYEE_TEAM_ROLE_TO_JOB_TITLE = new Map([
  ["CUSTODY", "CUSTODY"],
  ["DRIVER", "DRIVER"],
  ["PENGEMUDI", "DRIVER"],
])

function responseError(message, status = 400) {
  return NextResponse.json({ success: false, message }, { status })
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeId(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function escapeLike(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")
}

export async function GET(request) {
  const authorization = await authorizeApiRequest(request, "/transactions", "view")
  if (!authorization.authorized) return authorization.response

  try {
    const url = new URL(request.url)
    const source = normalizeText(url.searchParams.get("source")).toLowerCase()
    const search = normalizeText(url.searchParams.get("search")).slice(0, 100)
    const requestedLimit = Number(url.searchParams.get("limit"))
    const limit = Number.isSafeInteger(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit, 30))
      : 20

    if (!SOURCES.has(source)) {
      return responseError("Sumber referensi replenish tidak valid.")
    }

    const db = await connectDB()
    const scope = getUserDataScope(authorization.user)

    if (source === "uker") {
      if (!scope.isSuperAdmin) {
        const resolved = await resolveReplenishUker(db, scope, null)
        if (resolved.error) return responseError(resolved.error, 403)

        return NextResponse.json({
          success: true,
          data: {
            options: [
              {
                value: String(resolved.uker.id),
                label: `${resolved.uker.codeuker} · ${resolved.uker.nama_uker}`,
                data: resolved.uker,
              },
            ],
          },
        })
      }

      const result = await db
        .request()
        .input("limit", sql.Int, limit)
        .input("search", sql.NVarChar(210), search ? `${escapeLike(search)}%` : "%")
        .query(`
          SELECT TOP (@limit) id, codeuker, nama_uker
          FROM dbo.master_uker
          WHERE @search = '%'
             OR codeuker LIKE @search ESCAPE '\\'
             OR nama_uker LIKE @search ESCAPE '\\'
          ORDER BY nama_uker, id;
        `)

      return NextResponse.json({
        success: true,
        data: {
          options: result.recordset.map((row) => ({
            value: String(row.id),
            label: `${row.codeuker} · ${row.nama_uker}`,
            data: row,
          })),
        },
      })
    }

    const requestedUkerId = normalizeId(url.searchParams.get("uker_id"))
    const resolved = await resolveReplenishUker(db, scope, requestedUkerId)
    if (resolved.error) return responseError(resolved.error, 403)

    const pattern = search ? `${escapeLike(search)}%` : "%"

    if (source === "machine") {
      const result = await db
        .request()
        .input("limit", sql.Int, limit)
        .input("ukerId", sql.BigInt, resolved.uker.id)
        .input("search", sql.NVarChar(210), pattern)
        .query(`
          SELECT TOP (@limit)
            m.id,
            m.tid,
            m.sn,
            m.lokasi,
            m.kategori_mesin,
            m.denom
          FROM dbo.master_mesin m
          INNER JOIN dbo.master_project p ON p.id = m.project_id
          WHERE p.uker_id = @ukerId
            AND m.is_active = 1
            AND (
              @search = '%'
              OR m.tid LIKE @search ESCAPE '\\'
              OR m.sn LIKE @search ESCAPE '\\'
              OR m.lokasi LIKE @search ESCAPE '\\'
              OR m.denom LIKE @search ESCAPE '\\'
            )
          ORDER BY m.lokasi, m.id;
        `)

      return NextResponse.json({
        success: true,
        data: {
          options: result.recordset.map((row) => ({
            value: String(row.id),
            label: `${row.tid || row.sn} · ${row.lokasi}${row.denom ? ` · Denom ${row.denom}` : ""}`,
            data: row,
          })),
        },
      })
    }

    if (source === "employee") {
      const teamRole = normalizeText(url.searchParams.get("team_role")).toUpperCase()
      const requiredJobTitle = EMPLOYEE_TEAM_ROLE_TO_JOB_TITLE.get(teamRole)

      if (!requiredJobTitle) {
        return responseError("Peran tim pegawai harus CUSTODY atau DRIVER.")
      }

      const result = await db
        .request()
        .input("limit", sql.Int, limit)
        .input("ukerId", sql.BigInt, resolved.uker.id)
        .input("requiredJobTitle", sql.VarChar(100), requiredJobTitle)
        .input("search", sql.NVarChar(210), pattern)
        .query(`
          SELECT TOP (@limit) id, nip, nama, jabatan
          FROM dbo.pegawai
          WHERE uker_id = @ukerId
            AND status = 1
            AND UPPER(LTRIM(RTRIM(ISNULL(jabatan, '')))) = @requiredJobTitle
            AND (
              @search = '%'
              OR nip LIKE @search ESCAPE '\\'
              OR nama LIKE @search ESCAPE '\\'
            )
          ORDER BY nama, id;
        `)

      return NextResponse.json({
        success: true,
        data: {
          team_role: teamRole,
          required_job_title: requiredJobTitle,
          options: result.recordset.map((row) => ({
            value: String(row.id),
            label: `${row.nip} · ${row.nama}${row.jabatan ? ` · ${row.jabatan}` : ""}`,
            data: row,
          })),
        },
      })
    }

    const result = await db
      .request()
      .input("limit", sql.Int, limit)
      .input("ukerId", sql.BigInt, resolved.uker.id)
      .input("search", sql.NVarChar(210), pattern)
      .query(`
        SELECT TOP (@limit)
          id,
          jenis_kendaraan,
          merk_kendaraan,
          nomor_kendaraan
        FROM dbo.master_kendaraan
        WHERE uker_id = @ukerId
          AND status = 'AKTIF'
          AND UPPER(LTRIM(RTRIM(jenis_kendaraan))) = 'MOBIL'
          AND (
            @search = '%'
            OR nomor_kendaraan LIKE @search ESCAPE '\\'
            OR merk_kendaraan LIKE @search ESCAPE '\\'
          )
        ORDER BY nomor_kendaraan, id;
      `)

    return NextResponse.json({
      success: true,
      data: {
        options: result.recordset.map((row) => ({
          value: String(row.id),
          label: `${row.nomor_kendaraan} · ${row.merk_kendaraan} · ${row.jenis_kendaraan}`,
          data: row,
        })),
      },
    })
  } catch (error) {
    console.error("GET replenish options error:", error)
    const detail = process.env.NODE_ENV === "production" ? "" : ` Detail: ${error.message}`
    return responseError(`Gagal memuat referensi replenish.${detail}`, 500)
  }
}
