import {
  AccessGuard,
} from "@/components/access-guard"

export default function MastersLayout({
  children,
}) {
  return (
    <AccessGuard menuHref="/masters">
      {children}
    </AccessGuard>
  )
}