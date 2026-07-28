import {
  AccessGuard,
} from "@/components/access-guard"

export default function RiskLayout({
  children,
}) {
  return (
    <AccessGuard menuHref="/risk">
      {children}
    </AccessGuard>
  )
}