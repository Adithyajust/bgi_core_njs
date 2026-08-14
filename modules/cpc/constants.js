export const CPC_MENU_HREF = "/transaksi_cpc"

export const CPC_KPI_MENU_HREF = "/kpi_cpc"

export const CPC_SPARE_CASSETTE_MENU_HREF = "/spare_kaset"

export const CPC_PACKING_SHEETS_PER_CASSETTE = 2000

export const CPC_SPARE_CASSETTE_DENOMINATIONS = Object.freeze([50000, 100000])

export const CPC_SPARE_CASSETTE_STATUSES = Object.freeze([
  "KOSONG",
  "READY",
  "ALLOCATED",
])

export const CPC_QUEUE_STATUSES = Object.freeze([
  "DISETUJUI",
  "MENUNGGU_VALIDASI_KASET",
  "KASET_DALAM_PERSIAPAN",
  "MENUNGGU_APPROVAL_CPC",
  "KASET_SIAP",
  "SIAP_BERANGKAT",
])



export const CPC_PACKING_ASSIGNMENT_STATUSES = Object.freeze([
  "UNASSIGNED",
  "ASSIGNED",
  "IN_PROGRESS",
  "PACKING_COMPLETE",
])

export const CPC_PACKING_ASSIGNMENT_ACTIONS = Object.freeze({
  CLAIM: "CLAIM",
  RELEASE: "RELEASE",
  ASSIGN: "ASSIGN",
})

export const CPC_ACTIONS = Object.freeze({
  RECEIVE_REQUEST: "CPC_RECEIVE_REQUEST",
  START_PREPARATION: "CPC_START_PREPARATION",
  SUBMIT_APPROVAL: "CPC_SUBMIT_APPROVAL",
  APPROVE_PACKING: "CPC_APPROVE_PACKING",
  REJECT_PACKING: "CPC_REJECT_PACKING",
  COMPLETE_HANDOVER: "CPC_COMPLETE_CASSETTE_HANDOVER",
})

export const CPC_STATUS_LABELS = Object.freeze({
  DISETUJUI: "Permintaan Baru",
  MENUNGGU_VALIDASI_KASET: "Menunggu Validasi",
  KASET_DALAM_PERSIAPAN: "Packing Kaset",
  MENUNGGU_APPROVAL_CPC: "Menunggu Approval CPC",
  KASET_SIAP: "Kaset Siap",
  SIAP_BERANGKAT: "Diserahkan ke Custody",
})

export const CPC_ACTION_LABELS = Object.freeze({
  [CPC_ACTIONS.RECEIVE_REQUEST]: "Terima Permintaan",
  [CPC_ACTIONS.START_PREPARATION]: "Mulai Packing",
  [CPC_ACTIONS.SUBMIT_APPROVAL]: "Ajukan ke Asisten Manager CPC",
  [CPC_ACTIONS.APPROVE_PACKING]: "Approve Packing",
  [CPC_ACTIONS.REJECT_PACKING]: "Tolak / Kembalikan",
  [CPC_ACTIONS.COMPLETE_HANDOVER]: "Selesaikan Serah Terima Kaset",
})

export const CPC_ACTION_TRANSITIONS = Object.freeze({
  [CPC_ACTIONS.RECEIVE_REQUEST]: Object.freeze({
    from: "DISETUJUI",
    to: "KASET_DALAM_PERSIAPAN",
  }),
  [CPC_ACTIONS.START_PREPARATION]: Object.freeze({
    from: "MENUNGGU_VALIDASI_KASET",
    to: "KASET_DALAM_PERSIAPAN",
  }),
  [CPC_ACTIONS.SUBMIT_APPROVAL]: Object.freeze({
    from: "KASET_DALAM_PERSIAPAN",
    to: "MENUNGGU_APPROVAL_CPC",
  }),
  [CPC_ACTIONS.APPROVE_PACKING]: Object.freeze({
    from: "MENUNGGU_APPROVAL_CPC",
    to: "KASET_SIAP",
  }),
  [CPC_ACTIONS.REJECT_PACKING]: Object.freeze({
    from: "MENUNGGU_APPROVAL_CPC",
    to: "KASET_DALAM_PERSIAPAN",
  }),
  [CPC_ACTIONS.COMPLETE_HANDOVER]: Object.freeze({
    from: "KASET_SIAP",
    to: "SIAP_BERANGKAT",
  }),
})

export function cpcStatusLabel(status) {
  return CPC_STATUS_LABELS[String(status || "").trim().toUpperCase()] || String(status || "-")
}

export function cpcActionForStatus(status) {
  const normalized = String(status || "").trim().toUpperCase()
  if (normalized === "DISETUJUI") return CPC_ACTIONS.RECEIVE_REQUEST
  if (normalized === "MENUNGGU_VALIDASI_KASET") return CPC_ACTIONS.START_PREPARATION
  if (normalized === "KASET_DALAM_PERSIAPAN") return CPC_ACTIONS.SUBMIT_APPROVAL
  return null
}
