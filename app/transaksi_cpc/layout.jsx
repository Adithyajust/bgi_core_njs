import { AccessGuard } from "@/components/access-guard"

export default function CpcTransactionLayout({ children }) {
  return <AccessGuard menuHref="/transaksi_cpc">{children}</AccessGuard>
}
