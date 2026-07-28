import {
  AccessGuard,
} from "@/components/access-guard"

export default function BranchesLayout({
  children,
}) {
  return (
    <AccessGuard menuHref="/branches">
      {children}
    </AccessGuard>
  )
}