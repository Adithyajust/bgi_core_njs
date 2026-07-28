import { transactions } from "@/lib/data";

export function TransactionTable() {
  return (
    <section className="panel table-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Live Monitoring</p>
          <h3>Transaksi high-value terbaru</h3>
        </div>
        <button className="text-button">Lihat semua</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Risk</th>
              <th>Status</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((item) => (
              <tr key={item.company}>
                <td><strong>{item.company}</strong></td>
                <td>{item.type}</td>
                <td>{item.amount}</td>
                <td><span className={`risk ${item.risk.toLowerCase()}`}>{item.risk}</span></td>
                <td><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span></td>
                <td>{item.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
