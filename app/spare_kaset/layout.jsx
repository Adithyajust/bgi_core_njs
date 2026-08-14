import { AccessGuard } from "@/components/access-guard"
import { CPC_SPARE_CASSETTE_MENU_HREF } from "@/modules/cpc/constants"

export default function SpareCassetteLayout({ children }) {
  return <AccessGuard menuHref={CPC_SPARE_CASSETTE_MENU_HREF}>{children}</AccessGuard>
}
