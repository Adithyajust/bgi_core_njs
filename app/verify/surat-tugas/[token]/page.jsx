import { redirect } from "next/navigation"

export default async function LegacyVerifyAssignmentLetterPage({ params }) {
  const { token } = await params

  redirect(`/transactions/replenish/surat-tugas/verify/${encodeURIComponent(token)}`)
}
