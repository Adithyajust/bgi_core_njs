export function validate(row){
 return !!row && row.status==='APPROVED' && !!row.qr_token;
}
