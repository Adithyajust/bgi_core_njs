export function ExecutiveCard({ label, value, delta, helper, tone }) {
  const positive = delta.startsWith("+");

  return (
    <article className={`executive-card ${tone}`}>
      <div className="card-glow" />
      <div className="card-header-row">
        <span>{label}</span>
        <b className={positive ? "delta positive" : "delta negative"}>{delta}</b>
      </div>
      <h2>{value}</h2>
      <p>{helper}</p>
      <div className="sparkline" aria-hidden="true">
        <span style={{ height: "42%" }} />
        <span style={{ height: "70%" }} />
        <span style={{ height: "55%" }} />
        <span style={{ height: "88%" }} />
        <span style={{ height: "64%" }} />
        <span style={{ height: "96%" }} />
      </div>
    </article>
  );
}
