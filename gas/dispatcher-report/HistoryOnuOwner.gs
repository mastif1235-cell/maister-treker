// Owner-only finite job. No startup calls. No raw DTO, receipt or source writes.
// Requires the existing ONU_Correction_Helper utilities. A single owner-created
// timer continues small portions; every explicit error stops that timer.
var ONU_HISTORY_KEY='ONU-HISTORY-STATE-V1';
function ONU_History_Start(){return ONUHistoryRun_('start');}
function ONU_History_Continue(){return ONUHistoryRun_('continue');}
// Private trigger entry cannot be called through google.script.run.
function ONU_History_Continue_(event){return ONUHistoryRun_('continue',event);}
function ONU_History_Resume(){return ONUHistoryRun_('resume');}
function ONU_History_Rollback(){return ONUHistoryRun_('rollback');}
function ONU_History_VerifyReadOnly(){return ONUHistoryRun_('verify');}
function ONUHistoryTimers_(enable){
  var all=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='ONU_History_Continue_';});
  if(enable){if(!all.length)ScriptApp.newTrigger('ONU_History_Continue_').timeBased().everyMinutes(1).create();}
  else all.forEach(function(t){ScriptApp.deleteTrigger(t);});
}
function ONUHistorySource_(){
  var sheet=SpreadsheetApp.openById('1fc_yXm7XihQn7medg8H25a9cxBn_HIqMhXx-rZyVD5M').getSheetByName('Заявки');
  if(!sheet||sheet.getLastRow()>10001||sheet.getLastColumn()>100)throw new Error('PRIMARY_SCHEMA_OR_CAPACITY');
  var data=sheet.getRange(1,1,sheet.getLastRow(),sheet.getLastColumn()).getDisplayValues(),h=data.shift();
  if(h.slice(0,6).join(',')!=='id,date,time,content,sum,tags')throw new Error('PRIMARY_SCHEMA_CHANGED');
  var col=h.findIndex(function(v){return /^(?:fullDataJson|повніДаніJSON)$/iu.test(v);});
  if(col<0&&h.length>=8&&h[7]==='')col=7;if(col<0)throw new Error('CANONICAL_COLUMN_MISSING');
  var map=new Map();data.forEach(function(c){if(!c[0])return;var id=String(c[0]);if(map.has(id))throw new Error('DUPLICATE_PRIMARY_ID');map.set(id,c);});
  ONU_HISTORY_PLAN.entries.forEach(function(e){
    var c=map.get(e.ticket_id);if(!c)throw new Error('PRIMARY_TICKET_MISSING');
    var digest=ONU20_hash_([String(c[0]),MTDispatcherReportCore.dateKey(c[1]),MTDispatcherReportCore.timeKey(c[2]),c[3],String(c[4]),c[5],c[col]]);
    if(digest!==e.source_digest)throw new Error('PRIMARY_SOURCE_CHANGED_STOP');
  });
}
function ONUHistoryGuard_(store){
  var monthly=MTDispatcherReportCore.render(reportOnuCorrectionEffectiveRows_(store.ss,store.rows.filter(function(r){return /^2026-(09|10)-/.test(r.work_date);}))).monthly;
  var sep=monthly['2026-09'],oct=monthly['2026-10'];
  if(!sep||!oct||sep.onu_connection!==20||sep.onu_repair!==8||sep.total!==46115||oct.onu_connection!==7||oct.onu_repair!==5||oct.total!==20186)throw new Error('SEPTEMBER_OCTOBER_GUARD');
  return ONU20_hash_({sep:sep,oct:oct});
}
function ONUHistoryExisting_(store){
  var allowed=new Set(ONU_HISTORY_PLAN.entries.map(function(e){return e.ticket_id;}));
  return ONU20_hash_(reportOnuCorrectionJournal_(store.ss,false).rows.filter(function(e){return !allowed.has(String(e.ticket_id));}));
}
function ONUHistoryCheck_(store,rollback){
  if(reportReceiptJournal_(store).pending().length)throw new Error('REPORT_COMMIT_UNRESOLVED');
  var seen=new Set();store.rows.forEach(function(r){if(seen.has(String(r.ticket_id)))throw new Error('DUPLICATE_STORED_ID');seen.add(String(r.ticket_id));});
  return ONU_HISTORY_PLAN.entries.map(function(e){
    var row=store.rows.find(function(r){return String(r.ticket_id)===e.ticket_id;});
    if(!row||row.deleted_at)throw new Error('ROW_NOT_ACTIVE');
    if(!rollback&&ONU20_hash_(reportOnuCorrectionEvidence_(row))!==e.evidence_digest)throw new Error('ONU_CORRECTION_SOURCE_CONFLICT');
    var p=reportOnuCorrectionPreview_(store,e.ticket_id).items[0];
    if(!rollback&&['READY','APPLIED','NO_CHANGE'].indexOf(p.state)<0)throw new Error('ONU_CORRECTION_SOURCE_CONFLICT');
    return p;
  });
}
function ONUHistoryVisible_(store){
  var checked=ONU20_visible_(store),monthly=MTDispatcherReportCore.render(reportOnuCorrectionEffectiveRows_(store.ss,store.rows)).monthly,out={};
  for(var m=2;m<=10;m++){
    var key='2026-'+String(m).padStart(2,'0'),s=monthly[key];
    out[key]=s?{connections:s.connections,onu_connection:s.onu_connection,onu_repair:s.onu_repair,total_physical_onu:s.onu_connection+s.onu_repair,total:s.total,payment_cash:s.payment_cash,payment_cashless:s.payment_cashless}:null;
  }
  return {actual_stats_cells_verified:checked.actual_stats_cells_verified,months:out};
}
function ONUHistorySave_(props,state){
  var value=JSON.stringify(state);if(Utilities.newBlob(value).getBytes().length>8000)throw new Error('HISTORY_STATE_TOO_LARGE');
  props.setProperty(ONU_HISTORY_KEY,value);
}
function ONUHistoryRun_(mode,event){
  var lock,locked=false,props,state=null,result,started=Date.now(),writes=0;
  try{
    var config;
    if(event){
      config=reportConfig_();
      if(mode!=='continue'||!event.triggerUid||String(Session.getEffectiveUser().getEmail()||'').toLowerCase()!==config.email||
        !ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='ONU_History_Continue_'&&String(t.getUniqueId())===String(event.triggerUid);}))throw new Error('UNAUTHORIZED');
    }else config=reportAuthorize_();
    if(config.id!=='1auELr1O8ThLimp9kU5xoD7v6VQHf1knOMTOlAjCHVpA')throw new Error('WRONG_SPREADSHEET');
    REPORT_ONU_OWNER_BATCH_CAPABILITY={};
    if(typeof ONU_HISTORY_PLAN==='undefined'||!ONU_HISTORY_PLAN.entries.length||typeof ONU20_visible_!=='function')throw new Error('HISTORY_PACKAGE_REQUIRED');
    props=PropertiesService.getScriptProperties();lock=LockService.getScriptLock();locked=lock.tryLock(1000);
    if(!locked)return {ok:false,code:'BUSY'};
    state=JSON.parse(props.getProperty(ONU_HISTORY_KEY)||'null');
    if(mode==='continue'&&(!state||state.stopped||state.phase==='DONE'||state.phase==='ROLLED_BACK'))return {ok:true,code:'NO_AUTOMATIC_WORK'};
    var rolling=mode==='rollback'||state&&state.phase==='ROLLBACK';
    var store=reportStore_(config);
    if(!rolling)ONUHistorySource_();
    var previews=ONUHistoryCheck_(store,rolling);
    if(mode==='verify'){
      return ONUHistoryLog_({ok:true,mode:'READ_ONLY',applied:previews.filter(function(p){return p.state==='APPLIED';}).length,
        planned:previews.length,pending:!!(state&&(state.pending||state.dirty)),stopped:!!(state&&state.stopped),visible:ONUHistoryVisible_(store),unresolved:ONU_HISTORY_PLAN.skipped});
    }
    if(props.getProperty('ONU20-OWNER-CONTROL-V1')||props.getProperty('ONU-SEP26-CONTROL-V1'))throw new Error('OTHER_OWNER_OPERATION_PENDING');
    if(mode==='start'&&state){if(state.phase==='DONE')return ONUHistoryLog_({ok:true,code:'ALREADY_FINISHED',visible:ONUHistoryVisible_(store)});throw new Error('USE_HISTORY_RESUME');}
    if(!state){
      if(mode!=='start')throw new Error('NO_HISTORY_JOB');
      if(previews.some(function(p){return p.state==='APPLIED';}))throw new Error('UNOWNED_HISTORY_CORRECTION');
      // Budget ALL snapshots before the first journal append. Existing snapshots
      // and credentials are neither overwritten nor exported.
      var size=Utilities.newBlob(JSON.stringify(props.getProperties())).getBytes().length;
      var targets=store.rows.filter(function(r){return ONU_HISTORY_PLAN.entries.some(function(e){return e.ticket_id===String(r.ticket_id);});});
      if(size+Utilities.newBlob(JSON.stringify(targets)).getBytes().length+40000>450000)throw new Error('SNAPSHOT_PROPERTY_CAPACITY');
      state={schema:1,job:'onu-h26-'+Utilities.getUuid(),phase:'APPLY',stopped:false,dirty:false,pending:null,done:0,
        plan:ONU20_hash_(ONU_HISTORY_PLAN),baseline:ONU20_snapshot_(store),protected:ONUHistoryGuard_(store),existing:ONUHistoryExisting_(store)};
      // Permission/timer capability is tested BEFORE correction writes.
      ONUHistoryTimers_(true);
      targets.forEach(function(r){ONU20_saveSnapshot_(props,String(r.ticket_id),r);});
      ONUHistorySave_(props,state);
    }else{
      if(state.plan!==ONU20_hash_(ONU_HISTORY_PLAN))throw new Error('HISTORY_PLAN_CHANGED');
      if(mode==='rollback'){
        // Rollback removes ONLY this job's overlays, keeping later raw money.
        state.phase='ROLLBACK';state.pending=null;state.baseline=ONU20_snapshot_(store);
        state.protected=ONUHistoryGuard_(store);state.existing=ONUHistoryExisting_(store);state.stopped=false;ONUHistorySave_(props,state);
      }else{ONU20_same_(state.baseline,store);}
      if(ONUHistoryExisting_(store)!==state.existing||ONUHistoryGuard_(store)!==state.protected)throw new Error('PROTECTED_MONTH_OR_JOURNAL_CHANGED');
      if(state.stopped&&mode!=='resume'&&mode!=='rollback')throw new Error('JOB_STOPPED');
      if(mode==='resume'||mode==='rollback'){state.stopped=false;ONUHistorySave_(props,state);ONUHistoryTimers_(true);}
    }
    // One portion: <=8 journal entries; <=90 seconds before rendering. Allow
    // ample time for one real full-layout render and cell read-back under GAS.
    while(writes<8&&Date.now()-started<90000){
      store=reportStore_(config);ONU20_same_(state.baseline,store);
      if(reportReceiptJournal_(store).pending().length)throw new Error('REPORT_COMMIT_UNRESOLVED');
      var request=state.pending;
      if(!request){
        var journal=reportOnuCorrectionJournal_(store.ss,false),active=reportOnuCorrectionActive_(journal);
        if(state.phase==='ROLLBACK'){
          var own=journal.rows.filter(function(e){return e.operation==='APPLY'&&String(e.request_id).indexOf(state.job+'-')===0&&active.get(String(e.ticket_id))===e;});
          if(!own.length)break;
          var last=own[own.length-1];request={action:'report_onu_correction_rollback',request_id:state.job+'-rb-'+Utilities.getUuid().slice(0,24),ticket_id:String(last.ticket_id),correction_id:String(last.request_id)};
        }else{
          var next=ONU_HISTORY_PLAN.entries.find(function(e){return !active.has(e.ticket_id);});if(!next)break;
          var p=reportOnuCorrectionPreview_(store,next.ticket_id).items[0];
          if(['READY','NO_CHANGE'].indexOf(p.state)<0)throw new Error('ONU_CORRECTION_SOURCE_CONFLICT');
          request={action:'report_onu_correction_apply',request_id:state.job+'-'+ONU_HISTORY_PLAN.entries.indexOf(next),ticket_id:next.ticket_id,expected:{source_version:p.source_version,source_hash:p.source_hash,before:p.before}};
        }
        state.pending=request;state.dirty=true;ONUHistorySave_(props,state);
      }
      // Owner-authorized internal entry point. Same CAS/journal/idempotency,
      // no externally accepted skip-render flag, no ticket receipt write.
      var response=reportOnuCorrectionExecute_(store,request,ONU20_hash_(request),REPORT_ONU_OWNER_BATCH_CAPABILITY);
      if(!response||!response.ok)throw new Error('CORRECTION_REJECTED');
      var readback=reportStore_(config);ONU20_same_(state.baseline,readback);
      var check=reportOnuCorrectionPreview_(readback,request.ticket_id).items[0];
      if(state.phase==='APPLY'&&(check.state!=='APPLIED'||check.correction_id!==request.request_id)||state.phase==='ROLLBACK'&&check.state==='APPLIED')throw new Error('CORRECTION_READBACK_FAILED');
      state.pending=null;state.done++;ONUHistorySave_(props,state);writes++;
    }
    store=reportStore_(config);ONU20_same_(state.baseline,store);
    if(!rolling)ONUHistorySource_();
    if(ONUHistoryExisting_(store)!==state.existing||ONUHistoryGuard_(store)!==state.protected)throw new Error('PROTECTED_MONTH_OR_JOURNAL_CHANGED');
    if(state.dirty){reportRender_(store.ss,store.rows);SpreadsheetApp.flush();}
    var visible=ONUHistoryVisible_(reportStore_(config));ONU20_same_(state.baseline,reportStore_(config));
    state.dirty=false;
    var ledger=reportOnuCorrectionJournal_(store.ss,false),activeNow=reportOnuCorrectionActive_(ledger);
    var remaining=state.phase==='ROLLBACK'?ledger.rows.filter(function(e){return e.operation==='APPLY'&&String(e.request_id).indexOf(state.job+'-')===0&&activeNow.get(String(e.ticket_id))===e;}).length:
      ONU_HISTORY_PLAN.entries.filter(function(e){return !activeNow.has(e.ticket_id);}).length;
    if(!remaining){state.phase=rolling?'ROLLED_BACK':'DONE';ONUHistoryTimers_(false);}
    ONUHistorySave_(props,state);
    result={ok:true,phase:state.phase,changed_this_portion:writes,remaining:remaining,money_unchanged:true,raw_rows_unchanged:true,receipts_unchanged:true,previous_31_unchanged:true,visible:visible,
      unresolved_count:ONU_HISTORY_PLAN.skipped.filter(function(e){return /UNKNOWN|REVIEW|UNCONFIRMED/.test(e.reason);}).length};
  }catch(error){
    if(mode!=='verify'&&locked){
      if(state&&props){state.stopped=true;state.error=ONU20_code_(error);try{ONUHistorySave_(props,state);}catch(ignore){}}
      try{ONUHistoryTimers_(false);}catch(ignore){}
    }
    result={ok:false,code:ONU20_code_(error),stopped:true,pending:!!(state&&(state.pending||state.dirty)),next:'STOP; inspect error; Resume retries the saved request, Rollback removes only this job overlays'};
  }finally{REPORT_ONU_OWNER_BATCH_CAPABILITY=null;if(locked)lock.releaseLock();}
  return ONUHistoryLog_(result);
}
function ONUHistoryLog_(result){console.log('ONU_HISTORY_RESULT '+JSON.stringify(result));return result;}
