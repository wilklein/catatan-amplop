const SUPABASE_URL='https://fdgmnwbkuzstfvfqwxpg.supabase.co';
const SUPABASE_KEY='sb_publishable_p0TCJzHBdDzP-0lFFFAsrQ_QSIBWd0J';
const headers={apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`,'Content-Type':'application/json'};
type AnyObj=Record<string,any>;
const mapRow=(r:AnyObj)=>({id:r.id,name:r.name,village:r.village,amount:Number(r.amount),createdAt:r.created_at,updatedAt:r.updated_at});
async function req(path:string,init:RequestInit={}){const res=await fetch(SUPABASE_URL+'/rest/v1/'+path,{...init,headers:{...headers,...(init.headers||{})}});if(!res.ok)throw new Error(await res.text());const text=await res.text();return text?JSON.parse(text):null;}
async function list(){const rows=await req('amplop_records?select=*&order=created_at.desc&limit=10000');return rows.map(mapRow);}
export const api={
 async get(path:string){if(path.startsWith('/api/records'))return{data:{records:await list(),nextToken:null}};if(path.startsWith('/api/search')){const q=new URL(path,'https://x').searchParams.get('q')?.trim().toLowerCase()||'';const rows=(await list()).filter((r:any)=>(r.name+' '+r.village).toLowerCase().includes(q));return{data:{records:rows,nextToken:null}};}throw new Error('Endpoint belum tersedia');},
 async post(path:string,body:AnyObj){if(path==='/api/records'){const now=new Date().toISOString();const row={id:crypto.randomUUID(),name:body.name,village:body.village,amount:body.amount,created_at:now,updated_at:now};const out=await req('amplop_records',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(row)});return{data:{record:mapRow(out[0])}};}if(path==='/api/book-records'){const now=new Date().toISOString();const rows=body.rows.map((r:any)=>({id:crypto.randomUUID(),name:r.name,village:r.village,amount:r.amount,created_at:now,updated_at:now}));const out=await req('amplop_records',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(rows)});return{data:{ids:out.map((x:any)=>x.id)}};}if(path==='/api/restore'){const rows=body.records.map((r:any)=>({id:r.id||crypto.randomUUID(),name:r.name||'',village:r.village||'',amount:Number(r.amount)||0,created_at:r.createdAt||new Date().toISOString(),updated_at:r.updatedAt||new Date().toISOString()}));await req('amplop_records?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(rows)});return{data:{restored:rows.length}};}if(['/api/transcribe','/api/scan-envelope','/api/scan-book'].includes(path)){const res=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const text=await res.text();let data:any;try{data=text?JSON.parse(text):{};}catch{data={error:text||'Respons server tidak valid'}}if(!res.ok)throw new Error(res.status===404?'API voice/scan belum terpasang. Deploy seluruh kode termasuk folder api.':res.status===413?'Foto/rekaman terlalu besar. Pilih file yang lebih kecil.':data.error||data.message||'Fitur AI gagal diproses');return{data};}throw new Error('Endpoint belum tersedia');},
 async put(path:string,body:AnyObj){const id=path.split('/').pop();await req(`amplop_records?id=eq.${encodeURIComponent(id||'')}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({name:body.name,village:body.village,amount:body.amount,updated_at:new Date().toISOString()})});return{data:{ok:true}};},
 async delete(path:string){const id=path.split('/').pop();await req(`amplop_records?id=eq.${encodeURIComponent(id||'')}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});return{data:{ok:true}};}
};
export const image = {
 async resizeIfNeeded(file: File, options: {maxDimension?: number; maxPixels?: number; quality?: number; mimeType?: string} = {}) {
  if(file.size > 30_000_000) throw new Error('Foto terlalu besar. Pilih foto di bawah 30 MB.');
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
   if(typeof createImageBitmap === 'function') bitmap = await createImageBitmap(file);
   else {
    const url=URL.createObjectURL(file);
    try { bitmap=await new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=url;}); }
    finally {URL.revokeObjectURL(url);}
   }
  } catch {throw new Error('Format foto belum bisa dibuka. Gunakan JPG, PNG, atau WebP.');}
  try {
   const scale=Math.min(1,(options.maxDimension||1600)/Math.max(bitmap.width,bitmap.height),Math.sqrt((options.maxPixels||2_000_000)/(bitmap.width*bitmap.height)));
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Browser tidak bisa memproses foto.');
   let quality=options.quality||0.85;
   for(let attempt=0;attempt<8;attempt++){
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Kompresi foto gagal.')),'image/jpeg',quality));
    if(blob.size<=3_000_000){const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return {data:btoa(binary),mimeType:'image/jpeg'};}
    if(quality>0.6) quality-=0.1;
    else {canvas.width=Math.max(1,Math.floor(canvas.width*0.8));canvas.height=Math.max(1,Math.floor(canvas.height*0.8));}
   }
   throw new Error('Foto masih terlalu besar. Potong area kosong lalu coba lagi.');
  } finally {if('close' in bitmap)bitmap.close();}
 }
};
