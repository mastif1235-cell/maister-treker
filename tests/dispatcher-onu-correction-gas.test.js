'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const secret='synthetic-dispatcher-secret-for-onu-correction-tests';
const properties=new Map([['REPORT_ALLOWED_EMAIL','owner@example.test'],['REPORT_SPREADSHEET_ID','test-report'],['REPORT_ALLOWED_ORIGINS','https://example.test'],['MT_DISPATCHER_HMAC_SECRET',secret]]),cache=new Map();
let rows=[],rendered=[],rawWrites=0,locked=false,seq=0;
class Sheet{
  constructor(name){this.name=name;this.values=[];this.hidden=false;}
  getLastRow(){return this.values.length;}
  getMaxRows(){return 100;}
  insertRowsAfter(){}
  hideSheet(){this.hidden=true;}
  getRange(row,col,height=1,width=1){
    const sheet=this;return {
      getValues(){return Array.from({length:height},(_,dy)=>Array.from({length:width},(_,dx)=>sheet.values[row-1+dy]?.[col-1+dx]??''));},
      setValue(value){while(sheet.values.length<row)sheet.values.push([]);sheet.values[row-1][col-1]=value;return this;},
      setValues(values){values.forEach((line,dy)=>{const index=row-1+dy;while(sheet.values.length<=index)sheet.values.push([]);line.forEach((value,dx)=>{sheet.values[index][col-1+dx]=value;});});return this;},
      setNumberFormat(){return this;}
    };
  }
}
class Spreadsheet{
  constructor(){this.sheets=new Map();}
  getSheetByName(name){return this.sheets.get(name)||null;}
  insertSheet(name){const sheet=new Sheet(name);this.sheets.set(name,sheet);return sheet;}
}
const ss=new Spreadsheet();
const context={console:{warn:()=>{}},Date,Map,Set,JSON,ContentService:{MimeType:{JSON:'json'},createTextOutput:body=>({setMimeType:()=>JSON.parse(body)})},
  PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key)||null,setProperty:(key,value)=>properties.set(key,value),deleteProperty:key=>properties.delete(key)})},
  Session:{getActiveUser:()=>({getEmail:()=>properties.get('REPORT_ALLOWED_EMAIL')})},
  CacheService:{getScriptCache:()=>({get:key=>cache.get(key)||null,put:(key,value)=>cache.set(key,value)})},
  LockService:{getScriptLock:()=>({tryLock:()=>{locked=true;return true;},hasLock:()=>locked,releaseLock:()=>{locked=false;}})},
  SpreadsheetApp:{flush:()=>{}},
  Utilities:{DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(_,value)=>Array.from(crypto.createHash('sha256').update(String(value)).digest()),
    computeHmacSha256Signature:(value,key)=>Array.from(crypto.createHmac('sha256',String(key)).update(String(value),'utf8').digest()),
    base64EncodeWebSafe:bytes=>Buffer.from(bytes).toString('base64').replace(/\+/g,'-').replace(/\//g,'_'),newBlob:value=>({getBytes:()=>Array.from(Buffer.from(String(value),'utf8'))})}};
vm.createContext(context);vm.runInContext(fs.readFileSync('js/dispatcher-report-core.js','utf8'),context);vm.runInContext(fs.readFileSync('gas/dispatcher-report/DispatcherReport.gs','utf8'),context);
const core=context.MTDispatcherReportCore,canonical=require('../js/sync-contract.js');
function dto(id='1774458317612',version=100){const d=Object.fromEntries(core.FIELDS.map(key=>[key,'']));Object.assign(d,{ticket_id:id,work_date:'2026-10-06',work_time:'12:30',work_type:'Підключення',work_category:'connection',amount:800,total:800,payment_type:'Готівка',onu_used:0,onu_replacement:0,router_used:0,payment_cash:800,payment_cashless:0,payment_free_amount:0,payment_free_count:0,updated_at:'2026-10-14T10:00:00.000Z',source_version:version});d.source_hash=context.reportHash_(d);return d;}
context.reportStore_=()=>({ss,sheet:{},rows:structuredClone(rows)});
context.reportWrite_=store=>{rows=structuredClone(store.rows);rawWrites++;};
context.reportRender_=(spreadsheet,sourceRows)=>{rendered=context.reportOnuCorrectionEffectiveRows_(spreadsheet,sourceRows);};
function envelope(body,nonce){const env={v:3,method:'POST',action:body.action,entity:'system',id:'',ts:String(Date.now()),nonce:nonce||'n'+crypto.randomBytes(16).toString('hex'),requestId:body.request_id,body:JSON.stringify(body)};env.sig=crypto.createHmac('sha256',secret).update(canonical.canonical(env),'utf8').digest('base64url');return env;}
function direct(action,fields={},requestId){const body={action,...fields,request_id:requestId||'onu-test-'+(++seq)};return context.doPost({postData:{contents:JSON.stringify(envelope(body))}});}
function reset(){rows=[dto()];rendered=[];rawWrites=0;locked=false;seq=0;cache.clear();ss.sheets.clear();}
let count=0;
function test(name,fn){reset();fn();count++;}

test('read-only preview exposes only the five confirmed repair IDs and preserves raw rows',()=>{
  const before=JSON.stringify(rows),result=direct('report_onu_correction_preview');
  assert.equal(result.ok,true);assert.equal(result.items.length,5);assert.deepEqual(result.items.map(x=>x.ticket_id),['1774458317612','1774458317619','1783937356212','1783937356227','1783937356219']);
  assert.equal(result.items[0].state,'READY');assert.equal(result.items[0].before.work_category,'connection');assert.equal(result.items[0].after.work_category,'repair');assert.equal(result.items[0].after.onu_used,1);assert.equal(result.items[0].total_before,800);assert.equal(result.items[0].total_after,800);
  assert.equal(JSON.stringify(rows),before);assert.equal(ss.sheets.size,0);assert.equal(rawWrites,0);assert.equal(rendered.length,0);
});

test('signed apply appends a minimal snapshot, overlays only ONU/type fields, never rewrites data or receipts',()=>{
  const original=structuredClone(rows[0]),preview=direct('report_onu_correction_preview').items[0],oldWrites=rawWrites;
  const requestId='onu-apply-one';const result=direct('report_onu_correction_apply',{ticket_id:original.ticket_id,expected:{source_version:preview.source_version,source_hash:preview.source_hash,before:preview.before}},requestId);
  assert.equal(result.code,'APPLIED');assert.equal(result.onu_used,1);assert.equal(result.work_category,'repair');assert.equal(result.total,800);
  assert.deepEqual(rows[0],original);assert.equal(rawWrites,oldWrites);assert.equal(ss.getSheetByName('_DispatcherReceipts'),null);
  const stats=core.stats(rendered);assert.equal(stats.onu_repair,1);assert.equal(stats.onu_connection,0);assert.equal(stats.total,800);
  const ledger=ss.getSheetByName('_DispatcherOnuCorrections');assert(ledger?.hidden);assert.equal(ledger.getLastRow(),2);
  assert.deepEqual(JSON.parse(JSON.stringify(rendered[0])),{...original,work_type:'Ремонт',work_category:'repair',onu_used:1});
  const readback=direct('report_onu_correction_preview').items[0];assert.equal(readback.state,'APPLIED');assert.equal(readback.after.onu_used,1);assert.equal(readback.total_after,800);
});

test('stale version/hash and non-allowlisted IDs are rejected before journal creation',()=>{
  const preview=direct('report_onu_correction_preview').items[0],bad=direct('report_onu_correction_apply',{ticket_id:preview.ticket_id,expected:{source_version:preview.source_version+1,source_hash:preview.source_hash,before:preview.before}},'onu-stale-01');
  assert.equal(bad.code,'STALE_VERSION');assert.equal(ss.getSheetByName('_DispatcherOnuCorrections'),null);
  assert.equal(direct('report_onu_correction_apply',{ticket_id:'1786990035908',expected:{}},'onu-not-allowed').code,'INVALID_ONU_CORRECTION');
  assert.equal(rawWrites,0);
});

test('request replay is idempotent and conflicting payload cannot reuse request id',()=>{
  const preview=direct('report_onu_correction_preview').items[0],fields={ticket_id:preview.ticket_id,expected:{source_version:preview.source_version,source_hash:preview.source_hash,before:preview.before}};
  const first=direct('report_onu_correction_apply',fields,'onu-idempotent-01'),ledger=ss.getSheetByName('_DispatcherOnuCorrections');assert.equal(first.code,'APPLIED');
  const second=direct('report_onu_correction_apply',fields,'onu-idempotent-01');assert.equal(second.code,'APPLIED');assert.equal(ledger.getLastRow(),2);
  assert.equal(direct('report_onu_correction_apply',{...fields,ticket_id:'1774458317619'},'onu-idempotent-01').code,'INVALID_REQUEST_ID');assert.equal(ledger.getLastRow(),2);
});

test('normal later upsert cannot remove correction overlay; rollback appends a tombstone',()=>{
  const preview=direct('report_onu_correction_preview').items[0],applied=direct('report_onu_correction_apply',{ticket_id:preview.ticket_id,expected:{source_version:preview.source_version,source_hash:preview.source_hash,before:preview.before}},'onu-apply-sync-guard');
  assert.equal(applied.code,'APPLIED');
  const newer={...rows[0],source_version:rows[0].source_version+1,dispatcher_comment:'later non-financial update',updated_at:'2026-10-14T11:00:00.000Z'};newer.source_hash=context.reportHash_(newer);
  const upsert=direct('report_upsert',{ticket:newer,rebuild:false},'normal-newer-upsert').items[0];assert.equal(upsert.code,'OK');assert.equal(upsert.status,'synced');
  const active=context.reportOnuCorrectionEffectiveRows_(ss,rows);assert.equal(active[0].onu_used,1);assert.equal(active[0].work_category,'repair');assert.equal(active[0].total,800);
  const rollback=direct('report_onu_correction_rollback',{ticket_id:rows[0].ticket_id,correction_id:'onu-apply-sync-guard'},'onu-rollback-guard');
  assert.equal(rollback.code,'ROLLED_BACK');assert.equal(ss.getSheetByName('_DispatcherOnuCorrections').getLastRow(),3);
  const restored=context.reportOnuCorrectionEffectiveRows_(ss,rows);assert.equal(restored[0].onu_used,0);assert.equal(restored[0].work_category,'connection');assert.equal(restored[0].total,800);
});

test('unsigned mutation and bridge mutation remain denied',()=>{
  const before=JSON.stringify(rows),oldSheets=ss.sheets.size;
  assert.equal(context.doPost({postData:{contents:JSON.stringify({action:'report_onu_correction_apply',ticket_id:'1774458317612',request_id:'unsigned-01'})}}).code,'AUTH_FAILED');
  assert.equal(context.reportDispatch({action:'report_onu_correction_apply',ticket_id:'1774458317612',request_id:'bridge-01'}).code,'REPORT_DIRECT_TRANSPORT_REQUIRED');
  assert.equal(JSON.stringify(rows),before);assert.equal(ss.sheets.size,oldSheets);assert.equal(rawWrites,0);
});

console.log('PASS '+count+' ONU-only GAS correction tests (snapshot, CAS, allowlist, idempotency, overlay, rollback, no receipt/outbox/source writes)');
