'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'js/photo-telegram-domain.js'),'utf8'),share=fs.readFileSync(path.join(root,'js/share-domain.js'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const context={Blob,Uint8Array,atob:globalThis.atob,console};vm.createContext(context);vm.runInContext(source.slice(0,source.indexOf('async function fetchPhotoFromTelegram')),context);
(async()=>{
  const photo=context.photoDataUrlToBlob('data:image/png;base64,AAE=');
  assert.equal(photo.type,'image/png');assert.deepEqual([...new Uint8Array(await photo.arrayBuffer())],[0,1],'allowed base64 becomes the original image bytes');
  for(const unsafe of ['data:text/html;base64,PGgxPkJvb208L2gxPg==','data:image/svg+xml;base64,PHN2Zy8+','data:image/jpeg;base64,not*base64','data:image/jpeg;base64,'])assert.throws(()=>context.photoDataUrlToBlob(unsafe),error=>error&&error.name==='TypeError','unsafe/non-raster input is rejected');
  assert.doesNotMatch(source,/window\.fetch\s*=/,'photo conversion never replaces global fetch');
  assert.match(source,/async function photoSourceToBlob\(/,'a scoped source-to-Blob helper owns the exceptional path');
  assert.doesNotMatch(source,/fetch\(photoData\)/,'Telegram paths use the scoped helper');
  assert.doesNotMatch(share,/fetch\(photoData\)/,'share paths use the scoped helper');
  assert.doesNotMatch(html,/photo-data-fetch-v65-14/,'retired global fetch patch is not loaded');
  assert.doesNotMatch(sw,/photo-data-fetch-v65-14/,'retired global fetch patch is not precached');
  console.log('PASS scoped safe photo data-URL conversion replaces the global fetch patch');
})().catch(error=>{console.error(error);process.exitCode=1;});
