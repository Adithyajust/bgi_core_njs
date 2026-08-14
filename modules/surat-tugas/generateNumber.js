export function generateNumber(){
 const d=new Date();
 return `ST-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${Date.now()}`;
}
