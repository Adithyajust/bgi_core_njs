// PATCH Missing Denom Detail V1
// Tambahkan pada buildReport() setelah:
// summary.missing_denom = visible.filter(r => !r.denom).length

const missingDenomItems = visible
  .filter(r => !r.denom)
  .map(r => ({
    tid: r.tid,
    location: r.location,
    machine_type: r.machine_type,
    cluster: r.cluster,
    branch: r.branch
  }))

summary.missing_denom = missingDenomItems.length
summary.missing_denom_items = missingDenomItems
