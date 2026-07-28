import { TransactionTable } from "@/components/transaction-table";

export default function TransactionsPage() {
  return (
    <div className="simple-page">
      <section className="page-heading-card">
        <p className="eyebrow">Transaction Monitoring</p>
        <h2>Monitoring transaksi bernilai tinggi</h2>
        <p>Template halaman transaksi dengan filter, risk badge, status approval, dan tabel operasional.</p>
      </section>
      <TransactionTable />
    </div>
  );
}
