import {
  AccessGuard,
} from "@/components/access-guard"

export default function DashboardLayout({
  children,
}) {
  return (
    <AccessGuard menuHref="/dashboard">
      {children}
    </AccessGuard>
  )
}