import { areaBranches } from "@/lib/data";

export default function BranchesPage() {
  return (
    <div className="simple-page">
      <section className="page-heading-card">
        <p className="eyebrow">Branch & Area Network</p>
        <h2>Monitoring performa cabang dan regional</h2>
        <p>Pantau kontribusi portfolio, jumlah kantor, pertumbuhan, dan SLA layanan corporate banking berdasarkan area.</p>
      </section>

      <section className="panel table-panel">
        <div className="panel-header">
          <h3>Area performance</h3>
          <button className="primary-button">Add Area</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Area</th>
                <th>Kantor</th>
                <th>Portfolio</th>
                <th>Growth</th>
                <th>SLA</th>
              </tr>
            </thead>
            <tbody>
              {areaBranches.map((item) => (
                <tr key={item.area}>
                  <td><strong>{item.area}</strong></td>
                  <td>{item.offices}</td>
                  <td>{item.portfolio}</td>
                  <td><span className="pill green">{item.growth}</span></td>
                  <td>{item.sla}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
