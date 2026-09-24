function normalizeDate(value) {
  if (!value) return null

  if (value instanceof Date) {
    const year = value.getUTCFullYear()
    const month = String(value.getUTCMonth() + 1).padStart(2, "0")
    const day = String(value.getUTCDate()).padStart(2, "0")

    return `${year}-${month}-${day}`
  }

  return String(value).substring(0, 10)
}

export function mapCROToDSR(rows) {
  return rows.map((row, index) => ({
    source_row: index + 1,
    // event_date: row.event_date,
     event_date: normalizeDate(row.event_date),
    tid: row.tid,
    location: row.location,
    machine_type: row.machine_type,
    cluster: null,
    sheets: Number(row.sheets || 0),
    forecast: 0,
    realized: 1,
    status: "Sesuai",
    cause: null,
    obstacle: null,
    note: null,
    denom: row.denom || null
  }))
}
