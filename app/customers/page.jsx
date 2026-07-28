import { customers } from "@/lib/data";

export default function CustomersPage() {
  return (
    <div className="simple-page">
      <section className="page-heading-card">
        <p className="eyebrow">Corporate Customers</p>
        <h2>Manajemen nasabah prioritas</h2>
        <p>Gunakan halaman ini untuk memantau portofolio, PIC relationship manager, saldo, dan health score nasabah corporate.</p>
      </section>
      <section className="panel table-panel">
        <div className="panel-header"><h3>Customer portfolio</h3><button className="primary-button">Add Customer</button></div>
        <table>
          <thead><tr><th>Company</th><th>Segment</th><th>PIC</th><th>Balance</th><th>Health</th></tr></thead>
          <tbody>{customers.map((item) => <tr key={item.name}><td><strong>{item.name}</strong></td><td>{item.segment}</td><td>{item.pic}</td><td>{item.balance}</td><td><span className="status approved">{item.health}</span></td></tr>)}</tbody>
        </table>
      </section>
    </div>
  );
}
