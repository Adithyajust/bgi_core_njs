// Jangan validasi duplicate berdasarkan:
// event_date + tid
//
// Karena satu TID dapat memiliki banyak transaksi per hari.
//
// Gunakan cro_transaction_id.

export function validateDSR(rows){

    const seen = new Set();

    const duplicate=[];

    for(const row of rows){

        const key=row.cro_transaction_id;

        if(seen.has(key)){
            duplicate.push(row);
        }

        seen.add(key);
    }

    return duplicate;
}
