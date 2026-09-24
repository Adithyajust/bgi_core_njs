import { redirect } from "next/navigation"

import { getCurrentUser, isSuperAdmin, requireMenuAccess } from "@/lib/access-control"

const MENU_HREF = "/rpl_terjadwal"

export default async function RplTerjadwalLayout({ children }) {
  await requireMenuAccess(MENU_HREF)

  const user = await getCurrentUser()
  if (!isSuperAdmin(user)) {
    redirect("/forbidden")
  }

  return children
}
