import { createWorker } from 'tesseract.js';

export type OcrRow={name:string;village:string;amount:number|null;warning?:string};

const moneyFrom=(s:string)=>{
 const m=s.match(/(?:rp\s*)?([0-9][0-9.,]{2,})/i);
 if(!m)return null;
 const n=Number(m[1].replace(/\D/g,''));
 return Number.isSafeInteger(n)&&n>0?n:null;
};
const clean=(s:string)=>s.replace(/\s+/g,' ').trim();

export async function readImage(file:File){
 const worker=await createWorker('ind');
 try{
  const {data}=await worker.recognize(file);
  return {text:data.text||'',confidence:Math.round(data.confidence||0)};
 } finally { await worker.terminate(); }
}

export function parseSingle(text:string):OcrRow{
 const lines=text.split(/\r?\n/).map(clean).filter(Boolean);
 const joined=clean(lines.join(' '));
 const amount=moneyFrom(joined);
 const withoutMoney=clean(joined.replace(/(?:rp\s*)?[0-9][0-9.,]{2,}/ig,''));
 const marker=withoutMoney.match(/^(.*?)\s+(?:desa|ds\.?|alamat|jl\.?|jln\.?|jalan)\s+(.+)$/i);
 if(marker)return{name:clean(marker[1]),village:clean(marker[2]),amount};
 return{name:lines[0]||'',village:clean(lines.slice(1).join(' ').replace(/(?:rp\s*)?[0-9][0-9.,]{2,}/ig,'')),amount,
  warning:'OCR lokal: periksa kembali nama, alamat, dan nominal sebelum Simpan.'};
}

export function parseRows(text:string):OcrRow[]{
 const lines=text.split(/\r?\n/).map(clean).filter(Boolean);
 const out:OcrRow[]=[];
 for(const line of lines){
  const amount=moneyFrom(line);
  if(!amount)continue;
  const left=clean(line.replace(/(?:rp\s*)?[0-9][0-9.,]{2,}/ig,''));
  const parts=left.split(/\s{2,}|\s+-\s+|\s+\/\s+/).map(clean).filter(Boolean);
  if(parts.length>=2)out.push({name:parts[0],village:parts.slice(1).join(' '),amount});
  else out.push({name:left,village:'',amount,warning:'Alamat belum terpisah; koreksi manual.'});
 }
 return out;
}
