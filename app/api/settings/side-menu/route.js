import { readJsonBody } from "@/lib/http/json-body"
import { NextResponse } from "next/server"
import { authorizeApiRequest } from "@/lib/access-control"
import { connectDB, sql } from "@/lib/mssql"
import { writeAuditLog } from "@/lib/security/audit-log"
import { normalizeRowVersionToken } from "@/modules/master-mesin/row-version"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function createErrorResponse(message, status = 400) {
  return NextResponse.json(
    {
      success: false,
      message
    },
    {
      status
    }
  )
}


async function authorizeSettings(request, action = "view") {
  const authorization = await authorizeApiRequest(request, "/settings", action)

  if (!authorization.authorized) {
    return authorization
  }

  if (authorization.user.role_code !== "SUPER_ADMIN") {
    return {
      authorized: false,
      response: createErrorResponse(
        "Hanya Super Admin yang dapat mengelola side menu.",
        403
      ),
    }
  }

  return authorization
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeBoolean(value, defaultValue = true) {
  if (value === undefined || value === null) {
    return defaultValue
  }

  return (
    value === true ||
    value === 1 ||
    value === "1" ||
    value === "true"
  )
}

function validateMenuPayload(body, requireId = false) {
  const id = Number(body.id)
  const label = normalizeText(body.label)
  const href = normalizeText(body.href)
  const icon = normalizeText(body.icon)
  const badge = normalizeText(body.badge)
  const sortOrder = Number(body.sort_order)
  const isActive = normalizeBoolean(body.is_active)

  if (requireId && (!Number.isInteger(id) || id <= 0)) {
    return {
      error: "ID menu tidak valid."
    }
  }

  if (!label) {
    return {
      error: "Nama menu wajib diisi."
    }
  }

  if (label.length > 100) {
    return {
      error: "Nama menu maksimal 100 karakter."
    }
  }

  if (!href) {
    return {
      error: "URL menu wajib diisi."
    }
  }

  if (!href.startsWith("/")) {
    return {
      error: "URL menu harus diawali dengan karakter /."
    }
  }

  if (href.length > 200) {
    return {
      error: "URL menu maksimal 200 karakter."
    }
  }

  if (!icon) {
    return {
      error: "Ikon menu wajib dipilih."
    }
  }

  if (icon.length > 100) {
    return {
      error: "Nama ikon maksimal 100 karakter."
    }
  }

  if (badge.length > 20) {
    return {
      error: "Badge maksimal 20 karakter."
    }
  }

  if (!Number.isInteger(sortOrder) || sortOrder <= 0) {
    return {
      error: "Urutan menu harus berupa angka lebih dari 0."
    }
  }

  return {
    data: {
      id,
      label,
      href,
      icon,
      badge: badge || null,
      sortOrder,
      isActive
    }
  }
}

export async function GET(request) {
  const authorization = await authorizeSettings(request, "view")

  if (!authorization.authorized) {
    return authorization.response
  }
  try {
    const db = await connectDB()

    const result = await db.request().query(`
      SELECT
        id,
        label,
        href,
        icon,
        badge,
        sort_order,
        is_active,
        row_version,
        created_at
      FROM dbo.sidebar_routes
      ORDER BY sort_order ASC, id ASC
    `)

    return NextResponse.json({
      success: true,
      data: result.recordset.map((item) => ({
        ...item,
        row_version: normalizeRowVersionToken(item.row_version),
      }))
    })
  } catch (error) {
    console.error("GET side menu error:", error)

    return createErrorResponse(
      "Gagal mengambil data side menu.",
      500
    )
  }
}

export async function POST(request) {
  const authorization = await authorizeSettings(request, "create")

  if (!authorization.authorized) {
    return authorization.response
  }
  try {
    const body = await readJsonBody(request, { maxBytes: 2 * 1024 * 1024 })
    const validation = validateMenuPayload(body)

    if (validation.error) {
      return createErrorResponse(validation.error)
    }

    const menu = validation.data
    const db = await connectDB()

    const duplicateResult = await db
      .request()
      .input("href", sql.VarChar(200), menu.href)
      .query(`
        SELECT TOP 1 id
        FROM dbo.sidebar_routes
        WHERE href = @href
      `)

    if (duplicateResult.recordset.length > 0) {
      return createErrorResponse(
        "URL menu sudah digunakan.",
        409
      )
    }

    const result = await db
      .request()
      .input("label", sql.VarChar(100), menu.label)
      .input("href", sql.VarChar(200), menu.href)
      .input("icon", sql.VarChar(100), menu.icon)
      .input("badge", sql.VarChar(20), menu.badge)
      .input("sortOrder", sql.Int, menu.sortOrder)
      .input("isActive", sql.Bit, menu.isActive)
      .query(`
        INSERT INTO dbo.sidebar_routes
        (
          label,
          href,
          icon,
          badge,
          sort_order,
          is_active,
          created_at
        )
        OUTPUT
          inserted.id,
          inserted.label,
          inserted.href,
          inserted.icon,
          inserted.badge,
          inserted.sort_order,
          inserted.is_active,
          inserted.row_version,
          inserted.created_at
        VALUES
        (
          @label,
          @href,
          @icon,
          @badge,
          @sortOrder,
          @isActive,
          GETDATE()
        )
      `)

    const createdRecord = result.recordset[0]
    const createdMenu = {
      ...createdRecord,
      row_version: normalizeRowVersionToken(createdRecord?.row_version),
    }

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "CREATE",
      module: "settings.side_menu",
      entityType: "sidebar_route",
      entityId: createdMenu.id,
      metadata: { after: createdMenu },
    })

    return NextResponse.json(
      {
        success: true,
        message: "Menu berhasil ditambahkan.",
        data: createdMenu
      },
      {
        status: 201
      }
    )
  } catch (error) {
    console.error("POST side menu error:", error)

    if (error instanceof SyntaxError) {
      return createErrorResponse(
        "Format data tidak valid."
      )
    }

    return createErrorResponse(
      "Gagal menambahkan menu.",
      500
    )
  }
}

export async function PUT(request) {
  const authorization = await authorizeSettings(request, "update")

  if (!authorization.authorized) {
    return authorization.response
  }
  try {
    const body = await readJsonBody(request, { maxBytes: 2 * 1024 * 1024 })
    const validation = validateMenuPayload(body, true)

    if (validation.error) {
      return createErrorResponse(validation.error)
    }

    const menu = validation.data
    const requestedRowVersion = normalizeRowVersionToken(body.row_version)

    if (!requestedRowVersion) {
      return createErrorResponse(
        "Versi data menu tidak tersedia. Muat ulang sebelum menyimpan.",
        409
      )
    }

    const db = await connectDB()

    const existingResult = await db
      .request()
      .input("id", sql.Int, menu.id)
      .query(`
        SELECT TOP 1
          id,
          label,
          href,
          icon,
          badge,
          sort_order,
          is_active,
          row_version,
          created_at
        FROM dbo.sidebar_routes
        WHERE id = @id
      `)

    if (existingResult.recordset.length === 0) {
      return createErrorResponse(
        "Menu tidak ditemukan.",
        404
      )
    }

    const existingMenu = {
      ...existingResult.recordset[0],
      row_version: normalizeRowVersionToken(existingResult.recordset[0].row_version),
    }

    if (requestedRowVersion !== existingMenu.row_version) {
      return createErrorResponse(
        "Data menu telah berubah oleh pengguna lain. Muat ulang sebelum menyimpan.",
        409
      )
    }

    const duplicateResult = await db
      .request()
      .input("id", sql.Int, menu.id)
      .input("href", sql.VarChar(200), menu.href)
      .query(`
        SELECT TOP 1 id
        FROM dbo.sidebar_routes
        WHERE href = @href
          AND id <> @id
      `)

    if (duplicateResult.recordset.length > 0) {
      return createErrorResponse(
        "URL menu sudah digunakan oleh menu lain.",
        409
      )
    }

    const result = await db
      .request()
      .input("id", sql.Int, menu.id)
      .input(
        "rowVersion",
        sql.VarBinary(8),
        Buffer.from(requestedRowVersion.slice(2), "hex")
      )
      .input("label", sql.VarChar(100), menu.label)
      .input("href", sql.VarChar(200), menu.href)
      .input("icon", sql.VarChar(100), menu.icon)
      .input("badge", sql.VarChar(20), menu.badge)
      .input("sortOrder", sql.Int, menu.sortOrder)
      .input("isActive", sql.Bit, menu.isActive)
      .query(`
        UPDATE dbo.sidebar_routes
        SET
          label = @label,
          href = @href,
          icon = @icon,
          badge = @badge,
          sort_order = @sortOrder,
          is_active = @isActive
        OUTPUT
          inserted.id,
          inserted.label,
          inserted.href,
          inserted.icon,
          inserted.badge,
          inserted.sort_order,
          inserted.is_active,
          inserted.row_version,
          inserted.created_at
        WHERE id = @id
          AND row_version = @rowVersion
      `)

    if (result.recordset.length === 0) {
      return createErrorResponse(
        "Data menu telah berubah oleh pengguna lain. Muat ulang sebelum menyimpan.",
        409
      )
    }

    const updatedRecord = result.recordset[0]
    const updatedMenu = {
      ...updatedRecord,
      row_version: normalizeRowVersionToken(updatedRecord.row_version),
    }

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "UPDATE",
      module: "settings.side_menu",
      entityType: "sidebar_route",
      entityId: menu.id,
      metadata: {
        before: existingMenu,
        after: updatedMenu,
      },
    })

    return NextResponse.json({
      success: true,
      message: "Menu berhasil diperbarui.",
      data: updatedMenu
    })
  } catch (error) {
    console.error("PUT side menu error:", error)

    if (error instanceof SyntaxError) {
      return createErrorResponse(
        "Format data tidak valid."
      )
    }

    return createErrorResponse(
      "Gagal memperbarui menu.",
      500
    )
  }
}

export async function DELETE(request) {
  const authorization = await authorizeSettings(request, "delete")

  if (!authorization.authorized) {
    return authorization.response
  }
  try {
    const requestUrl = new URL(request.url)
    const id = Number(requestUrl.searchParams.get("id"))

    if (!Number.isInteger(id) || id <= 0) {
      return createErrorResponse(
        "ID menu tidak valid."
      )
    }

    const db = await connectDB()

    const result = await db
      .request()
      .input("id", sql.Int, id)
      .query(`
        DELETE FROM dbo.sidebar_routes
        OUTPUT
          deleted.id,
          deleted.label,
          deleted.href
        WHERE id = @id
      `)

    if (result.recordset.length === 0) {
      return createErrorResponse(
        "Menu tidak ditemukan.",
        404
      )
    }

    const deletedMenu = result.recordset[0]

    await writeAuditLog({
      request,
      userId: authorization.user.id,
      action: "DELETE",
      module: "settings.side_menu",
      entityType: "sidebar_route",
      entityId: id,
      metadata: { before: deletedMenu },
    })

    return NextResponse.json({
      success: true,
      message: "Menu berhasil dihapus.",
      data: deletedMenu
    })
  } catch (error) {
    console.error("DELETE side menu error:", error)

    return createErrorResponse(
      "Gagal menghapus menu.",
      500
    )
  }
}