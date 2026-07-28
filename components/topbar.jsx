export function Topbar() {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Corporate Cash Managemen</p>
        <h1>Executive Operations Dashboard</h1>
      </div>
      <div className="topbar-actions">
        <label className="search-box">
          <span>⌕</span>
          <input placeholder="Cari transaksi, nasabah, rekening..." />
        </label>
        <button className="ghost-button">Export</button>
        <button className="primary-button">New Approval</button>
        <div className="profile-chip">AD</div>
      </div>
    </header>
  );
}
