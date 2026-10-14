/* Offline/read-only historical correction planner. No executor, fetch, storage,
   enqueue, receipts, sync or rebuild. All core upsert/remove calls use clones. */
import {buildDTO,confirmedRepairOnuCount,reportPresentation,reconcileHistoricalTickets,resolveHistoricalWorkType,dryRunHistoricalOnu,HISTORICAL_ONU_OVERRIDES,HISTORICAL_REBUILD_EXCLUDED_IDS} from './dispatcher-report-projection.mjs';

const financialFields=Object.freeze(['amount','total','payment_type','payment_cash','payment_cashless','payment_free_amount','payment_free_count','service_fee','tariff_amount']);
const safeFields=Object.freeze(['work_category','onu_used','onu_replacement',...financialFields]);
const safeRow=row=>row?Object.fromEntries(safeFields.filter(key=>row[key]!==undefined).map(key=>[key,row[key]])):null;
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
const snapshotRow=row=>({ticket_id:row.ticket_id,source_version:row.source_version,source_hash:row.source_hash||'',deleted_at:row.deleted_at||'',sync_status:row.sync_status||''});
function monthly(rows,core){return Object.fromEntries(Object.entries(core.render(rows).monthly).map(([month,value])=>[month,{connections:value.connections,connection_our_onu:value.onu_connection,repair_onu:value.onu_repair,total_physical_onu:value.onu_connection+value.onu_repair,total:value.total,payment_cash:value.payment_cash,payment_cashless:value.payment_cashless}]));}

export async function dryRunHistoricalCorrection(source,core,now=Date.now()){
  if(!source||!Array.isArray(source.current)||!Array.isArray(source.archive)||!Array.isArray(source.reportRows)||!Number.isSafeInteger(now)||now<1)throw new Error('HISTORICAL_SOURCE_UNAVAILABLE');
  const seen=new Set(),stored=source.reportRows.map(row=>({...row})),blocks=[],actions=[];
  for(const row of stored){
    if(seen.has(String(row.ticket_id)))throw new Error('HISTORICAL_REPORT_DUPLICATE_ID');seen.add(String(row.ticket_id));
    if(!row.deleted_at){
      const dto=core.validate(Object.fromEntries(core.ALL_FIELDS.filter(key=>row[key]!==undefined).map(key=>[key,row[key]])));
      if(await digest(core.content(dto))!==row.source_hash)throw new Error('HISTORICAL_REPORT_HASH_MISMATCH');
      if(row.sync_status!=='SYNCED')throw new Error('HISTORICAL_REPORT_NOT_SYNCED');
    }
  }
  const rows=stored.map(row=>({...row})),reconciled=reconcileHistoricalTickets(source.current,source.archive,core),audit=dryRunHistoricalOnu(source,core);
  if(audit.unknownTypes.length)blocks.push({code:'UNKNOWN_WORK_TYPES',ticket_ids:audit.unknownTypes.map(row=>row.ticket_id)});
  if(audit.connectionReviews.length)blocks.push({code:'ONU_SELECTION_REVIEW_REQUIRED',ticket_ids:audit.connectionReviews.map(row=>row.ticket_id)});
  if(reconciled.unresolvedAliases.length)blocks.push({code:'PREFERRED_CANONICAL_RECORD_UNAVAILABLE',ticket_ids:reconciled.unresolvedAliases.map(row=>row.ticket_id)});
  for(const {ticket} of reconciled.records){
    const id=String(ticket.id),before=stored.find(row=>String(row.ticket_id)===id);
    if(HISTORICAL_REBUILD_EXCLUDED_IDS.includes(id)){actions.push({ticket_id:id,action:'EXCLUDED',reason:'CLOSED_PERIOD_NOT_RESTORING'});continue;}
    if(HISTORICAL_ONU_OVERRIDES[id]==='UNKNOWN'){actions.push({ticket_id:id,action:'KEEP_UNKNOWN',before:safeRow(before),after:safeRow(before)});continue;}
    const type=resolveHistoricalWorkType(ticket);
    if(type==='UNKNOWN_TYPE')continue;
    if(before?.deleted_at){blocks.push({code:'TOMBSTONE_NOT_RESTORED',ticket_ids:[id]});continue;}
    const version=Math.max(now,(before?.source_version||0)+1);
    if(!Number.isSafeInteger(version)){blocks.push({code:'NO_SAFE_FRESH_VERSION',ticket_ids:[id]});continue;}
    let dto;
    try{dto=await buildDTO(ticket,core,version,HISTORICAL_ONU_OVERRIDES,type);}catch{blocks.push({code:'CANONICAL_PROJECTION_INVALID',ticket_ids:[id]});continue;}
    if(type==='REPAIR'){
      const confirmed=confirmedRepairOnuCount([{...ticket,type:'Ремонт',work_category:'repair',materials_display:reportPresentation(ticket,core).materials}],core);
      if(dto.onu_used!==confirmed){blocks.push({code:'UNCONFIRMED_REPAIR_CONSUMPTION',ticket_ids:[id]});continue;}
    }
    // Missing canonical JSON may be audited as raw legacy, but cannot be used
    // to invent a new server row. The CSV adapter marks this explicitly.
    if(!before&&source.incompleteCanonicalIds?.includes(id)){blocks.push({code:'FULL_CANONICAL_REQUIRED_FOR_INSERT',ticket_ids:[id]});continue;}
    if(before&&financialFields.some(key=>before[key]!==dto[key])){blocks.push({code:'FINANCIAL_DIFF',ticket_ids:[id],fields:financialFields.filter(key=>before[key]!==dto[key])});continue;}
    const changed=core.ALL_FIELDS.filter(key=>!['source_version','source_hash','updated_at'].includes(key)&&before?.[key]!==dto[key]);
    if(before&&!changed.length){actions.push({ticket_id:id,action:'UNCHANGED',before:safeRow(before),after:safeRow(before),precondition:snapshotRow(before)});continue;}
    const request_id=crypto.randomUUID();
    const operation=core.upsert(rows,dto);
    actions.push({ticket_id:id,action:operation==='inserted'?'INSERT':'UPDATE',before:safeRow(before),after:safeRow(dto),changed_fields:changed,precondition:before?snapshotRow(before):{ticket_id:id,active_absent:true,deleted_absent:true},source_version:dto.source_version,source_hash:dto.source_hash,request_id,canonical_sum:Number(ticket.sum??0)});
  }
  // Proposals only: preferred row must exist in the simulated result before a
  // duplicate can be soft-deleted. Monetary columns remain stored unchanged.
  for(const duplicate of reconciled.duplicates.filter(row=>row.reason!=='SAME_TICKET_ID')){
    const before=stored.find(row=>String(row.ticket_id)===duplicate.suppressed_id);
    if(!before||before.deleted_at)continue;
    if(HISTORICAL_REBUILD_EXCLUDED_IDS.includes(duplicate.suppressed_id))continue;
    const preferred=rows.find(row=>String(row.ticket_id)===duplicate.kept_id&&!row.deleted_at);
    if(!preferred){blocks.push({code:'PREFERRED_REPORT_ROW_REQUIRED',ticket_ids:[duplicate.suppressed_id,duplicate.kept_id]});continue;}
    const version=Math.max(now,before.source_version+1);
    if(!Number.isSafeInteger(version)){blocks.push({code:'NO_SAFE_FRESH_VERSION',ticket_ids:[duplicate.suppressed_id]});continue;}
    core.remove(rows,duplicate.suppressed_id,version,new Date(version).toISOString());
    actions.push({ticket_id:duplicate.suppressed_id,action:'PROPOSE_SOFT_DELETE_DUPLICATE',preferred_id:duplicate.kept_id,precondition:snapshotRow(before),source_version:version,request_id:crypto.randomUUID(),financial_fields_preserved:true});
  }
  const snapshot=stored.map(snapshotRow).sort((a,b)=>String(a.ticket_id).localeCompare(String(b.ticket_id)));
  return {mode:'READ_ONLY_DRY_RUN',ready:blocks.length===0,requires_user_approval:true,source_audit:audit,blocks,actions,monthly_before:monthly(stored,core),monthly_after:monthly(rows,core),snapshot:{rows:stored.length,active:stored.filter(row=>!row.deleted_at).length,deleted:stored.filter(row=>row.deleted_at).length,identity_sha256:await digest(JSON.stringify(snapshot))},no_production_writes:true};
}
