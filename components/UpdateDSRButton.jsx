"use client"
import {useState} from "react"

export default function UpdateDSRButton({period, ukerId}) {
 const [loading,setLoading]=useState(false)
 const [message,setMessage]=useState("")

 async function syncDSR(){
  setLoading(true)
  try{
   const res=await fetch("/api/rpl-terjadwal/sync-dsr",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({period,ukerId})
   })
   const data=await res.json()
   if(!res.ok) throw new Error(data.message||"Update gagal")
   setMessage(`Berhasil update ${data.data?.count||0} data DSR`)
  }catch(e){setMessage(e.message)}
  finally{setLoading(false)}
 }

 return <div>
  <button type="button" disabled={loading} onClick={syncDSR} className="primary-button">
   {loading?"Mengambil DSR CRO...":"Update DSR Terbaru"}
  </button>
  {message && <p>{message}</p>}
 </div>
}
