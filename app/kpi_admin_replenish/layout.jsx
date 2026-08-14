import { AccessGuard } from "@/components/access-guard"
import { REPLENISH_KPI_MENU_HREF } from "@/modules/replenish/constants"

export default function ReplenishAdminKpiLayout({ children }) {
  return <AccessGuard menuHref={REPLENISH_KPI_MENU_HREF}>{children}</AccessGuard>
}
