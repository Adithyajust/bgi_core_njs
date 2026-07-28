import { branchPerformance } from "@/lib/data";

export function BranchPerformance() {
  return (
    <section className="panel branch-panel">
      <div className="panel-header slim">
        <div>
          <p className="eyebrow">Regional</p>
          <h3>Top branch performance</h3>
        </div>
      </div>
      <div className="branch-list">
        {branchPerformance.map((branch) => (
          <article key={branch.name}>
            <div>
              <strong>{branch.name}</strong>
              <span>{branch.volume}</span>
            </div>
            <div className="branch-meter"><span style={{ width: `${branch.score}%` }} /></div>
            <b>{branch.score}</b>
          </article>
        ))}
      </div>
    </section>
  );
}
