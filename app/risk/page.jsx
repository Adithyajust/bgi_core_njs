import { RiskPanel } from "@/components/risk-panel";

export default function RiskPage() {
  return (
    <div className="simple-page two-column-page">
      <section className="page-heading-card wide">
        <p className="eyebrow">Risk Monitor</p>
        <h2>Fraud, AML, dan compliance monitoring</h2>
        <p>Dashboard risiko untuk melihat anomaly score, kelengkapan KYC, fraud alert, dan status review compliance.</p>
      </section>
      <RiskPanel />
    </div>
  );
}
