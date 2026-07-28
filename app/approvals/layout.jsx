import {
  AccessGuard,
} from "@/components/access-guard"

export default function ApprovalsLayout({
  children,
}) {
  return (
    <AccessGuard menuHref="/approvals">
      {children}
    </AccessGuard>
  )
}