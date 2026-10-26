// Normalisasi DSR sebelum insert database.

export function normalizeDSR(rows){

    return rows.map((row,index)=>({

        ...row,

        cro_transaction_id:
            row.cro_transaction_id ||
            `ROW-${row.source_row || index + 1}`

    }));

}
