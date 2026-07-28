import { approvals } from "@/lib/data";

export function ApprovalQueue() {
  return (
    <section className="panel approval-panel">
      <div className="panel-header slim">
        <div>
          <p className="eyebrow">Action Required</p>
          <h3>Approval queue</h3>
        </div>
        <span className="pill orange">3 pending</span>
      </div>
      <div className="approval-list">
        {approvals.map((item) => (
          <article className="approval-item" key={item.title}>
            <div className="approval-icon">!</div>
            <div>
              <strong>{item.title}</strong>
              <p>{item.owner}</p>
            </div>
            <span>{item.due}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
