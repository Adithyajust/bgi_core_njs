import { redirect } from "next/navigation"

import { requireMenuAccess } from "@/lib/access-control"

const MENU_HREF = "/rpl_terjadwal"

export default async function RplTerjadwalLayout({ children }) {
  await requireMenuAccess(MENU_HREF)

  return children
}
