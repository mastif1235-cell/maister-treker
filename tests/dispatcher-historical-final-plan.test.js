'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const core=require('../js/dispatcher-report-core.js');
(async()=>{
  const p=await import('../js/dispatcher-report-projection.mjs');
  const {dryRunHistoricalCorrection}=await import('../js/dispatcher-historical-plan.mjs');
  const positives=['1774458317612','1774458317619','1783937356212'];
  const zeros=['1783336285098','1781882915421','1781880526066','1781871158184','1781716436224','1781179383203','1781104713848','1780498750666','1780498841441','1779469363834'];
  // Dates other than the supplied months are synthetic. No live fixture claim.
  const ticket=(id,index=0)=>({id,date:positives.indexOf(id)===0?'24.02.2026':positives.indexOf(id)===1?'17.03.2026':'29.06.2026',time:'12:'+String(index).padStart(2,'0'),type:'Підключення',tags:['repair'],content:'📋 ЗАЯВКА: ПІДКЛЮЧЕННЯ\nFixture '+id,equipment:[{id:'onu',label:'ONU',checked:!positives.includes(id),price:800}],sum:500+index,payment:'Готівка',callFee:300,tariff:0,clientName:'PRIVATE-NAME-CANARY',masterNote:'SECRET-CANARY',address:'PRIVATE-ADDRESS-CANARY'});
  const current=[...positives,...zeros].map(ticket);
  const initial=[];
  for(const t of current){
    assert.equal(p.resolveHistoricalWorkType(t),'REPAIR');
    const dto=await p.buildDTO(t,core,100);
    assert.equal(dto.work_category,'repair');assert.equal(dto.onu_used,positives.includes(t.id)?1:0);assert.equal(dto.total,t.sum);
    assert.equal(p.confirmedRepairOnuCount([{...t,type:'Ремонт',work_category:'repair'}],core),positives.includes(t.id)?1:0);
    initial.push({...await p.buildDTO(t,core,100,{},'CONNECTION'),deleted_at:'',sync_status:'SYNCED'});
  }
  const alias={...ticket('1782744999128'),type:'Ремонт',content:'Different saved archive representation of the approved same job',equipment:[{id:'onu',label:'ONU',checked:true,price:800}]};
  initial.push({...await p.buildDTO(alias,core,100,{},'REPAIR'),deleted_at:'',sync_status:'SYNCED'});
  const excluded=p.HISTORICAL_REBUILD_EXCLUDED_IDS.map((id,index)=>({...ticket(id,index),type:'Ремонт',tags:['repair'],content:'📋 ЗАЯВКА: РЕМОНТ\nExcluded fixture'}));
  const fixed=[{...ticket('1778579833958'),date:'12.05.2026',time:'12:57',type:'Ремонт',tags:['repair'],content:'Поменял ONU, поставил блок питания',sum:1600},{...ticket('1776093623146'),date:'13.04.2026',time:'18:20',type:'Ремонт',tags:['repair'],content:'ONU куплена клиентом',sum:300}];
  for(const t of fixed){const dto=await p.buildDTO(t,core,100);assert.equal(dto.onu_used,0);assert.equal(dto.onu_replacement,0);initial.push({...dto,deleted_at:'',sync_status:'SYNCED'});}
  const held=core.HISTORICAL_UNRESOLVED_ONU_IDS.map((id,i)=>({...ticket(id),time:'20:0'+i,type:'Ремонт',tags:['repair'],content:'📋 ЗАЯВКА: РЕМОНТ\nПоменял ONU',equipment:[]}));
  for(const t of held)initial.push({...await p.buildDTO(t,core,100),deleted_at:'',sync_status:'SYNCED'});
  const source={current:[...current,...excluded,...fixed,...held],archive:[alias],reportRows:initial};
  const snapshot=JSON.stringify(source),plan=await dryRunHistoricalCorrection(source,core,1000);
  assert.equal(plan.ready,true);assert.equal(plan.source_audit.unknownTypes.length,0);assert.equal(plan.source_audit.duplicate_count,1);
  assert.equal(plan.source_audit.months.reduce((n,m)=>n+m.repair_onu,0),3,'three confirmed repairs, not a repair-wide default');
  assert.equal(plan.actions.filter(a=>a.action==='EXCLUDED').length,2);assert.equal(plan.actions.filter(a=>a.action==='KEEP_UNKNOWN').length,1);
  const proposed=plan.actions.find(a=>a.ticket_id===alias.id);assert.equal(proposed.action,'PROPOSE_SOFT_DELETE_DUPLICATE');assert.equal(proposed.preferred_id,'1783937356212');
  assert.equal(JSON.stringify(source),snapshot,'source and live-row snapshot are never mutated');
  for(const canary of ['SECRET-CANARY','PRIVATE-NAME-CANARY','PRIVATE-ADDRESS-CANARY'])assert(!JSON.stringify(plan).includes(canary));
  const simulated=initial.map(row=>({...row}));
  for(const action of plan.actions){
    if(action.action==='UPDATE'||action.action==='INSERT'){
      const t=source.current.find(t=>t.id===action.ticket_id),dto=await p.buildDTO(t,core,action.source_version,p.HISTORICAL_ONU_OVERRIDES,p.resolveHistoricalWorkType(t));
      assert.equal(dto.source_hash,action.source_hash);assert.equal(dto.total,t.sum);
      for(const field of ['total','amount','payment_type','payment_cash','payment_cashless','service_fee','tariff_amount'])assert.equal(dto[field],initial.find(row=>row.ticket_id===t.id)?.[field]);
      core.upsert(simulated,dto);
    }else if(action.action==='PROPOSE_SOFT_DELETE_DUPLICATE')core.remove(simulated,action.ticket_id,action.source_version,new Date(action.source_version).toISOString());
  }
  const replay=await dryRunHistoricalCorrection({...source,reportRows:simulated},core,2000);
  assert.equal(replay.ready,true);assert(!replay.actions.some(a=>['UPDATE','INSERT','PROPOSE_SOFT_DELETE_DUPLICATE'].includes(a.action)),'a repeated correction is a no-op');
  assert.equal(new Set(simulated.map(r=>r.ticket_id)).size,simulated.length);
  const mutated=initial.map(row=>({...row}));mutated[0].source_hash='0'.repeat(64);
  await assert.rejects(()=>dryRunHistoricalCorrection({...source,reportRows:mutated},core,2000),/HISTORICAL_REPORT_HASH_MISMATCH/);
  const financial=initial.map(row=>({...row}));financial[0].total++;financial[0].amount++;financial[0].payment_cash++;
  financial[0].source_hash=require('node:crypto').createHash('sha256').update(core.content(financial[0])).digest('hex');
  const blocked=await dryRunHistoricalCorrection({...source,reportRows:financial},core,2000);assert.equal(blocked.ready,false);assert(blocked.blocks.some(b=>b.code==='FINANCIAL_DIFF'));
  const incomplete={...ticket('new-incomplete'),tags:['connect'],equipment:[]};
  const noInsert=await dryRunHistoricalCorrection({current:[incomplete],archive:[],reportRows:[],incompleteCanonicalIds:['new-incomplete']},core,2000);
  assert.equal(noInsert.ready,false);assert(noInsert.blocks.some(b=>b.code==='FULL_CANONICAL_REQUIRED_FOR_INSERT'));
  const deleted={...initial[0],deleted_at:'2026-10-01T00:00:00.000Z',sync_status:'DELETED'};
  const noRestore=await dryRunHistoricalCorrection({current:[current[0]],archive:[],reportRows:[deleted]},core,2000);
  assert.equal(noRestore.ready,false);assert(noRestore.blocks.some(b=>b.code==='TOMBSTONE_NOT_RESTORED'));
  assert.equal(p.classifyConnectionOnu({...ticket('1783937356209'),content:'',equipment:[]},core).onu_connection,0,'approved customer decision survives missing legacy text');

  const {parseCSV,canonicalTickets,reportRows,main}=require('../scripts/historical-onu-audit.cjs');
  assert.deepEqual(parseCSV('\uFEFFid,content\r\na,"line1\nline2, ""quote"""\r\n'),[{id:'a',content:'line1\nline2, "quote"'}]);
  assert.throws(()=>parseCSV('id,id\na,b'),/INVALID_CSV_HEADERS/);assert.throws(()=>parseCSV('id,content\na,"unclosed'),/INVALID_CSV/);
  const mapped=await canonicalTickets([{id:'csv-source',date:'13.10.2026',time:'12:00',content:'📋 ЗАЯВКА: ПІДКЛЮЧЕННЯ',sum:'800',tags:'["connect"]',fullDataJson:JSON.stringify({...ticket('csv-source'),type:'Підключення',equipment:[],sum:800,password:'PRIVATE-PASSWORD-CANARY'})}]);
  assert.equal(mapped.tickets[0].sum,800);assert.equal(mapped.incompleteCanonicalIds.length,0);
  const csvRow=Object.fromEntries(Object.entries(initial[0]).map(([key,value])=>[key,String(value)]));
  assert.equal(reportRows([csvRow])[0].onu_used,initial[0].onu_used);
  assert.deepEqual(reportRows([{ticket_id:'deleted-id',source_version:'100',source_hash:'',onu_used:'',total:'',deleted_at:'2026-10-01T00:00:00.000Z',sync_status:'DELETED'}]),[{ticket_id:'deleted-id',source_version:100,deleted_at:'2026-10-01T00:00:00.000Z',sync_status:'DELETED'}]);

  // View proof: every daily/weekly/monthly panel has exactly two ONU counter
  // lines; held UNKNOWN rows are intact and excluded from confirmed repair.
  const view=core.render(simulated),panels=view.blocks.filter(b=>['daily','weekly','monthly'].includes(b.kind));
  assert(panels.length);
  for(const panel of panels){assert(panel.text.includes('ONU на підключеннях'));assert(panel.text.includes('ONU на ремонтах'));assert(!panel.text.includes('Разом ONU'));assert(!panel.text.includes('Заміна ONU'));assert(!/\nONU —/u.test(panel.text));}
  for(const t of held){const after=simulated.find(row=>row.ticket_id===t.id),before=initial.find(row=>row.ticket_id===t.id);assert.deepEqual(after,before);assert.equal(core.stats([after]).onu_repair,0);}
  // End-to-end offline transfer: private CSV stays on disk; only the safe
  // report can be shared. Existing output files are never overwritten.
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'mt-onu-audit-'));
  try{
    const csv=(headers,rows)=>headers.join(',')+'\n'+rows.map(row=>headers.map(key=>'"'+String(row[key]??'').replaceAll('"','""')+'"').join(',')).join('\n')+'\n';
    const october=Array.from({length:10},(_,i)=>({...ticket('offline-'+i,i),date:'13.10.2026',type:i<6?'Підключення':'Ремонт',tags:[i<6?'connect':'repair'],content:'📋 ЗАЯВКА: '+(i<6?'ПІДКЛЮЧЕННЯ':'РЕМОНТ')+'\nOffline fixture '+i,equipment:i<6?[]:[{id:'onu',label:'ONU',checked:true,price:800}],password:'PRIVATE-CSV-PASSWORD-CANARY'}));
    const sourceRows=october.map(t=>({id:t.id,date:t.date,time:t.time,content:t.content,sum:t.sum,tags:JSON.stringify(t.tags),fullDataJson:JSON.stringify(t)}));
    const reports=[];for(const t of october){const dto=await p.buildDTO(t,core,100);if(t.type==='Підключення'){dto.onu_used=0;dto.source_hash=require('node:crypto').createHash('sha256').update(core.content(dto)).digest('hex');}reports.push({...dto,deleted_at:'',sync_status:'SYNCED'});}
    const filenames=['current.csv','archive.csv','report.csv','safe.json'].map(name=>path.join(folder,name));
    fs.writeFileSync(filenames[0],csv(['id','date','time','content','sum','tags','fullDataJson'],sourceRows));
    fs.writeFileSync(filenames[1],csv(['id','date','time','content','sum','tags','fullDataJson'],[]));
    fs.writeFileSync(filenames[2],csv([...core.ALL_FIELDS,'deleted_at','sync_status'],reports));
    const args=['--current',filenames[0],'--archive',filenames[1],'--report',filenames[2],'--output',filenames[3]];
    await main(args);
    const safe=fs.readFileSync(filenames[3],'utf8'),output=JSON.parse(safe);
    assert.equal(output.source_audit.months[0].connection_our_onu,6);assert.equal(output.source_audit.months[0].repair_onu,4);assert.equal(output.monthly_after['2026-10'].total_physical_onu,10);
    assert.equal(output.ready_for_production,false);assert.equal(output.no_production_writes,true);
    for(const canary of ['PRIVATE-CSV-PASSWORD-CANARY','PRIVATE-NAME-CANARY','PRIVATE-ADDRESS-CANARY','SECRET-CANARY'])assert(!safe.includes(canary));
    await assert.rejects(()=>main(args),{code:'EEXIST'});assert.equal(fs.readFileSync(filenames[3],'utf8'),safe);
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
  console.log('PASS final historical plan: 13 repair decisions, 3 positive consumption, 10 zero, fixed/held/excluded preserved, approved repair alias, money/hash preconditions, idempotent clone-only simulation, safe CSV, two ONU lines');
})().catch(error=>{console.error(error);process.exitCode=1;});
