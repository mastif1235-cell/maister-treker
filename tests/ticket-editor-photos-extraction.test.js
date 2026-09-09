'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8').replace(/\r\n/g,'\n');
const source=read('js/ticket-editor-photos.js');
assert.equal(crypto.createHash('sha256').update(source.slice(source.indexOf('function renderPhotoPreview(){')).trim()).digest('hex'),
  '3f55b59b487ab7976ae4a2a49f4d38248b423d05af3d3f937607585985f3fa24');
for(const name of ['renderPhotoPreview','handlePhotoFile']) {
  assert.doesNotMatch(read('js/ticket-editor-domain.js'),new RegExp('function '+name+'\\('));
  assert.match(source,new RegExp('function '+name+'\\('));
}
assert.doesNotMatch(source,/addEventListener|setInterval|setTimeout/);
const html=read('index.html');
assert.ok(html.indexOf('src="js/ticket-editor-photos.js"')>html.indexOf('src="js/ticket-editor-domain.js"'));
assert.ok(html.indexOf('src="js/ticket-editor-photos.js"')<html.indexOf('src="js/tickets-bindings.js"'));
assert.equal((read('sw.js').match(/'\.\/js\/ticket-editor-photos\.js'/g)||[]).length,1);
const elements={};
const callbacks=[];const deleted=[];const cache=[];
const context={calcState:{photos:['original'],tgPhotoFileIds:['tg-original']},formSessionId:1,
  document:{getElementById:id=>elements[id]||(elements[id]={}),createElement:()=>({getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,test'})},
  getPhotoCached:(key,cb,fallback)=>{assert.equal(key,'original');assert.equal(fallback,'tg-original');return 'cached-original';},
  FileReader:class {readAsDataURL(){this.onload({target:{result:'input'}});}},
  Image:class {constructor(){this.width=1600;this.height=800;}set src(value){this.onload();}},
  storePhoto:()=>({then:cb=>callbacks.push(cb)}),deletePhotoKey:key=>deleted.push(key),photoCacheSet:(...args)=>cache.push(args),showToast(){}
};
vm.createContext(context);vm.runInContext(source,context);
assert.deepEqual(elements,{},'script load has no DOM/storage effects');
context.renderPhotoPreview();
assert.equal(elements.photoPreview0.src,'cached-original');
context.handlePhotoFile({});
assert.deepEqual(context.calcState.photos,['original'],'existing photo retained while storage is pending');
context.getPhotoCached=key=>'cached-'+key;
callbacks.shift()('new-photo');
assert.deepEqual(context.calcState.photos,['original','new-photo']);
assert.equal(context.calcState.photo,'original');
assert.equal(cache.length,1);
context.handlePhotoFile({});
context.formSessionId++;
callbacks.shift()('stale-photo');
assert.deepEqual(deleted,['stale-photo'],'only newly created photo from obsolete session cleaned up');
assert.deepEqual(context.calcState.photos,['original','new-photo']);
context.calcState.photos.push('third');
context.renderPhotoPreview();context.handlePhotoFile({});
assert.equal(elements.photoCameraBtn.disabled,true);
assert.equal(callbacks.length,0,'three-photo limit preserved');
console.log('PASS photo extraction: exact body, load order, preview, existing/new photos, obsolete session, limit');
