// PATCH untuk upload-client.jsx
// Ganti bagian:
// <p>{num(preview.parameter_count)} TID · {num(preview.missing_denom)} TID belum memiliki Denom.</p>

// Menjadi:

<p>
  {num(preview.parameter_count)} TID · {num(preview.missing_denom)} TID belum memiliki Denom.
</p>

{preview.summary?.missing_denom_items?.length > 0 && (
  <div className="rpl-upload-warning">
    <strong>Detail TID belum memiliki Denom:</strong>
    <div className="table-wrap rpl-upload-table">
      <table>
        <thead>
          <tr>
            <th>TID</th>
            <th>Lokasi</th>
            <th>Jenis Mesin</th>
            <th>Cluster</th>
          </tr>
        </thead>
        <tbody>
          {preview.summary.missing_denom_items.map((item) => (
            <tr key={item.tid}>
              <td>{item.tid}</td>
              <td>{item.location || "—"}</td>
              <td>{item.machine_type || "—"}</td>
              <td>{item.cluster || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)}
