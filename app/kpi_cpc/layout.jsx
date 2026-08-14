import { AccessGuard } from "@/components/access-guard"
import { CPC_KPI_MENU_HREF } from "@/modules/cpc/constants"

export default function CpcKpiLayout({ children }) {
  return <AccessGuard menuHref={CPC_KPI_MENU_HREF}>{children}</AccessGuard>
}
