// Logic incremental sync.
//
// Jika sudah pernah sync:
// ambil setelah tanggal terakhir.
//
// Identifikasi transaksi menggunakan cro_transaction_id.

export function buildIncrementalSyncRange(lastSyncDate, today) {

    if (!lastSyncDate) {
        return {
            startDate: null,
            endDate: today,
            mode: "initial"
        };
    }

    const next = new Date(lastSyncDate);
    next.setDate(next.getDate()+1);

    return {
        startDate: next.toISOString().slice(0,10),
        endDate: today,
        mode: "incremental"
    };
}
