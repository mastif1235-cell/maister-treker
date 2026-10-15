'use strict';
// Reuse the existing GAS sandbox and real core/handler. No external traffic.
const fileSystem=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const base=path.join(__dirname,'dispatcher-onu-correction-gas.test.js');
const ownerHelper=fileSystem.readFileSync(path.join(__dirname,'helpers','onu-owner-v20.gs'),'utf8');
const septemberHelper=fileSystem.readFileSync(path.join(__dirname,'..','gas','dispatcher-report','SeptemberOnuOwner.gs'),'utf8');
const suffix=String.raw`
const output=[];context.console.log=s=>output.push(s);context.Utilities.getUuid=()=>crypto.randomUUID();
Sheet.prototype.getDataRange=function(){return this.getRange(1,1,Math.max(1,this.values.length),Math.max(1,...this.values.map(r=>r.length)));};
const oldRange=Sheet.prototype.getRange;Sheet.prototype.getRange=function(...args){const r=oldRange.apply(this,args);r.getDisplayValues=()=>r.getValues().map(line=>line.map(String));return r;};
Sheet.prototype.getLastColumn=function(){return Math.max(1,...this.values.map(r=>r.length));};
vm.runInContext(ownerHelper,context);vm.runInContext(septemberHelper,context);
const primary=new Spreadsheet();context.SpreadsheetApp.openById=id=>{assert.equal(id,'1fc_yXm7XihQn7medg8H25a9cxBn_HIqMhXx-rZyVD5M');return primary;};
properties.set('REPORT_SPREADSHEET_ID','1auELr1O8ThLimp9kU5xoD7v6VQHf1knOMTOlAjCHVpA');
const ids=context.ONUSeptemberIds_();
function fixture(){
 reset();for(const k of [...properties.keys()])if(k.startsWith('ONU20-')||k.startsWith('ONU-SEP26-'))properties.delete(k);
 primary.sheets.clear();const sheet=primary.insertSheet('Заявки');sheet.values=[['id','date','time','content','sum','tags','нотатки_майстра','']];
 rows=ids.map(id=>{const r=dto(id);r.work_date='2026-09-15';r.source_hash=context.reportHash_(r);sheet.values.push([id,'2026-09-15','12:30','Підключення',800,'[]','',JSON.stringify({type:'Підключення',equipment:[{id:'onu',label:'ONU',checked:false}]})]);return r;});
 for(let i=0;i<8;i++){const r=dto('sep-repair-'+i);Object.assign(r,{work_date:'2026-09-15',work_type:'Ремонт',work_category:'repair',onu_used:1,onu_replacement:1,total:i===0?30115:0,amount:i===0?30115:0,payment_cash:i===0?30115:0});r.source_hash=context.reportHash_(r);rows.push(r);}
 for(let i=0;i<12;i++){const r=dto('oct-existing-'+i);Object.assign(r,{work_type:i<7?'Підключення':'Ремонт',work_category:i<7?'connection':'repair',onu_used:1,total:i<7?800:i===7?14586:0,amount:i<7?800:i===7?14586:0,payment_cash:i<7?800:i===7?14586:0});r.source_hash=context.reportHash_(r);rows.push(r);}
}
let tests=0;
fixture();const raw=JSON.stringify(rows);
// A pre-existing correction from the first 11 is never replayed or removed.
const originalId='1774458317612';const unrelated=dto(originalId);unrelated.work_date='2026-04-01';unrelated.source_hash=context.reportHash_(unrelated);rows.push(unrelated);apply(originalId,'onu20-owner-existing-original');const untouched=JSON.stringify(ss.getSheetByName('_DispatcherOnuCorrections').values[1]);
const originalRows=JSON.stringify(rows);
for(let i=0;i<20;i++){const r=context.ONU_September_ApplyNext();assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.ticket_id,ids[i]);assert.equal(r.visible.months['2026-09'].onu_connection,i+1);assert.equal(r.visible.months['2026-09'].onu_repair,8);assert.equal(r.visible.months['2026-09'].total,46115);assert.equal(r.visible.months['2026-10'].onu_connection,7);assert.equal(r.visible.months['2026-10'].onu_repair,5);assert.equal(r.visible.months['2026-10'].total,20186);assert.equal(JSON.stringify(rows),originalRows);}
assert.equal(context.ONU_September_ApplyNext().code,'ALL_SEPTEMBER_APPLIED');assert.equal(context.ONU_September_VerifyReadOnly().applied,20);assert.equal(JSON.stringify(ss.getSheetByName('_DispatcherOnuCorrections').values[1]),untouched);assert.equal(rawWrites,0);assert.equal(ss.getSheetByName('_DispatcherReceipts'),null);tests++;
// Simulate rate-window expiry between completed apply and a later rollback.
// Production limiter is unchanged; no cache clearing exists in the helper.
for(const key of [...cache.keys()])if(key.startsWith('REPORT_RATE_'))cache.delete(key);
for(let i=19;i>=0;i--){const r=context.ONU_September_RollbackLast();assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.ticket_id,ids[i]);}
assert.equal(context.ONU_September_RollbackLast().code,'NO_SEPTEMBER_CORRECTION_TO_ROLLBACK');assert.equal(JSON.stringify(ss.getSheetByName('_DispatcherOnuCorrections').values[1]),untouched);tests++;
for(const [ticket,expected] of [[{equipment:[{id:'onu',checked:false}]},1],[{equipment:[]},1],[{content:'У них своя ONU'},0],[{onuAccountingVersion:1,equipment:[{id:'onu',checked:false}]},0],[{onuAccountingVersion:1,equipment:[{id:'onu',checked:true}]},1]])assert.equal(context.ONUSeptemberClassify_(ticket).onu,expected);tests++;
fixture();const primarySheet=primary.getSheetByName('Заявки');primarySheet.values[1][7]=JSON.stringify({type:'Підключення',onuAccountingVersion:1,equipment:[]});assert.equal(context.ONU_September_ApplyNext().code,'SOURCE_POLICY_CHANGED_STOP');assert.equal(ss.getSheetByName('_DispatcherOnuCorrections'),null);tests++;
fixture();primary.getSheetByName('Заявки').values[1][3]='Поставили его ONU';assert.equal(context.ONU_September_ApplyNext().code,'SOURCE_POLICY_CHANGED_STOP');assert.equal(ss.getSheetByName('_DispatcherOnuCorrections'),null);tests++;
fixture();rows.shift();assert.equal(context.ONU_September_ApplyNext().code,'SEPTEMBER_ACTIVE_ROW_MISSING_OR_DUPLICATE');assert.equal(ss.getSheetByName('_DispatcherOnuCorrections'),null);tests++;
fixture();failRender=true;assert.equal(context.ONU_September_ApplyNext().ok,false);assert.equal(context.ONU_September_ApplyNext().code,'PENDING_OPERATION_STOP');assert.equal(context.ONU_September_ResumePending().ok,true);assert.equal(ss.getSheetByName('_DispatcherOnuCorrections').getLastRow(),2);tests++;
fixture();failRender=true;context.ONU_September_ApplyNext();primary.getSheetByName('Заявки').values[1][3]='changed canonical content';assert.equal(context.ONU_September_ResumePending().code,'PRIMARY_SOURCE_CHANGED_STOP');assert.equal(context.ONU_September_RollbackLast().ok,true);tests++;
fixture();context.ONU_September_ApplyNext();rows[0].onu_used=1;rows[0].source_hash=context.reportHash_(rows[0]);assert.equal(context.ONU_September_ApplyNext().code,'SEPTEMBER_CORRECTION_CONFLICT');tests++;
fixture();context.ONU_September_ApplyNext();rows[0].total=900;rows[0].amount=900;rows[0].payment_cash=400;rows[0].payment_cashless=500;rows[0].source_hash=context.reportHash_(rows[0]);assert.equal(context.ONU_September_RollbackLast().ok,true);assert.equal(rows[0].total,900);assert.equal(rows[0].payment_cash,400);assert.equal(rows[0].payment_cashless,500);tests++;
fixture();const receipt=ss.insertSheet('_DispatcherReceipts');receipt.values=[['request_key','request_hash','result_json','evidence_json','state','created_at'],['request:pending','','','','PREPARED','']];assert.equal(context.ONU_September_ApplyNext().code,'REPORT_COMMIT_UNRESOLVED');tests++;
assert(!output.join('\n').includes(secret));assert(!output.join('\n').includes('source_evidence'));
console.log('PASS '+tests+' September owner scenarios: 20 per-ID, 20+8/46115 and unchanged 7+5/20186 real mock cells; original corrections retained; rollback/retry/source guards/modern OFF.');
`;
new Function('require','ownerHelper','septemberHelper',fileSystem.readFileSync(base,'utf8')+'\n'+suffix)(createRequire(base),ownerHelper,septemberHelper);
