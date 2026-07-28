export function TreasuryPanel() {
  return (
    <section className="treasury-card">
      <div className="treasury-bg" />
      <p className="eyebrow">Treasury Pulse</p>
      <h2>Corporate liquidity forecast stabil untuk 7 hari ke depan.</h2>
      <div className="treasury-grid">
        <div><span>Cash In</span><b>Rp 5,8 T</b></div>
        <div><span>Cash Out</span><b>Rp 4,1 T</b></div>
        <div><span>Net Position</span><b>+Rp 1,7 T</b></div>
      </div>
      <button>Open treasury cockpit</button>
    </section>
  );
}
