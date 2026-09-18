import test from 'node:test';
import assert from 'node:assert/strict';
import transcribe from '../api/transcribe.js';
import envelope from '../api/scan-envelope.js';
import book from '../api/scan-book.js';
function response(){return {status(code){this.code=code;return this},setHeader(){return this},end(body){this.body=JSON.parse(body)}}}
for(const [name,handler] of Object.entries({transcribe,envelope,book})){
 test(`${name}: GET is identifiable and never calls AI`,async()=>{const res=response();await handler({method:'GET'},res);assert.equal(res.code,405)});
 test(`${name}: missing key has actionable error`,async()=>{delete process.env.OPENAI_API_KEY;const res=response();await handler({method:'POST',body:{}},res);assert.equal(res.code,500);assert.match(res.body.error,/OPENAI_API_KEY/)});
}
test('provider quota error is actionable without leaking raw response',async()=>{
 process.env.OPENAI_API_KEY='test-only';const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:'insufficient_quota',message:'private-provider-detail'}}),{status:429});
 try{const res=response();await transcribe({method:'POST',body:{data:'YQ==',mimeType:'audio/webm'}},res);assert.equal(res.code,429);assert.match(res.body.error,/saldo|kuota/i);assert.doesNotMatch(res.body.error,/private-provider-detail/)}finally{globalThis.fetch=original;delete process.env.OPENAI_API_KEY}
});
test('voice returns transcript using provider multipart format',async()=>{
 process.env.OPENAI_API_KEY='test-only';const original=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/audio/transcriptions');assert.equal(init.body.get('file').name,'voice.m4a');assert.equal(init.body.get('language'),'id');return new Response(JSON.stringify({text:'Budi desa Maju lima puluh ribu'}))};
 try{const res=response();await transcribe({method:'POST',body:{data:'YQ==',mimeType:'audio/mp4'}},res);assert.equal(res.code,200);assert.equal(res.body.transcript,'Budi desa Maju lima puluh ribu')}finally{globalThis.fetch=original;delete process.env.OPENAI_API_KEY}
});
for(const [name,handler,extraction] of [
 ['envelope',envelope,{name:'Budi',village:'Maju',writtenAmount:50000,banknoteAmount:20000,confidence:90,warning:'',rawText:'Budi Maju',denominations:[]}],
 ['book',book,{rows:[{name:'Budi',village:'Maju',amount:50000,warning:''}],warning:''}]
])test(`${name}: provider structured output reaches the frontend safely`,async()=>{
 process.env.OPENAI_API_KEY='test-only';const original=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(init.body);assert.equal(body.text.format.type,'json_schema');assert.equal(body.input[0].content[1].image_url,'data:image/jpeg;base64,YQ==');return new Response(JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(extraction)}]}]}))};
 try{const res=response();await handler({method:'POST',body:{data:'YQ==',mimeType:'image/jpeg'}},res);assert.equal(res.code,200);if(name==='book')assert.deepEqual(res.body.rows,extraction.rows);else{assert.equal(res.body.result.amount,null);assert.equal(res.body.result.amountSource,'conflict')}}finally{globalThis.fetch=original;delete process.env.OPENAI_API_KEY}
});
