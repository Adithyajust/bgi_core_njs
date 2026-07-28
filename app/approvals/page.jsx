import { ApprovalQueue } from "@/components/approval-queue";

export default function ApprovalsPage() {
  return (
    <div className="simple-page two-column-page">
      <section className="page-heading-card wide">
        <p className="eyebrow">Approval Center</p>
        <h2>Workflow approval internal</h2>
        <p>Gunakan area ini untuk approval transaksi, limit, pembukaan rekening, dan validasi dokumen korporat.</p>
      </section>
      <ApprovalQueue />
    </div>
  );
}
