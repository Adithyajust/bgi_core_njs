import { RevenueChart } from "@/components/revenue-chart";
import { analyticsInsights } from "@/lib/data";

export default function AnalyticsPage() {
  return (
    <div className="simple-page">
      <section className="page-heading-card">
        <p className="eyebrow">Business Analytics</p>
        <h2>Insight portfolio, transaksi, dan performa operasional</h2>
        <p>Halaman analytics disiapkan untuk membaca tren dana kelolaan, transaksi bernilai tinggi, anomali, dan efisiensi cabang.</p>
      </section>

      <section className="main-grid analytics-layout">
        <div className="left-stack">
          <RevenueChart />
        </div>
        <div className="right-stack">
          <section className="panel">
            <div className="panel-header slim">
              <h3>Key insights</h3>
              <button className="text-button">View all</button>
            </div>
            <div className="insight-list">
              {analyticsInsights.map((item) => (
                <article className="insight-card" key={item.title}>
                  <span>{item.value}</span>
                  <strong>{item.title}</strong>
                  <p>{item.note}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
