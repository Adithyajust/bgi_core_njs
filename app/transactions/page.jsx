import Link from "next/link"

import { TransactionTable } from "@/components/transaction-table"

export default function TransactionsPage() {
  return (
    <div className="simple-page">
      <section className="page-heading-card">
        <p className="eyebrow">Transaction Operations</p>
        <h2>Pusat Transaksi Operasional</h2>
        <p>
          Pilih transaksi operasional untuk membuat work order, memantau progres,
          menjalankan persetujuan, dan menelusuri audit aktivitas.
        </p>
      </section>

      <section className="transaction-module-grid">
        <Link href="/transactions/replenish" className="transaction-module-card active">
          <span className="transaction-module-icon">ATM</span>
          <div>
            <p className="eyebrow">ATM/CRM</p>
            <h3>Replenish</h3>
            <p>
              Work order pengisian normal, pengosongan, dan pengisian perdana
              dengan jadwal, tim, rute, persetujuan, dan audit trail.
            </p>
          </div>
          <strong>Buka modul →</strong>
        </Link>

        <article className="transaction-module-card muted">
          <span className="transaction-module-icon">CPC</span>
          <div>
            <p className="eyebrow">Tahap Berikutnya</p>
            <h3>Kaset & Rekonsiliasi</h3>
            <p>
              Penyiapan kaset, blotter, bill count, penerimaan uang kembali,
              dan rekonsiliasi akan menggunakan work order Replenish sebagai induk.
            </p>
          </div>
          <strong>Fondasi tersedia</strong>
        </article>
      </section>

      <TransactionTable />
    </div>
  )
}
