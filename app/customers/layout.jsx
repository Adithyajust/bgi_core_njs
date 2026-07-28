import {
  AccessGuard,
} from "@/components/access-guard"

export default function CustomersLayout({
  children,
}) {
  return (
    <AccessGuard menuHref="/customers">
      {children}
    </AccessGuard>
  )
}