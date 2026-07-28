import {
  AccessGuard,
} from "@/components/access-guard"

export default function SettingsLayout({
  children,
}) {
  return (
    <AccessGuard menuHref="/settings">
      {children}
    </AccessGuard>
  )
}