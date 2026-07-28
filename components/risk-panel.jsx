export function RiskPanel() {
  return (
    <section className="panel risk-panel">
      <div className="panel-header slim">
        <div>
          <p className="eyebrow">Risk Control</p>
          <h3>Fraud & compliance score</h3>
        </div>
        <span className="pill green">Healthy</span>
      </div>
      <div className="risk-score">
        <div className="donut"><span>82</span></div>
        <div>
          <strong>Low exposure</strong>
          <p>37 alert aktif, 4 perlu eskalasi compliance, 0 critical outage.</p>
        </div>
      </div>
      <div className="risk-bars">
        <label><span>AML screening</span><b>91%</b></label><div><span style={{ width: "91%" }} /></div>
        <label><span>Transaction anomaly</span><b>76%</b></label><div><span style={{ width: "76%" }} /></div>
        <label><span>KYC completeness</span><b>88%</b></label><div><span style={{ width: "88%" }} /></div>
      </div>
    </section>
  );
}
