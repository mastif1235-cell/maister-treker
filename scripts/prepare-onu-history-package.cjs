'use strict';
// Offline, primary-only preparation. No network, no DTO writes. Output has no PII.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {parseCSV,canonicalTickets,reportRows}=require('./historical-onu-audit.cjs');
const core=require('../js/dispatcher-report-core.js');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function prepare(primaryFile,reportFile){
  let text=fs.readFileSync(primaryFile,'utf8');
  // Known legacy H column is blank-headed; preserve its full canonical JSON.
  const eol=text.indexOf('\n'),header=text.slice(0,eol).replace(/\r$/,'');
  if(header.split(',').length===8&&header.endsWith(','))text=header+'fullDataJson\n'+text.slice(eol+1);
  const source=parseCSV(text),mapped=await canonicalTickets(source),stored=reportRows(parseCSV(fs.readFileSync(reportFile,'utf8')));
  const projection=await import('../js/dispatcher-report-projection.mjs');
  const code=fs.readFileSync(path.join(__dirname,'../js/dispatcher-report-projection.mjs'),'utf8');
  const review=vm.runInNewContext('('+code.match(/const LOCAL_ONU_REVIEW_TYPES=Object\.freeze\((\{[\s\S]*?\})\);/)[1]+')');
  const ctx={Object,MTDispatcherReportCore:core};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../gas/dispatcher-report/DispatcherReport.gs'),'utf8'),ctx);
  const oldIds=new Set(Object.keys(ctx.REPORT_ONU_CORRECTION_TARGETS));
  const reconciled=projection.reconcileHistoricalTickets(mapped.tickets,[],core);
  const duplicates=new Set(reconciled.duplicates.flatMap(d=>[d.kept_id,d.suppressed_id]));
  const excluded=new Set([...projection.HISTORICAL_REBUILD_EXCLUDED_IDS,...projection.LOCAL_REPORT_TEST_IDS]);
  const entries=[],skipped=[],unchanged=[];
  for(let i=0;i<mapped.tickets.length;i++){
    const t=mapped.tickets[i],s=source[i],id=String(t.id),date=core.dateKey(t.date);
    if(date<'2026-02-01'||date>'2026-08-31'||oldIds.has(id))continue;
    const ref={ticket_id:id,date};
    function skip(reason){skipped.push({...ref,reason});}
    if(excluded.has(id)){skip('EXCLUDED');continue;}
    if(duplicates.has(id)){skip('PHYSICAL_DUPLICATE_REVIEW');continue;}
    const matches=stored.filter(r=>String(r.ticket_id)===id);
    if(matches.length!==1||matches[0].deleted_at){skip(matches.length>1?'DUPLICATE_REPORT_ID':'NOT_ACTIVE_NO_RESTORE');continue;}
    const row=matches[0];
    if(core.dateKey(row.work_date)!==date||core.timeKey(row.work_time)!==core.timeKey(t.time)){skip('SOURCE_REPORT_DATE_MISMATCH');continue;}
    const decision=projection.HISTORICAL_ONU_OVERRIDES[id];
    const kind=review[id]||projection.HISTORICAL_WORK_TYPE_OVERRIDES[id]||(decision?'REPAIR':projection.resolveHistoricalWorkType(t));
    if(!['CONNECTION','REPAIR'].includes(kind)){skip(kind==='OTHER'?'OTHER':'UNKNOWN_TYPE');continue;}
    const stats=projection.localOnuStatistics([t],core);
    if(decision==='UNKNOWN'||(!decision&&stats.unknown.length)||stats.excluded.length){skip(stats.unknown[0]?.reason||'UNKNOWN_ONU_CONSUMPTION');continue;}
    let onu,reason;
    if(kind==='CONNECTION'){
      const d=projection.classifyConnectionOnu(t,core);onu=d.onu_connection;reason=d.reason;
    }else{
      onu=decision==='NO_ONU'?0:decision==='OUR_ONU'?1:stats.repair;reason='CONFIRMED_REPAIR_EVIDENCE';
      if(projection.HISTORICAL_ONU_OVERRIDES[id]==='NO_ONU')reason='CONFIRMED_NO_ONU';
      else if(onu===0&&Number(row.onu_used)>0){skip('UNCONFIRMED_REPAIR_KEEP');continue;}
    }
    if(!Number.isSafeInteger(onu)||onu<0){skip('INVALID_ONU_QUANTITY');continue;}
    const target={work_type:kind==='CONNECTION'?'Підключення':'Ремонт',work_category:kind==='CONNECTION'?'connection':'repair',onu_used:onu};
    // No work-type relabelling when no physical ONU change is necessary.
    if(row.work_category===target.work_category&&row.onu_used===onu){unchanged.push({...ref,reason,onu});continue;}
    if(onu===0&&row.onu_used===0){unchanged.push({...ref,reason:'NO_PHYSICAL_DIFF',onu});continue;}
    const sourceFields=[id,date,core.timeKey(t.time),s.content,String(s.sum),s.tags,s.fullDataJson||s['повніДаніJSON']||''];
    entries.push({...ref,time:core.timeKey(t.time),reason,source_digest:hash(sourceFields),target,
      before:{work_type:row.work_type,work_category:row.work_category,onu_used:row.onu_used},
      evidence_digest:hash(ctx.reportOnuCorrectionEvidence_?(()=>{ctx.MTDispatcherReportCore=core;return ctx.reportOnuCorrectionEvidence_(row);})():{})});
  }
  const simulated=stored.map(r=>({...r}));
  // The previous 31 are already applied in production per owner verification;
  // stale CSV does not contain their journal. This is explicitly a simulation.
  for(const r of simulated){const old=ctx.REPORT_ONU_CORRECTION_TARGETS[r.ticket_id],next=entries.find(e=>e.ticket_id===r.ticket_id);if(!r.deleted_at&&old)Object.assign(r,old);if(!r.deleted_at&&next)Object.assign(r,next.target);}
  const months={};for(const [key,s] of Object.entries(core.render(simulated).monthly))if(key>='2026-02'&&key<='2026-10')months[key]={connections:s.connections,onu_connection:s.onu_connection,onu_repair:s.onu_repair,total_physical_onu:s.onu_connection+s.onu_repair,total:s.total,payment_cash:s.payment_cash,payment_cashless:s.payment_cashless};
  return {schema:1,period:'2026-02..2026-08',primary_only:true,entries:entries.sort((a,b)=>a.date.localeCompare(b.date)||a.ticket_id.localeCompare(b.ticket_id)),skipped,unchanged,provisional_csv_simulation_only:months,inputs:{primary_sha256:hash(source),report_sha256:hash(stored)}};
}
module.exports={prepare};
if(require.main===module)prepare(process.argv[2],process.argv[3]).then(plan=>{
  const out=path.resolve(process.argv[4]);fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'onu-history-plan.json'),JSON.stringify(plan,null,2)+'\n');
  console.log(JSON.stringify({changes:plan.entries.length,by_month:plan.entries.reduce((a,e)=>(a[e.date.slice(0,7)]=(a[e.date.slice(0,7)]||0)+1,a),{}),skipped:plan.skipped.reduce((a,e)=>(a[e.reason]=(a[e.reason]||0)+1,a),{}),output:out}));
}).catch(e=>{console.error(e.message);process.exitCode=1;});
