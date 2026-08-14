import { AccessGuard } from "@/components/access-guard"
import { REPLENISH_FIELD_MENU_HREF } from "@/modules/replenish/constants"

export default function ReplenishFieldLayout({ children }) {
  return <AccessGuard menuHref={REPLENISH_FIELD_MENU_HREF}>{children}</AccessGuard>
}
