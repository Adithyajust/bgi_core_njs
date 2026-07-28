import { NextResponse } from "next/server"
import { connectDB, sql } from "@/lib/mssql"

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

export async function GET() {
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
        created_at
      FROM dbo.sidebar_routes
      ORDER BY sort_order ASC, id ASC
    `)

    return NextResponse.json({
      success: true,
      data: result.recordset
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
  try {
    const body = await request.json()
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

    return NextResponse.json(
      {
        success: true,
        message: "Menu berhasil ditambahkan.",
        data: result.recordset[0]
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
  try {
    const body = await request.json()
    const validation = validateMenuPayload(body, true)

    if (validation.error) {
      return createErrorResponse(validation.error)
    }

    const menu = validation.data
    const db = await connectDB()

    const existingResult = await db
      .request()
      .input("id", sql.Int, menu.id)
      .query(`
        SELECT TOP 1 id
        FROM dbo.sidebar_routes
        WHERE id = @id
      `)

    if (existingResult.recordset.length === 0) {
      return createErrorResponse(
        "Menu tidak ditemukan.",
        404
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
          inserted.created_at
        WHERE id = @id
      `)

    return NextResponse.json({
      success: true,
      message: "Menu berhasil diperbarui.",
      data: result.recordset[0]
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

    return NextResponse.json({
      success: true,
      message: "Menu berhasil dihapus.",
      data: result.recordset[0]
    })
  } catch (error) {
    console.error("DELETE side menu error:", error)

    return createErrorResponse(
      "Gagal menghapus menu.",
      500
    )
  }
}