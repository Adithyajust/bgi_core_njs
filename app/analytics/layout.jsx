import {
  AccessGuard,
} from "@/components/access-guard"

export default function AnalyticsLayout({
  children,
}) {
  return (
    <AccessGuard menuHref="/analytics">
      {children}
    </AccessGuard>
  )
}