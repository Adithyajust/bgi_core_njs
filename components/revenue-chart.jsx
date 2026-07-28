export function RevenueChart() {
  const points = "0,145 70,112 140,126 210,82 280,95 350,52 420,70 490,38 560,58 630,24 700,44";

  return (
    <section className="panel revenue-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Liquidity Movement</p>
          <h3>Volume transaksi corporate</h3>
        </div>
        <div className="segmented-control">
          <button>Day</button><button className="active">Month</button><button>Year</button>
        </div>
      </div>
      <div className="chart-wrap">
        <svg viewBox="0 0 700 180" preserveAspectRatio="none">
          <defs>
            <linearGradient id="bankLine" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#0b63ce" stopOpacity="0.38" />
              <stop offset="100%" stopColor="#0b63ce" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={`M ${points} L 700 180 L 0 180 Z`} fill="url(#bankLine)" />
          <polyline points={points} fill="none" stroke="#0b63ce" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="0,160 70,152 140,144 210,132 280,122 350,112 420,96 490,88 560,78 630,68 700,54" fill="none" stroke="#ff8a00" strokeWidth="4" strokeLinecap="round" strokeDasharray="10 10" />
        </svg>
        <div className="chart-stat floating one"><b>Rp 3,2 T</b><span>Peak volume</span></div>
        <div className="chart-stat floating two"><b>+18%</b><span>Collections</span></div>
      </div>
    </section>
  );
}
