import {
  requireMenuAccess,
} from "@/lib/access-control"

export async function AccessGuard({
  menuHref,
  children,
}) {
  await requireMenuAccess(menuHref)

  return children
}