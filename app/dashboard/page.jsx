import { ApprovalQueue } from "@/components/approval-queue";
import { BranchPerformance } from "@/components/branch-performance";
import { ExecutiveCard } from "@/components/executive-card";
import { RevenueChart } from "@/components/revenue-chart";
import { RiskPanel } from "@/components/risk-panel";
import { TransactionTable } from "@/components/transaction-table";
import { TreasuryPanel } from "@/components/treasury-panel";
import { executiveCards } from "@/lib/data";

export default function DashboardPage() {
  return (
    <div className="dashboard-page">
      <section className="hero-strip">
        <div>
          <p className="eyebrow">Today Overview</p>
          <h2>Kelola operasi corporate banking secara real-time.</h2>
          <p>Monitor dana kelolaan, transaksi bernilai tinggi, approval, risiko, dan performa cabang dalam satu executive console.</p>
        </div>
        <div className="hero-actions">
          <button className="primary-button">Review Transaction</button>
          <button className="ghost-button light">Generate Report</button>
        </div>
      </section>

      <section className="executive-grid">
        {executiveCards.map((card) => <ExecutiveCard key={card.label} {...card} />)}
      </section>

      <section className="main-grid">
        <div className="left-stack">
          <RevenueChart />
          <TransactionTable />
        </div>
        <div className="right-stack">
          <TreasuryPanel />
          <ApprovalQueue />
          <RiskPanel />
          <BranchPerformance />
        </div>
      </section>
    </div>
  );
}
