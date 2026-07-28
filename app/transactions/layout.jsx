import {
  AccessGuard,
} from "@/components/access-guard"

export default function TransactionsLayout({
  children,
}) {
  return (
    <AccessGuard menuHref="/transactions">
      {children}
    </AccessGuard>
  )
}