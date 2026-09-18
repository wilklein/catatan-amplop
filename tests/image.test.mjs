import test from 'node:test';
import assert from 'node:assert/strict';
import {image} from '../src/cloud.ts';
test('large photo is resized and converted to JPEG before upload',async()=>{
 const saved={document:globalThis.document,createImageBitmap:globalThis.createImageBitmap,FileReader:globalThis.FileReader};
 const canvas={width:0,height:0,getContext:()=>({fillRect(){},drawImage(){}}),toBlob(cb,type){cb(new Blob(['compressed-photo'],{type}))}};
 globalThis.document={createElement:()=>canvas};
 globalThis.createImageBitmap=async()=>({width:4000,height:3000,close(){}});
 globalThis.FileReader=class{readAsDataURL(){this.result='data:image/png;base64,ORIGINAL';this.onload()}};
 try{const result=await image.resizeIfNeeded(new File(['source'],'photo.png',{type:'image/png'}),{maxDimension:1600,maxPixels:2000000,quality:.82,mimeType:'image/jpeg'});assert.equal(result.mimeType,'image/jpeg');assert.equal(Buffer.from(result.data,'base64').toString(),'compressed-photo');assert.equal(canvas.width,1600);assert.equal(canvas.height,1200)}finally{Object.assign(globalThis,saved)}
});
