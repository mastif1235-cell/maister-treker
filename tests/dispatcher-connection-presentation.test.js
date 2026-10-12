'use strict';
// Offline synthetic fixtures only; no browser profile, queue or live GAS.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const core=require('../js/dispatcher-report-core.js');
const hash=d=>crypto.createHash('sha256').update(core.content(d)).digest('hex');
const card=d=>core.render([d]).layout.rows.find(b=>b.kind==='ticket').text.replace(/[\u00a0\u202f]/g,'');
const ordered=(s,parts)=>{let previous=-1;for(const p of parts){const at=s.indexOf(p);assert(at>previous,'missing/order: '+p);previous=at;}};
(async()=>{
  const {buildDTO}=await import('../js/dispatcher-report-projection.mjs');
  const ticket={id:'connection-structure',date:'12.10.2026',time:'12:34',type:'Підключення',contractNumber:'123456',baseCallFee:999,callFee:500,tariff:300,city:'Тестове',address:'Тестова 4',connectMasters:['Майстер'],equipment:[{label:'ONU',price:1700},{label:'Роутер',price:2300}],cables:[],payment:'Готівка',sum:4800,note:'Публічне примітка',masterNote:'PRIVATE-CANARY',phone:'',login:'LOGIN-CANARY',password:'PASSWORD-CANARY'};
  const before=JSON.stringify(ticket),d=await buildDTO(ticket,core,100);
  assert.equal(JSON.stringify(ticket),before);
  assert.equal(d.contract_number,'123456');assert.equal(d.service_fee,500);assert.equal(d.tariff_amount,300);
  assert.equal(d.dispatcher_comment,ticket.note);assert(!d.dispatcher_comment.includes('Тариф'));
  assert.equal(d.total,4800);assert.equal(d.payment_cash,4800);assert.equal(d.payment_cashless,0);
  const text=card(d);
  assert(!text.includes('🏙'));assert.equal(text.split('Тестове').length-1,1,'city appears only once in full address');
  assert(card({...d,address_display:''}).includes('🏙 Тестове'),'city-only fallback');
  assert(!card({...d,address_display:'',city:''}).includes('🏙'),'empty city fallback omitted');
  ordered(text,['Наряд №1','Договір №123456','📍','Напарник:','Матеріали:','Підключення — 500 грн','Тариф — 300 грн','Оплата:','Разом: 4800 грн','📝 Диспетчеру:']);
  assert(!text.includes('🔢 MAC:'),'absent MAC omitted');
  const mac='AA:BB:CC:DD:EE:FF';
  for(const type of ['Підключення','Ремонт']){
    const value=await buildDTO({...ticket,type,macAddress:mac},core,100),s=card(value);
    ordered(s,['Наряд №1','Договір №123456','📍','🔢 MAC: '+mac,'Напарник:','Матеріали:',type==='Ремонт'?'Виклик — 500':'Підключення — 500','Тариф — 300','Оплата:','Разом:','Диспетчеру:']);
    assert.equal(s.split('🔢 MAC:').length-1,1);assert(s.endsWith(ticket.note));assert(!s.includes('🏙'));
    assert(card({...value,address_display:''}).includes('🏙 Тестове'));
    if(type==='Ремонт')assert(!s.includes('Підключення —'));
  }
  const hostileOther=card({...d,work_type:'Інше',mac_onu:mac});
  assert(hostileOther.endsWith(ticket.note));
  for(const label of ['MAC:','Договір','Тариф','Оплата','Разом','Матеріали:'])assert(!hostileOther.includes(label));
  assert(text.endsWith(ticket.note),'dispatcher comment is always final');
  for(const type of ['Підключення','Ремонт']){
    const value=await buildDTO({...ticket,type},core,100),s=card(value);
    assert(s.endsWith(ticket.note));ordered(s,['Матеріали:',type==='Ремонт'?'Виклик — 500':'Підключення — 500','Тариф — 300','Оплата:','Разом:','Диспетчеру:']);
    if(type==='Ремонт')assert(!s.includes('Підключення —'));
  }
  for(const [patch,label] of [[{contractNumber:''},'Договір'],[{tariff:0},'Тариф —'],[{callFee:0},'Підключення —'],[{callFee:undefined},'Підключення —'],[{equipment:[],cables:[]},'Матеріали:'],[{note:''},'Диспетчеру:'],[{sum:0},'Разом:']]){
    const value=await buildDTO({...ticket,...patch},core,100);assert(!card(value).includes(label),'omit '+label);
  }
  assert(!('service_fee' in await buildDTO({...ticket,callFee:undefined,baseCallFee:500},core,100)),'never substitute baseCallFee');
  const other=await buildDTO({...ticket,type:'Інше',sum:0,otherNote:'Нотатка'},core,100);
  for(const field of ['contract_number','service_fee','tariff_amount'])assert(!(field in other));
  for(const word of ['Договір','Матеріали','Тариф','Оплата','Разом','Підключення —'])assert(!card(other).includes(word));
  const raw=await buildDTO({...ticket,tariff:undefined,callFee:undefined,contractNumber:undefined,cloudImported:true,content:'💎 Тариф: 300 грн\n📝 Публічна нотатка',note:undefined},core,100);
  assert.equal(raw.dispatcher_comment,'Публічна нотатка');assert.equal(raw.tariff_amount,300,'preserve exact app-labelled historical tariff, never free-text guessing');
  for(const s of ['PRIVATE-CANARY','PHONE-CANARY','LOGIN-CANARY','PASSWORD-CANARY'])assert(!JSON.stringify(d).includes(s));
  for(const bad of ['=SUM(1,2)','secret: hidden','123\nphone: 123','https://private.invalid','x'.repeat(81)])await assert.rejects(buildDTO({...ticket,contractNumber:bad},core,100));
  for(const field of ['service_fee','tariff_amount'])for(const bad of [-1,Infinity,NaN,'500',null,1e9+1,0])assert.throws(()=>core.validate({...d,[field]:bad}));
  for(const field of ['contract_number','service_fee','tariff_amount']){
    const changed={...d,[field]:field==='contract_number'?'654321':501};assert.notEqual(hash(changed),d.source_hash,'optional field hash-bound: '+field);
  }
  // Freeze the exact previous canonical whitelist, including materials_json.
  const oldFields=[...core.FIELDS,'materials_json'],old={...d};
  for(const field of ['contract_number','service_fee','tariff_amount'])delete old[field];
  const oldContent={};for(const field of oldFields)if(!['source_version','source_hash','updated_at'].includes(field)&&old[field]!==undefined)oldContent[field]=old[field];
  old.source_hash=crypto.createHash('sha256').update(JSON.stringify(oldContent)).digest('hex');
  assert.equal(hash(old),old.source_hash);assert.deepEqual(core.validate(old),old);assert(card(old).includes('Разом: 4800'));
  const baseHeaders=[...core.FIELDS,'deleted_at','sync_status'];
  for(const optionalHeaders of [[],['materials_json'],['materials_json','contract_number'],['materials_json','contract_number','service_fee','tariff_amount']]){
    const headers=[...baseHeaders,...optionalHeaders],value={...old,deleted_at:'',sync_status:'SYNCED'};
    if(!optionalHeaders.length){delete value.materials_json;value.source_hash=hash(value);}
    const cells=[headers.slice(),headers.map(k=>value[k]??'')],snapshot=JSON.stringify(cells[1]);
    let writes=0,maxColumns=headers.length;
    const sheet={getLastRow:()=>cells.length,getMaxRows:()=>100,getMaxColumns:()=>maxColumns,insertColumnsAfter:(_,n)=>{maxColumns+=n;},getRange:(r,c,h=1,w=1)=>({getValues:()=>Array.from({length:h},(_,y)=>Array.from({length:w},(_,x)=>cells[r-1+y]?.[c-1+x]??'')),setNumberFormat(){return this;},setValues:values=>{writes++;values.forEach((row,y)=>row.forEach((v,x)=>{cells[r-1+y]??=[];cells[r-1+y][c-1+x]=v;}));}})};
    const gas={MTDispatcherReportCore:core,SpreadsheetApp:{openById:()=>({getSheetByName:n=>n==='_DispatcherData'?sheet:n==='Отчет'?{}:null})},Utilities:{DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()]}};
    vm.createContext(gas);vm.runInContext(fs.readFileSync('gas/dispatcher-report/DispatcherReport.gs','utf8'),gas);
    const loaded=gas.reportStore_({id:'synthetic'}).rows[0];assert.equal(writes,0);assert.equal(loaded.source_hash,value.source_hash);assert.equal(hash(loaded),value.source_hash);
    gas.reportExtendHeaders_(sheet);assert.equal(JSON.stringify(cells[1]),snapshot,'migration does not rewrite historical rows');
    assert.deepEqual(cells[0],[...baseHeaders,'materials_json','contract_number','service_fee','tariff_amount','client_name','client_phone']);
    assert.equal(gas.reportStore_({id:'synthetic'}).rows[0].source_hash,value.source_hash,'blank optional cells omitted, old hash unchanged');
    const store=gas.reportStore_({id:'synthetic'});store.rows.push({...d,ticket_id:'new-structured',client_name:'Тестовий Тест',client_phone:'+380000000001',deleted_at:'',sync_status:'SYNCED'});
    store.rows[1].source_hash=hash(store.rows[1]);gas.reportWrite_(store);
    const reloaded=gas.reportStore_({id:'synthetic'}).rows[1];
    for(const field of ['contract_number','service_fee','tariff_amount','client_name','client_phone','source_hash'])assert.equal(reloaded[field],store.rows[1][field],'actual GAS write/read: '+field);
    assert(card(reloaded).endsWith(ticket.note));
    cells[2][32]=301;assert.throws(()=>gas.reportStore_({id:'synthetic'}),/HASH_MISMATCH/,'new storage fields are hash-bound');cells[2][32]=300;
    cells[2][34]='+380000000002';assert.throws(()=>gas.reportStore_({id:'synthetic'}),/HASH_MISMATCH/,'stored contact is hash-bound');cells[2][34]='+380000000001';
    cells[0][baseHeaders.length+1]='unrelated';assert.throws(()=>gas.reportStoredHeaders_(sheet),/REPORT_SCHEMA_CONFLICT/);
  }
  const bundled={console,SpreadsheetApp:{}};vm.createContext(bundled);vm.runInContext(require('../scripts/build-dispatcher-report.cjs').bundle(),bundled);
  const bundleCard=bundled.MTDispatcherReportCore.render([d]).layout.rows.find(r=>r.kind==='ticket').text;
  assert.equal(bundleCard,core.render([d]).layout.rows.find(r=>r.kind==='ticket').text,'deployable bundle uses the same structured card');
  const beforeStats=core.stats([old]);assert.deepEqual(core.stats([d]),beforeStats,'display breakdown never changes aggregates');
  console.log('PASS connection A-K: structured fee/contract/tariff, comment final, omission, no double count, privacy, old hashes and append-only migration');
})().catch(e=>{console.error(e);process.exitCode=1;});
