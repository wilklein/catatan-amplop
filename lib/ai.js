export function json(res,status,data){res.status(status).setHeader('Content-Type','application/json');res.end(JSON.stringify(data));}
export function onlyPost(req,res){if(req.method!=='POST'){json(res,405,{error:'Method tidak diizinkan.'});return false}return true}
export function apiKey(res){const key=process.env.OPENAI_API_KEY;if(!key){json(res,500,{error:'OPENAI_API_KEY belum dipasang di Vercel.'});return null}return key}
export function validBase64(data,maxBytes){return typeof data==='string'&&data.length>0&&Math.floor(data.length*3/4)<=maxBytes}
export async function visionJson({key,data,mimeType,prompt,schema,maxOutputTokens=4096}){
 const body={model:process.env.OPENAI_VISION_MODEL||'gpt-4.1-mini',input:[{role:'user',content:[{type:'input_text',text:prompt},{type:'input_image',image_url:`data:${mimeType};base64,${data}`,detail:'high'}]}],text:{format:{type:'json_schema',name:'extraction',strict:true,schema}},max_output_tokens:maxOutputTokens};
 const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:AbortSignal.timeout(50000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const raw=await r.text();if(!r.ok)throw providerError(r.status,raw);const out=JSON.parse(raw);
 const text=out.output_text||out.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text;if(!text)throw new Error('AI tidak mengembalikan hasil teks.');return JSON.parse(text);
}

export function providerError(status,raw){
 let code='';try{code=JSON.parse(raw).error?.code||''}catch{}
 const error=new Error('AI provider request failed');error.providerStatus=status;error.providerCode=code;return error;
}
export function aiFailure(res,error){
 const status=error.providerStatus;
 if(status===401||status===403)return json(res,502,{error:'API key OpenAI tidak valid atau akses ditolak. Periksa OPENAI_API_KEY di Vercel lalu redeploy.'});
 if(status===429)return json(res,429,{error:error.providerCode==='insufficient_quota'?'Saldo/kuota API OpenAI habis. Periksa billing akun OpenAI API.':'Permintaan AI terlalu sering. Tunggu sebentar lalu coba lagi.'});
 if(status===404||error.providerCode==='model_not_found')return json(res,502,{error:'Model AI tidak tersedia untuk akun ini. Periksa OPENAI_VISION_MODEL atau OPENAI_TRANSCRIBE_MODEL lalu redeploy.'});
 if(error.name==='TimeoutError'||error.name==='AbortError')return json(res,504,{error:'AI terlalu lama merespons. Coba lagi dengan rekaman singkat atau foto yang lebih jelas.'});
 return json(res,502,{error:'AI belum berhasil memproses data. Periksa format foto/rekaman lalu coba lagi.'});
}
