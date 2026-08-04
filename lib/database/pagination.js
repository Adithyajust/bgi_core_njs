export function normalizePositiveInteger(value, fallback, maximum = null) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return fallback
  }
  return maximum === null ? parsed : Math.min(parsed, maximum)
}

export function normalizeCursor(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function buildCursorPagination(rows, limit, idField = "id") {
  const safeRows = Array.isArray(rows) ? rows : []
  const hasMore = safeRows.length > limit
  const items = safeRows.slice(0, limit)
  const last = items.at(-1)

  return {
    items,
    pagination: {
      limit,
      has_more: hasMore,
      next_cursor: hasMore && last ? String(last[idField]) : null,
    },
  }
}
