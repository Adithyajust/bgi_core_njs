export function prepareIncrementalDSR(rows){

    return rows.map((row,index)=>({

        source_row:index+1,

        event_date:row.event_date,
        tid:row.tid,
        location:row.location,
        denom:row.denom,
        machine_type:row.machine_type,
        sheets:row.sheets,
        realized:row.realized,

        status:null,
        cause:null,
        obstacle:null,
        note:null

    }));

}
