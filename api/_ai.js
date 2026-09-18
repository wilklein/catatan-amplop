export function json(res,status,data){res.status(status).setHeader('Content-Type','application/json');res.end(JSON.stringify(data));}
export function onlyPost(req,res){if(req.method!=='POST'){json(res,405,{error:'Method tidak diizinkan.'});return false}return true}
export function apiKey(res){const key=process.env.GEMINI_API_KEY;if(!key){json(res,500,{error:'GEMINI_API_KEY belum dipasang di Vercel.'});return null}return key}
export function validBase64(data,maxBytes){return typeof data==='string'&&data.length>0&&Math.floor(data.length*3/4)<=maxBytes}
function outputText(out){return (out?.candidates?.[0]?.content?.parts||[]).map(p=>p?.text||'').join('').trim()}
export async function geminiJson({key,data,mimeType,prompt,schema,maxOutputTokens=4096}){
 const model=process.env.GEMINI_MODEL||'gemini-2.5-flash';
 const body={contents:[{role:'user',parts:[{inlineData:{mimeType,data}},{text:prompt}]}],generationConfig:{responseMimeType:'application/json',responseSchema:schema,maxOutputTokens,temperature:0.1}};
 const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const raw=await r.text();if(!r.ok)throw new Error(`Gemini ${r.status}: ${raw.slice(0,700)}`);const out=JSON.parse(raw);const text=outputText(out);if(!text)throw new Error('Gemini tidak mengembalikan hasil teks.');return JSON.parse(text);
}
export async function geminiText({key,data,mimeType,prompt,maxOutputTokens=1200}){
 const model=process.env.GEMINI_MODEL||'gemini-2.5-flash';
 const body={contents:[{role:'user',parts:[{inlineData:{mimeType,data}},{text:prompt}]}],generationConfig:{maxOutputTokens,temperature:0}};
 const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const raw=await r.text();if(!r.ok)throw new Error(`Gemini ${r.status}: ${raw.slice(0,700)}`);const out=JSON.parse(raw);const text=outputText(out);if(!text)throw new Error('Gemini tidak mengembalikan transkrip.');return text;
}