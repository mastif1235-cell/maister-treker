'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {prepare}=require('../scripts/prepare-onu-history-package.cjs'),core=require('../js/dispatcher-report-core.js');
const csv=rows=>rows.map(r=>r.map(c=>'"'+String(c??'').replace(/"/g,'""')+'"').join(',')).join('\n');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'onu-plan-test-'));
 const cases=[
  ['legacy-off',{equipment:[{id:'onu',label:'ONU',checked:false}]},0,1],
  ['legacy-empty',{equipment:[]},0,1],
  ['modern-off',{onuAccountingVersion:1,equipment:[{id:'onu',label:'ONU',checked:false}]},1,0],
  ['modern-on',{onuAccountingVersion:1,equipment:[{id:'onu',label:'ONU',checked:true,price:0}]},0,1],
  ['customer',{note:'У них своя ONU'},1,0],
  ['1783937356209',{equipment:[]},1,0],
  ['1778579833958',{type:'Ремонт',equipment:[{id:'onu',checked:false}],note:'замена ONU'},1,0],
  ['free-repair',{type:'Ремонт',equipment:[{id:'onu',label:'ONU',checked:true,qty:1,price:0}]},0,1],
  ['1774458317609',{type:'Ремонт'},1,null],
  ['1778319337856',{},0,null],
  ['1786990035908',{},0,null],
  ['1774458317612',{type:'Ремонт'},0,null]
 ];
 const source=[['id','date','time','content','sum','tags','нотатки_майстра','fullDataJson']],report=[...[]];
 const headers=[...core.FIELDS,'deleted_at','sync_status'];report.push(headers);
 for(const [id,extra,before] of cases){
   const type=extra.type||'Підключення',date='2026-07-02',time='15:17',ticket={type,equipment:[],sum:800,...extra};
   source.push([id,date,time,type,800,JSON.stringify([type]),'',JSON.stringify(ticket)]);
   const row=Object.fromEntries(core.FIELDS.map(k=>[k,'']));Object.assign(row,{ticket_id:id,work_date:date,work_time:time,work_type:type,work_category:type==='Ремонт'?'repair':'connection',amount:800,total:800,payment_type:'Готівка',onu_used:before,onu_replacement:type==='Ремонт'?before:0,router_used:0,payment_cash:800,payment_cashless:0,payment_free_amount:0,payment_free_count:0,updated_at:'2026-10-15T00:00:00Z',source_version:100,deleted_at:'',sync_status:'SYNCED'});
   row.source_hash=crypto.createHash('sha256').update(core.content(row)).digest('hex');report.push(headers.map(h=>row[h]));
 }
 // Different full contents: no artificial physical duplicates in this fixture.
 source.slice(1).forEach((r,i)=>r[3]+='\nfixture '+i);
 fs.writeFileSync(path.join(dir,'primary.csv'),csv(source));fs.writeFileSync(path.join(dir,'report.csv'),csv(report));
 const p=await prepare(path.join(dir,'primary.csv'),path.join(dir,'report.csv'));
 for(const [id,,before,after] of cases){const e=p.entries.find(e=>e.ticket_id===id);if(after===null)assert.equal(e,undefined,id);else{assert(e,id);assert.equal(e.before.onu_used,before,id);assert.equal(e.target.onu_used,after,id);assert.deepEqual(Object.keys(e.target).sort(),['onu_used','work_category','work_type']);}}
 assert(p.entries.every(e=>!('total' in e.target)));
 console.log('PASS 12 history plan cases: modern ON/OFF, legacy false/empty, explicit customer, approved customer, repair NO/OUR, free ONU, UNKNOWN/test/missing/existing exclusions.');
})().catch(e=>{console.error(e);process.exitCode=1;});
