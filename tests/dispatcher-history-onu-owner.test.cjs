'use strict';
const fileSystem=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const base=path.join(__dirname,'dispatcher-onu-correction-gas.test.js');
const helper=fileSystem.readFileSync(path.join(__dirname,'helpers/onu-owner-v20.gs'),'utf8');
const history=fileSystem.readFileSync(path.join(__dirname,'../gas/dispatcher-report/HistoryOnuOwner.gs'),'utf8');
const backend=fileSystem.readFileSync(path.join(__dirname,'../gas/dispatcher-report/DispatcherReport.gs'),'utf8');
const suffix=String.raw`
context.console.log=()=>{};context.Utilities.getUuid=()=>crypto.randomUUID();
Sheet.prototype.getDataRange=function(){return this.getRange(1,1,Math.max(1,this.values.length),Math.max(1,...this.values.map(r=>r.length)));};
Sheet.prototype.getLastColumn=function(){return Math.max(1,...this.values.map(r=>r.length));};
const range=Sheet.prototype.getRange;Sheet.prototype.getRange=function(...args){const r=range.apply(this,args);r.getDisplayValues=()=>r.getValues().map(line=>line.map(String));return r;};
const props=context.PropertiesService.getScriptProperties;
context.PropertiesService.getScriptProperties=()=>({...props(),getProperties:()=>Object.fromEntries(properties)});
let timers=[],timerDenied=false,renderCount=0;
context.ScriptApp={getProjectTriggers:()=>{if(timerDenied)throw Error('TIMER_PERMISSION_REQUIRED');return timers;},deleteTrigger:t=>{timers=timers.filter(x=>x!==t);},newTrigger:handler=>({timeBased(){return this;},everyMinutes(n){assert.equal(n,1);return this;},create(){const t={getHandlerFunction:()=>handler,getUniqueId:()=> 'test-trigger-uid'};timers.push(t);return t;}})};
const primary=new Spreadsheet();context.SpreadsheetApp.openById=id=>{assert.equal(id,'1fc_yXm7XihQn7medg8H25a9cxBn_HIqMhXx-rZyVD5M');return primary;};
properties.set('REPORT_SPREADSHEET_ID','1auELr1O8ThLimp9kU5xoD7v6VQHf1knOMTOlAjCHVpA');
vm.runInContext(helper,context);
const plan={schema:1,entries:[],skipped:[{ticket_id:'unknown',reason:'UNKNOWN_TYPE'}]};
function buildFixture(historyCount=19,priorCorrectionCount=1){
 reset();timers=[];timerDenied=false;renderCount=0;
 for(const k of [...properties.keys()])if(k.startsWith('ONU'))properties.delete(k);
 primary.sheets.clear();const sh=primary.insertSheet('Заявки');sh.values=[['id','date','time','content','sum','tags','нотатки_майстра','']];
 rows=[];plan.entries=[];
 for(let i=0;i<historyCount;i++){
   const r=dto('history-'+i);r.work_date='2026-'+String(2+i%7).padStart(2,'0')+'-15';r.source_hash=context.reportHash_(r);rows.push(r);
   const c=[r.ticket_id,r.work_date,r.work_time,'Підключення','800','[]','',JSON.stringify({type:'Підключення',equipment:[]})];sh.values.push(c);
   plan.entries.push({ticket_id:r.ticket_id,date:r.work_date,time:r.work_time,source_digest:context.ONU20_hash_([c[0],c[1],c[2],c[3],c[4],c[5],c[7]]),evidence_digest:context.ONU20_hash_(context.reportOnuCorrectionEvidence_(r)),target:{work_type:'Підключення',work_category:'connection',onu_used:1}});
 }
 for(let i=0;i<28;i++){const r=dto('sep-'+i);Object.assign(r,{work_date:'2026-09-15',work_type:i<20?'Підключення':'Ремонт',work_category:i<20?'connection':'repair',onu_used:1,total:i===0?46115:0,amount:i===0?46115:0,payment_cash:i===0?46115:0});r.source_hash=context.reportHash_(r);rows.push(r);}
 const protectedOctoberConnections=['9a61c8b5-f8c8-4f0a-9446-d8e7cbfadf21','f22710e7-1142-49f5-a2b1-7f4a6e54fe94','a65dd9a4-fefb-4381-be39-8b1b0ed8d793','ac5bb18a-cd71-4e9e-97d9-bdf57353d921','2edc4344-42ed-44d8-9e10-384126505bcf','8b933540-b8e2-4493-8020-75754fb5ebec'];
 for(let i=0;i<12;i++){const r=dto(i<6?protectedOctoberConnections[i]:'oct-'+i);Object.assign(r,{work_date:'2026-10-15',work_type:i<7?'Підключення':'Ремонт',work_category:i<7?'connection':'repair',onu_used:1,total:i===0?20186:0,amount:i===0?20186:0,payment_cash:i===0?20186:0});r.source_hash=context.reportHash_(r);rows.push(r);}
 context.ONU_HISTORY_PLAN=plan;vm.runInContext(backend,context);vm.runInContext(history,context);
 context.reportStore_=()=>({ss,sheet:{},rows:structuredClone(rows)});
 context.reportRender_=(sheet,rs)=>{renderCount++;if(failRender){failRender=false;throw Error('RENDER_INTERRUPTED');}actualRender(sheet,rs);};
 // Existing original correction is retained byte-for-byte.
 const old=dto('1774458317612');old.work_date='2026-04-01';old.source_hash=context.reportHash_(old);rows.push(old);apply(old.ticket_id,'onu20-owner-prior');renderCount=0;
 if(priorCorrectionCount>1){
   const planned=new Set(plan.entries.map(e=>e.ticket_id));
   const previous=Object.entries(context.REPORT_ONU_CORRECTION_TARGETS).filter(([id])=>!planned.has(id)&&id!==old.ticket_id);
   assert(previous.length>=priorCorrectionCount-1,'not enough prior correction targets in synthetic fixture');
   const ledger=ss.getSheetByName('_DispatcherOnuCorrections');
   for(const [i,[id,target]] of previous.slice(0,priorCorrectionCount-1).entries()){
     const liveRow=rows.find(r=>r.ticket_id===id);
     const before=liveRow?{work_type:liveRow.work_type,work_category:liveRow.work_category,onu_used:liveRow.onu_used,
       onu_replacement:liveRow.onu_replacement,total:liveRow.total,source_evidence:context.reportOnuCorrectionEvidence_(liveRow)}:{source_evidence:{synthetic:true}};
     const event={request_id:'synthetic-prior-'+i,request_hash:'a'.repeat(64),operation:'APPLY',ticket_id:id,
       source_version:1,source_hash:'b'.repeat(64),before_json:JSON.stringify(before),after_json:JSON.stringify(target),
       target_request_id:'',result_json:'{}',created_at:'2026-10-16T00:00:00.000Z'};
     ledger.values.push(context.REPORT_ONU_CORRECTION_HEADERS.map(k=>event[k]===undefined?'':event[k]));
   }
 }
}
function runAll(){let result=context.ONU_History_Start();assert.equal(result.ok,true,JSON.stringify(result));while(result.remaining){result=context.ONU_History_Continue();assert.equal(result.ok,true,JSON.stringify(result));}return result;}
let checks=0;
buildFixture(102,31);const before=JSON.stringify(rows),ledger=ss.getSheetByName('_DispatcherOnuCorrections'),oldJournal=JSON.stringify(ledger.values[1]),previousJournal=JSON.stringify(ledger.values.slice(1));
let final=runAll();assert.equal(final.phase,'DONE');assert.equal(renderCount,13,'102 overlays use thirteen bounded renders');assert.equal(timers.length,0);assert.equal(rawWrites,0);assert.equal(JSON.stringify(rows),before);assert.equal(ss.getSheetByName('_DispatcherReceipts'),null);assert.equal(JSON.stringify(ledger.values.slice(1,32)),previousJournal);assert.equal(ledger.getLastRow(),134,'31 existing plus 102 new APPLY rows');assert.equal(context.ONU_History_VerifyReadOnly().applied,102);assert.equal(context.ONU_History_VerifyReadOnly().unresolved.length,1);assert.equal(context.ONU_History_Start().code,'ALREADY_FINISHED');checks++;
// 800 -> 900 and split payment after correction must remain live on rollback.
Object.assign(rows[0],{total:900,amount:900,payment_cash:400,payment_cashless:500});rows[0].source_hash=context.reportHash_(rows[0]);
let rollback=context.ONU_History_Rollback();assert.equal(rollback.ok,true,JSON.stringify(rollback));while(rollback.remaining){rollback=context.ONU_History_Continue();assert.equal(rollback.ok,true,JSON.stringify(rollback));}
assert.equal(rollback.phase,'ROLLED_BACK');assert.equal(rows[0].total,900);assert.equal(rows[0].payment_cash,400);assert.equal(rows[0].payment_cashless,500);assert.equal(JSON.stringify(ss.getSheetByName('_DispatcherOnuCorrections').values[1]),oldJournal);checks++;
buildFixture();timerDenied=true;assert.equal(context.ONU_History_Start().ok,false);assert.equal(ss.getSheetByName('_DispatcherOnuCorrections').getLastRow(),2);checks++;
buildFixture();primary.getSheetByName('Заявки').values[1][7]='{}';assert.equal(context.ONU_History_Start().code,'PRIMARY_SOURCE_CHANGED_STOP');assert.equal(ss.getSheetByName('_DispatcherOnuCorrections').getLastRow(),2);checks++;
buildFixture();failRender=true;let failure=context.ONU_History_Start();assert.equal(failure.ok,false);assert.equal(timers.length,0);assert.equal(context.ONU_History_Continue().code,'NO_AUTOMATIC_WORK');const n=ss.getSheetByName('_DispatcherOnuCorrections').getLastRow();let resumed=context.ONU_History_Resume();assert.equal(resumed.ok,true,JSON.stringify(resumed));assert.equal(ss.getSheetByName('_DispatcherOnuCorrections').getLastRow(),n+8);checks++;
buildFixture();context.ONU_History_Start();rows[8].onu_used=1;rows[8].source_hash=context.reportHash_(rows[8]);assert.equal(context.ONU_History_Continue().ok,false);assert.equal(timers.length,0);checks++;
buildFixture();rows.find(r=>r.ticket_id==='ac5bb18a-cd71-4e9e-97d9-bdf57353d921').onu_used=0;assert.equal(context.ONU_History_Start().code,'SEPTEMBER_OCTOBER_GUARD');assert.equal(ss.getSheetByName('_DispatcherOnuCorrections').getLastRow(),2);checks++;
// Four lawful October tickets arrived after package preparation. Their live
// totals and one additional repair ONU must not trip the fixed-old-total guard.
buildFixture();
for(const [i,total] of [0,400,350,800].entries()){
  const r=dto('new-oct-'+i);Object.assign(r,{work_date:'2026-10-16',work_time:'12:0'+i,
    work_type:i===0?'Ремонт':'Інше',work_category:i===0?'repair':'other',onu_used:i===0?1:0,
    total,amount:total,payment_cash:total,payment_cashless:0});r.source_hash=context.reportHash_(r);rows.push(r);
}
actualRender(ss,rows); // model the live report having rendered today's four accepted tickets
const preflight=context.ONU_History_VerifyReadOnly();assert.equal(preflight.ok,true,JSON.stringify(preflight));assert.equal(preflight.protected_month_guard,'PASS');assert.equal(preflight.previous_corrections_guard,'PASS');assert.equal(preflight.pending,false);
const added=runAll();assert.equal(added.phase,'DONE');
const octAfter=context.MTDispatcherReportCore.render(context.reportOnuCorrectionEffectiveRows_(ss,rows.filter(r=>r.work_date.startsWith('2026-10-')))).monthly['2026-10'];
assert.equal(octAfter.onu_connection,7);assert.equal(octAfter.onu_repair,6);assert.equal(octAfter.total,21736);assert.equal(rows.filter(r=>r.ticket_id.startsWith('new-oct-')).length,4);checks++;
buildFixture();const rec=ss.insertSheet('_DispatcherReceipts');rec.values=[['request_key','request_hash','result_json','evidence_json','state','created_at'],['pending','','','','PREPARED','']];assert.equal(context.ONU_History_Start().code,'REPORT_COMMIT_UNRESOLVED');checks++;
buildFixture();const real=context.reportOnuCorrectionExecute_;let interrupted=false;
context.reportOnuCorrectionExecute_=function(...args){const result=real(...args);if(!interrupted){interrupted=true;throw Error('JOURNAL_RESPONSE_INTERRUPTED');}return result;};
assert.equal(context.ONU_History_Start().ok,false);assert.equal(ss.getSheetByName('_DispatcherOnuCorrections').getLastRow(),3);assert.equal(context.ONU_History_Resume().ok,true);assert.equal(ss.getSheetByName('_DispatcherOnuCorrections').getLastRow(),10,'replay one + seven fresh; no duplicate append');checks++;
buildFixture();context.ONU_History_Start();primary.getSheetByName('Заявки').values[1][3]='changed';const beforeVerify=JSON.stringify([...properties]);assert.equal(context.ONU_History_VerifyReadOnly().ok,false);assert.equal(JSON.stringify([...properties]),beforeVerify);assert.equal(timers.length,1,'read-only failure does not stop timer');checks++;
buildFixture();context.ONU_History_Start();const activeUser=context.Session.getActiveUser;context.Session.getActiveUser=()=>({getEmail:()=>''});context.Session.getEffectiveUser=()=>({getEmail:()=> 'owner@example.test'});
assert.equal(context.ONU_History_Continue().code,'UNAUTHORIZED');assert.equal(timers.length,1,'unauthorized caller cannot cancel job');assert.equal(context.ONU_History_Continue_({triggerUid:'test-trigger-uid'}).ok,true,'owner installable timer works without active browser session');context.Session.getActiveUser=activeUser;checks++;
buildFixture();properties.set('REPORT_ALLOWED_EMAIL','different@example.test');context.Session.getActiveUser=()=>({getEmail:()=> 'owner@example.test'});assert.equal(context.ONU_History_Start().code,'UNAUTHORIZED');assert.equal(ss.getSheetByName('_DispatcherOnuCorrections').getLastRow(),2);checks++;
console.log('PASS '+checks+' history batch owner scenarios: bounded render, automatic stop, timer auth, readback, rollback, money, CAS, durable replay, protected months.');
`;
new Function('require','helper','history','backend',fileSystem.readFileSync(base,'utf8')+'\n'+suffix)(createRequire(base),helper,history,backend);
