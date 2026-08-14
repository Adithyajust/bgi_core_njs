"use client"

import { useRouter } from "next/navigation"

export default function SuratTugasButton({ id, status }) {
  const router = useRouter()

  if (status !== "APPROVED") return null

  return (
    <button
      type="button"
      onClick={() => router.push(`/transactions/replenish/${id}/surat-tugas`)}
    >
      Cetak Surat Tugas
    </button>
  )
}
