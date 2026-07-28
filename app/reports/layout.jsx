import {
  AccessGuard,
} from "@/components/access-guard"

export default function ReportsLayout({
  children,
}) {
  return (
    <AccessGuard menuHref="/reports">
      {children}
    </AccessGuard>
  )
}