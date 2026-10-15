'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const secret='synthetic-dispatcher-secret-for-onu-correction-tests';
const properties=new Map([['REPORT_ALLOWED_EMAIL','owner@example.test'],['REPORT_SPREADSHEET_ID','test-report'],['REPORT_ALLOWED_ORIGINS','https://example.test'],['MT_DISPATCHER_HMAC_SECRET',secret]]),cache=new Map();
let rows=[],rendered=[],rawWrites=0,locked=false,seq=0,failRender=false;
class Sheet{
  constructor(name){this.name=name;this.values=[];this.hidden=false;}
  getLastRow(){return this.values.length;}
  getMaxRows(){return 100;}
  setRowHeights(){} setColumnWidth(){} setHiddenGridlines(){}
  insertRowsAfter(){}
  hideSheet(){this.hidden=true;}
  getRange(row,col,height=1,width=1){
    const sheet=this;return {
      getValues(){return Array.from({length:height},(_,dy)=>Array.from({length:width},(_,dx)=>sheet.values[row-1+dy]?.[col-1+dx]??''));},
      setValue(value){while(sheet.values.length<row)sheet.values.push([]);sheet.values[row-1][col-1]=value;return this;},
      setValues(values){values.forEach((line,dy)=>{const index=row-1+dy;while(sheet.values.length<=index)sheet.values.push([]);line.forEach((value,dx)=>{sheet.values[index][col-1+dx]=value;});});return this;},
      getMergedRanges(){return [];},breakApart(){return this;},clear(){sheet.values=[];return this;},
      setRichTextValues(values){return this.setValues(values.map(line=>line.map(rich=>rich.text)));},
      setNumberFormat(){return this;},setFontColor(){return this;},setWrap(){return this;},setVerticalAlignment(){return this;},setHorizontalAlignment(){return this;},setFontFamily(){return this;},setFontSize(){return this;},setBackgrounds(){return this;},setFontWeights(){return this;},setBackground(){return this;},setFontWeight(){return this;},setBorder(){return this;},merge(){return this;}
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
  SpreadsheetApp:{flush:()=>{},BorderStyle:{SOLID:1,SOLID_THICK:2},newTextStyle:()=>({setBold(){return this;},build(){return {};}}),newRichTextValue:()=>({text:'',setText(value){this.text=value;return this;},setTextStyle(){return this;},build(){return {text:this.text};}})},
  Utilities:{DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(_,value)=>Array.from(crypto.createHash('sha256').update(String(value)).digest()),
    computeHmacSha256Signature:(value,key)=>Array.from(crypto.createHmac('sha256',String(key)).update(String(value),'utf8').digest()),
    base64EncodeWebSafe:bytes=>Buffer.from(bytes).toString('base64').replace(/\+/g,'-').replace(/\//g,'_'),newBlob:value=>({getBytes:()=>Array.from(Buffer.from(String(value),'utf8'))})}};
vm.createContext(context);vm.runInContext(fs.readFileSync('js/dispatcher-report-core.js','utf8'),context);vm.runInContext(fs.readFileSync('gas/dispatcher-report/DispatcherReport.gs','utf8'),context);
const core=context.MTDispatcherReportCore,canonical=require('../js/sync-contract.js');
function dto(id='1774458317612',version=100){const d=Object.fromEntries(core.FIELDS.map(key=>[key,'']));Object.assign(d,{ticket_id:id,work_date:'2026-10-06',work_time:'12:30',work_type:'Підключення',work_category:'connection',amount:800,total:800,payment_type:'Готівка',onu_used:0,onu_replacement:0,router_used:0,payment_cash:800,payment_cashless:0,payment_free_amount:0,payment_free_count:0,updated_at:'2026-10-14T10:00:00.000Z',source_version:version});d.source_hash=context.reportHash_(d);return d;}
context.reportStore_=()=>({ss,sheet:{},rows:structuredClone(rows)});
context.reportWrite_=store=>{rows=structuredClone(store.rows);rawWrites++;};
const actualRender=context.reportRender_;
context.reportRender_=(spreadsheet,sourceRows)=>{if(failRender){failRender=false;throw Error('synthetic render failure');}actualRender(spreadsheet,sourceRows);rendered=context.reportOnuCorrectionEffectiveRows_(spreadsheet,sourceRows);};
function envelope(body,nonce){const env={v:3,method:'POST',action:body.action,entity:'system',id:'',ts:String(Date.now()),nonce:nonce||'n'+crypto.randomBytes(16).toString('hex'),requestId:body.request_id,body:JSON.stringify(body)};env.sig=crypto.createHmac('sha256',secret).update(canonical.canonical(env),'utf8').digest('base64url');return env;}
function direct(action,fields={},requestId){const body={action,...fields,request_id:requestId||'onu-test-'+(++seq)};return context.doPost({postData:{contents:JSON.stringify(envelope(body))}});}
function reset(){rows=[dto()];rendered=[];rawWrites=0;locked=false;seq=0;failRender=false;cache.clear();ss.sheets.clear();ss.insertSheet('Отчет');}
function apply(id=rows[0].ticket_id,requestId='onu-apply-test'){const p=direct('report_onu_correction_preview',{ticket_id:id}).items[0];const fields={ticket_id:id,expected:{source_version:p.source_version,source_hash:p.source_hash,before:p.before}};return {fields,result:direct('report_onu_correction_apply',fields,requestId)};}
function reportText(){return ss.getSheetByName('Отчет').values.flat().filter(v=>typeof v==='string').join('\n').replace(/[\u00a0\u202f]/g,' ');}
function later(changes,rebuild=true){const ticket={...rows[0],...changes,source_version:rows[0].source_version+1,updated_at:'2026-10-15T11:00:00.000Z'};ticket.source_hash=context.reportHash_(ticket);return direct('report_upsert',{ticket,rebuild},'later-upsert-'+(++seq));}
let count=0;
function test(name,fn){reset();fn();count++;}

test('read-only preview exposes only the five confirmed repair IDs and preserves raw rows',()=>{
  const before=JSON.stringify(rows),result=direct('report_onu_correction_preview');
  assert.equal(result.ok,true);assert.equal(result.items.length,5);assert.deepEqual(result.items.map(x=>x.ticket_id),['1774458317612','1774458317619','1783937356212','1783937356227','1783937356219']);
  assert.equal(result.items[0].state,'READY');assert.equal(result.items[0].before.work_category,'connection');assert.equal(result.items[0].after.work_category,'repair');assert.equal(result.items[0].after.onu_used,1);assert.equal(result.items[0].total_before,800);assert.equal(result.items[0].total_after,800);
  assert.equal(JSON.stringify(rows),before);assert.equal(ss.sheets.size,1);assert.equal(rawWrites,0);assert.equal(rendered.length,0);
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
  const newer={...rows[0],contract_number:'synthetic-contract',source_version:rows[0].source_version+1,updated_at:'2026-10-14T11:00:00.000Z'};newer.source_hash=context.reportHash_(newer);
  const upsert=direct('report_upsert',{ticket:newer,rebuild:false},'normal-newer-upsert').items[0];assert.equal(upsert.code,'OK');assert.equal(upsert.status,'synced');
  const active=context.reportOnuCorrectionEffectiveRows_(ss,rows);assert.equal(active[0].onu_used,1);assert.equal(active[0].work_category,'repair');assert.equal(active[0].total,800);
  const rollback=direct('report_onu_correction_rollback',{ticket_id:rows[0].ticket_id,correction_id:'onu-apply-sync-guard'},'onu-rollback-guard');
  assert.equal(rollback.code,'ROLLED_BACK');assert.equal(ss.getSheetByName('_DispatcherOnuCorrections').getLastRow(),3);
  const restored=context.reportOnuCorrectionEffectiveRows_(ss,rows);assert.equal(restored[0].onu_used,0);assert.equal(restored[0].work_category,'connection');assert.equal(restored[0].total,800);
});

test('actual GAS report preserves 800→900 money and payment updates, even with legacy extra snapshot fields',()=>{
  Object.assign(rows[0],{materials_json:core.materialJSON([{label:'Роутер',quantity:1,unit:'шт.',unit_price:800}]),materials_display:'Роутер — 1 шт. — 800 грн'});rows[0].source_hash=context.reportHash_(rows[0]);
  const {fields,result}=apply();assert.equal(result.code,'APPLIED');
  // Simulate the old candidate journal shape: extra fields must never overlay.
  const ledger=ss.getSheetByName('_DispatcherOnuCorrections'),afterIndex=context.REPORT_ONU_CORRECTION_HEADERS.indexOf('after_json');
  ledger.values[1][afterIndex]=JSON.stringify({...JSON.parse(ledger.values[1][afterIndex]),total:800,payment_cash:800,payment_cashless:0,onu_replacement:99,materials_json:'[]'});
  const response=later({amount:900,total:900,payment_cash:400,payment_cashless:500,payment_type:'Змішана',tariff_amount:100,service_fee:200,materials_json:core.materialJSON([{label:'Роутер',quantity:1,unit:'шт.',unit_price:900}]),materials_display:'Роутер — 1 шт. — 900 грн'});assert.equal(response.items[0].code,'OK');
  assert.equal(rendered[0].total,900);assert.equal(rendered[0].payment_cash,400);assert.equal(rendered[0].payment_cashless,500);assert.equal(rendered[0].onu_replacement,0);
  const actual=reportText();assert(actual.includes('Разом: 900 грн'));assert(!actual.includes('Разом: 800 грн'));assert(actual.includes('Роутер — 1 шт. — 900 грн'));assert.equal(rendered[0].tariff_amount,100);assert.equal(rendered[0].service_fee,200);
  for(const kind of ['daily','weekly','monthly']){
    const layout=core.render(rendered).layout,spans=layout.spans.filter(x=>x.kind===kind);assert(spans.length);
    for(const span of spans){const value=ss.getSheetByName('Отчет').values[span.row-1][span.column-1].replace(/[\u00a0\u202f]/g,' ');assert(value.includes('Загальна сума: 900 грн'));assert(value.includes('Готівка: 400 грн'));assert(value.includes('Безготівка: 500 грн'));assert.equal((value.match(/^📦 ONU /gm)||[]).length,2);assert(!value.includes('Разом ONU'));assert(!value.includes('Заміна ONU'));}
  }
  const preview=direct('report_onu_correction_preview').items[0];assert.equal(preview.after.total,900);assert.equal(preview.state,'APPLIED');
  assert.equal(direct('report_onu_correction_apply',fields,'onu-apply-test').total,900,'cached ACK returns live money');
  cache.clear();assert.equal(direct('report_onu_correction_apply',fields,'onu-apply-test').total,900,'durable replay returns live money');
  assert.equal(direct('report_onu_correction_rollback',{ticket_id:rows[0].ticket_id,correction_id:'onu-apply-test'},'rollback-money').total,900);
  assert.equal(rendered[0].total,900);assert.equal(rendered[0].payment_cash,400);assert.equal(rendered[0].payment_cashless,500);assert.equal(rendered[0].onu_used,0);
});

test('subsequent work/ONU evidence changes conflict visibly; rollback keeps the newer source',()=>{
  for(const changes of [{onu_used:1},{onu_used:1,onu_replacement:1},{work_category:'repair',work_type:'Ремонт'},{materials_display:'ONU: 1 шт. × 800 грн'},{materials_json:'[{"label":"ONU","quantity":1,"unit":"шт."}]'},{dispatcher_comment:'new work evidence'},{work_date:'2026-10-07'}]){
    reset();const {fields}=apply();const previousReport=reportText();const response=later(changes);assert.equal(response.items[0].code,'OK','normal sync remains acknowledged');
    assert.equal(properties.get('REPORT_LAST_ERROR'),'ONU_CORRECTION_SOURCE_CONFLICT');assert.equal(reportText(),previousReport,'conflicting render stops before clearing visible sheet');
    const preview=direct('report_onu_correction_preview').items[0];assert.equal(preview.state,'CONFLICT');assert.equal(preview.code,'ONU_CORRECTION_SOURCE_CONFLICT');
    assert.equal(direct('report_onu_correction_apply',fields,'onu-apply-test').code,'ONU_CORRECTION_SOURCE_CONFLICT','cached success cannot hide conflict');
    cache.clear();assert.equal(direct('report_onu_correction_apply',fields,'onu-apply-test').code,'ONU_CORRECTION_SOURCE_CONFLICT');
    const source=structuredClone(rows[0]);assert.equal(direct('report_onu_correction_rollback',{ticket_id:source.ticket_id,correction_id:'onu-apply-test'},'rollback-conflict').code,'ROLLED_BACK');assert.deepEqual(rows[0],source);assert.deepEqual(JSON.parse(JSON.stringify(rendered[0])),source);assert.equal(direct('report_status').last_error,'','resolved conflicts do not leave a stale diagnostic error');
  }
});

test('partial render failure is recoverable by same request; rollback replay and superseded apply are safe',()=>{
  const p=direct('report_onu_correction_preview').items[0],fields={ticket_id:p.ticket_id,expected:{source_version:p.source_version,source_hash:p.source_hash,before:p.before}};
  failRender=true;assert.equal(direct('report_onu_correction_apply',fields,'partial-apply').code,'REPORT_INTERNAL_ERROR');
  assert.equal(ss.getSheetByName('_DispatcherOnuCorrections').getLastRow(),2);assert.equal(rawWrites,0);
  assert.equal(direct('report_onu_correction_apply',fields,'partial-apply').code,'APPLIED');assert.equal(ss.getSheetByName('_DispatcherOnuCorrections').getLastRow(),2);assert.equal(rendered[0].onu_used,1);
  const rollback={ticket_id:p.ticket_id,correction_id:'partial-apply'};failRender=true;assert.equal(direct('report_onu_correction_rollback',rollback,'partial-rollback').code,'REPORT_INTERNAL_ERROR');
  assert.equal(direct('report_onu_correction_rollback',rollback,'partial-rollback').code,'ROLLED_BACK');assert.equal(rendered[0].onu_used,0);assert.equal(ss.getSheetByName('_DispatcherOnuCorrections').getLastRow(),3);
  assert.equal(direct('report_onu_correction_apply',fields,'partial-apply').code,'ONU_CORRECTION_SUPERSEDED');
  assert.equal(apply(p.ticket_id,'new-confirmed-apply').result.code,'APPLIED');
  assert.equal(direct('report_onu_correction_rollback',rollback,'partial-rollback').code,'ONU_CORRECTION_SUPERSEDED','an old rollback ACK cannot hide a newer correction');
});

test('older snapshots without physical evidence fail closed and remain reversible',()=>{
  apply();const ledger=ss.getSheetByName('_DispatcherOnuCorrections'),index=context.REPORT_ONU_CORRECTION_HEADERS.indexOf('before_json'),before=JSON.parse(ledger.values[1][index]);delete before.source_evidence;ledger.values[1][index]=JSON.stringify(before);
  const previousReport=reportText();assert.equal(direct('report_onu_correction_preview').items[0].state,'CONFLICT');
  assert.throws(()=>context.reportRender_(ss,rows),/ONU_CORRECTION_SOURCE_CONFLICT/);assert.equal(reportText(),previousReport);
  assert.equal(direct('report_onu_correction_rollback',{ticket_id:rows[0].ticket_id,correction_id:'onu-apply-test'},'old-snapshot-rollback').code,'ROLLED_BACK');assert.equal(rendered[0].onu_used,0);
});

test('six October connection IDs have individual dry-run/apply preparation, including zero-price no-MAC work',()=>{
  const ids=['9a61c8b5-f8c8-4f0a-9446-d8e7cbfadf21','f22710e7-1142-49f5-a2b1-7f4a6e54fe94','a65dd9a4-fefb-4381-be39-8b1b0ed8d793','ac5bb18a-cd71-4e9e-97d9-bdf57353d921','2edc4344-42ed-44d8-9e10-384126505bcf','8b933540-b8e2-4493-8020-75754fb5ebec'];
  rows=ids.map(id=>dto(id));Object.assign(rows[3],{work_date:'2026-10-07',work_time:'16:24',amount:0,total:0,payment_cash:0,payment_free_count:1,mac_onu:''});rows[3].source_hash=context.reportHash_(rows[3]);
  rows.push({...dto('existing-october-connection'),onu_used:1},...Array.from({length:5},(_,i)=>({...dto('existing-october-repair-'+i),work_type:'Ремонт',work_category:'repair',onu_used:1,onu_replacement:1})));
  const before=structuredClone(rows);
  assert.equal(direct('report_onu_correction_preview').items.length,5,'phone repair flow stays compatible');
  ids.forEach((id,i)=>{const preview=direct('report_onu_correction_preview',{ticket_id:id});assert.equal(preview.items.length,1);assert.equal(preview.items[0].after.onu_used,1);assert.equal(apply(id,'october-apply-'+i).result.code,'APPLIED');});
  assert.deepEqual(rows,before);assert.equal(core.stats(rendered).onu_connection,7);assert.equal(core.stats(rendered).onu_repair,5);assert.equal(core.stats(rendered).total,8800);assert.equal(rendered[3].total,0);assert.equal(rendered[3].mac_onu,'');
  for(const id of ['1786990035908','1786951228806','cca10ba0-41a2-4571-ac3c-02b57e2a19bc','1774458317609'])assert.equal(direct('report_onu_correction_preview',{ticket_id:id}).code,'INVALID_ONU_CORRECTION');
});

test('unsigned mutation and bridge mutation remain denied',()=>{
  const before=JSON.stringify(rows),oldSheets=ss.sheets.size;
  assert.equal(context.doPost({postData:{contents:JSON.stringify({action:'report_onu_correction_apply',ticket_id:'1774458317612',request_id:'unsigned-01'})}}).code,'AUTH_FAILED');
  assert.equal(context.reportDispatch({action:'report_onu_correction_apply',ticket_id:'1774458317612',request_id:'bridge-01'}).code,'REPORT_DIRECT_TRANSPORT_REQUIRED');
  assert.equal(JSON.stringify(rows),before);assert.equal(ss.sheets.size,oldSheets);assert.equal(rawWrites,0);
});

console.log('PASS '+count+' ONU-only GAS correction tests (snapshot, CAS, allowlist, idempotency, overlay, rollback, no receipt/outbox/source writes)');
