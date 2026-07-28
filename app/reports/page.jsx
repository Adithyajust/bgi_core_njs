import { reports } from "@/lib/data";

export default function ReportsPage() {
  return (
    <div className="simple-page">
      <section className="page-heading-card">
        <p className="eyebrow">Reports</p>
        <h2>Laporan manajemen dan operasional</h2>
        <p>Siapkan laporan harian, settlement, audit, hingga ringkasan risiko untuk pimpinan.</p>
      </section>
      <section className="report-grid">
        {reports.map((report) => <article className="report-card" key={report}><span>PDF</span><strong>{report}</strong><p>Updated today at 08:00 WIB</p><button>Download</button></article>)}
      </section>
    </div>
  );
}
