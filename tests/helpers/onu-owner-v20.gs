// Owner/editor only. No deployment. ONE mutation/render per manual execution.
// Uses v20 HMAC verification + reportExecute_, never raw-row writes.
function ONU_Correction_ApplyNext() { return ONU20_run_('apply'); }
function ONU_Correction_ResumePending() { return ONU20_run_('resume'); }
function ONU_Correction_RollbackLast() { return ONU20_run_('rollback'); }
function ONU_Correction_VerifyReadOnly() { return ONU20_run_('verify'); }

function ONU20_ids_() {
  return ['1774458317612','1774458317619','1783937356212','1783937356227','1783937356219',
    '9a61c8b5-f8c8-4f0a-9446-d8e7cbfadf21','f22710e7-1142-49f5-a2b1-7f4a6e54fe94',
    'a65dd9a4-fefb-4381-be39-8b1b0ed8d793','ac5bb18a-cd71-4e9e-97d9-bdf57353d921',
    '2edc4344-42ed-44d8-9e10-384126505bcf','8b933540-b8e2-4493-8020-75754fb5ebec'];
}
function ONU20_hash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(value),Utilities.Charset.UTF_8)
    .map(function(n){return ((n+256)%256).toString(16).padStart(2,'0');}).join('');
}
function ONU20_code_(error) {
  var value=String(error&&(error.code||error.message)||'HELPER_FAILED');
  return /^[A-Z][A-Z0-9_]{1,80}$/.test(value)?value:'HELPER_FAILED';
}
function ONU20_sheetHash_(ss,name) {
  var sheet=ss.getSheetByName(name);
  return ONU20_hash_(sheet?sheet.getDataRange().getValues():null);
}
function ONU20_snapshot_(store) {
  return {raw:ONU20_hash_(store.rows),receipts:ONU20_sheetHash_(store.ss,'_DispatcherReceipts')};
}
function ONU20_same_(before,store) {
  var after=ONU20_snapshot_(store);
  if(after.raw!==before.raw||after.receipts!==before.receipts)throw new Error('RAW_OR_RECEIPTS_CHANGED_STOP');
}
function ONU20_all_(store) {
  return ONU20_ids_().map(function(id,index){
    var target=Object.prototype.hasOwnProperty.call(REPORT_ONU_CORRECTION_TARGETS,id)&&REPORT_ONU_CORRECTION_TARGETS[id];
    if(!target||target.onu_used!==1||target.work_category!==(index<5?'repair':'connection'))throw new Error('TARGET_MISMATCH');
    var p=reportOnuCorrectionPreview_(store,id).items[0];
    if(!p||p.ticket_id!==id||['READY','NO_CHANGE','APPLIED'].indexOf(p.state)<0)throw new Error('PREFLIGHT_CONFLICT_OR_MISSING');
    var expected=Object.assign({},p.before,target);
    if(JSON.stringify(expected)!==JSON.stringify(p.after)||p.total_before!==p.total_after)throw new Error('PREVIEW_PROTECTED_FIELD_CHANGED');
    if(!Number.isSafeInteger(p.source_version)||!/^[a-f0-9]{64}$/.test(p.source_hash))throw new Error('INVALID_SOURCE_IDENTITY');
    return p;
  });
}
function ONU20_saveSnapshot_(props,id,row) {
  // Private owner-only snapshot; no logs of notes, MAC or client details.
  // At most 1000 UTF-16 code units per property (<9 KB UTF-8 limit).
  var prefix='ONU20-SNAPSHOT-'+id+'-',text=JSON.stringify(row),count=Math.ceil(text.length/1000);
  if(props.getProperty(prefix+'COUNT'))return;
  for(var i=0;i<count;i++)props.setProperty(prefix+i,text.slice(i*1000,(i+1)*1000));
  props.setProperty(prefix+'COUNT',String(count));
}
function ONU20_signed_(config,request) {
  var secret=reportHmacSecret_();
  if(Utilities.newBlob(secret).getBytes().length<32)throw new Error('AUTH_NOT_CONFIGURED');
  var envelope={v:3,method:'POST',action:request.action,entity:'system',id:'',ts:String(Date.now()),
    nonce:Utilities.getUuid().replace(/-/g,''),requestId:request.request_id,body:JSON.stringify(request)};
  envelope.sig=Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(reportCanonical_(envelope),secret,Utilities.Charset.UTF_8)).replace(/=+$/g,'');
  if(!reportVerifyEnvelope_(envelope))throw new Error('AUTH_FAILED');
  // Same signed dispatcher handler while the owner's script lock is held.
  // No doPost nesting and no reportAudit_ or ticket receipt writes.
  return reportExecute_(config,request,envelope.nonce);
}
function ONU20_visible_(store) {
  var effective=reportOnuCorrectionEffectiveRows_(store.ss,store.rows);
  var report=MTDispatcherReportCore.render(effective),sheet=store.ss.getSheetByName('Отчет');
  var spans=report.layout.spans.filter(function(s){return /^(daily|weekly|weeklyContinuation|monthly)$/.test(s.kind);});
  if(!spans.length)throw new Error('NO_VISIBLE_STATS');
  // Read the real cells, not just a calculated preview.
  var values=sheet.getRange(1,1,Math.max(sheet.getLastRow(),report.layout.rows.length),5).getValues();
  spans.forEach(function(s){
    var actual=String(values[s.row-1][s.column-1]);
    if(actual!==s.text)throw new Error('VISIBLE_REPORT_MISMATCH');
    var lines=actual.split('\n'),onu=lines.filter(function(line){
      return /(?:ONU на підключеннях|ONU на ремонтах|(?:^|\s)(?:Разом ONU|Заміна ONU|ONU на підключенні)|^\s*(?:📦\s*)?(?:ONU|ONT|ОНУ)\s*[—:])/iu.test(line);
    });
    // Cross-month continuations contain a reference, not a second summary.
    // Exact cell equality above still verifies their full visible text.
    if(s.kind==='weeklyContinuation'){
      if(onu.length!==0)throw new Error('ONU_STATS_DUPLICATED');
      return;
    }
    if(onu.length!==2||onu.filter(function(line){return /ONU на підключеннях — \d+ шт\./u.test(line);}).length!==1||
       onu.filter(function(line){return /ONU на ремонтах — \d+ шт\./u.test(line);}).length!==1)throw new Error('ONU_STATS_DUPLICATED');
  });
  var months={};['2026-09','2026-10'].forEach(function(key){
    var s=report.monthly[key];
    months[key]=s?{connections:s.connections,onu_connection:s.onu_connection,onu_repair:s.onu_repair,
      total:s.total,payment_cash:s.payment_cash,payment_cashless:s.payment_cashless}:null;
  });
  return {actual_stats_cells_verified:spans.length,months:months,
    september_matches_reference:!!months['2026-09']&&months['2026-09'].onu_connection===20&&months['2026-09'].onu_repair===8,
    october_matches_reference:!!months['2026-10']&&months['2026-10'].onu_connection===7&&months['2026-10'].onu_repair===5};
}
function ONU20_run_(mode) {
  var started=Date.now(),lock,locked=false,props,control=null,key='ONU20-OWNER-CONTROL-V1',output;
  try {
    var config=reportAuthorize_();props=PropertiesService.getScriptProperties();
    if(config.id!=='1auELr1O8ThLimp9kU5xoD7v6VQHf1knOMTOlAjCHVpA')throw new Error('WRONG_SPREADSHEET');
    lock=LockService.getScriptLock();locked=lock.tryLock(1000);if(!locked)throw new Error('BUSY');
    var store=reportStore_(config);
    if(reportReceiptJournal_(store).pending().length)throw new Error('REPORT_COMMIT_UNRESOLVED');
    control=JSON.parse(props.getProperty(key)||'null');
    if(mode==='verify'){
      var previews=ONU20_all_(store),visible=ONU20_visible_(store);
      output={ok:true,mode:'READ_ONLY',completed:previews.filter(function(p){return p.state==='APPLIED';}).length,
        pending:!!control,visible:visible};
    }else{
      if(mode==='apply'&&control)throw new Error('PENDING_OPERATION_USE_RESUME_OR_ROLLBACK');
      var request,baseline,selected;
      if(mode==='resume'){
        if(!control)throw new Error('NO_PENDING_OPERATION');
        request=control.request;baseline=control.baseline;ONU20_same_(baseline,store);
        if(ONU20_ids_().indexOf(request.ticket_id)<0)throw new Error('INVALID_PENDING_ID');
      }else if(mode==='rollback'){
        var journal=reportOnuCorrectionJournal_(store.ss,false),active=reportOnuCorrectionActive_(journal);
        var owned=journal.rows.filter(function(e){return e.operation==='APPLY'&&String(e.request_id).indexOf('onu20-owner-')===0&&
          active.get(String(e.ticket_id))===e&&ONU20_ids_().indexOf(String(e.ticket_id))>=0;});
        if(!owned.length)throw new Error('NO_HELPER_CORRECTION_TO_ROLLBACK');
        var last=owned[owned.length-1];
        if(control&&control.request.action==='report_onu_correction_rollback'){
          request=control.request;baseline=control.baseline;ONU20_same_(baseline,store);
        }else{
          if(control&&control.request.ticket_id!==String(last.ticket_id))throw new Error('PENDING_DIFFERENT_ID_USE_RESUME');
          request={action:'report_onu_correction_rollback',request_id:'onu20-rollback-'+Utilities.getUuid(),ticket_id:String(last.ticket_id),correction_id:String(last.request_id)};
          baseline=ONU20_snapshot_(store);
        }
      }else{
        // Refresh ALL eleven under the lock before choosing ONE eligible ID.
        var all=ONU20_all_(store);selected=all.filter(function(p){return p.state!=='APPLIED';})[0];
        if(!selected){
          output={ok:true,code:'ALL_11_APPLIED',visible:ONU20_visible_(store)};
          console.log('ONU_CORRECTION_RESULT '+JSON.stringify(output));return output;
        }
        baseline=ONU20_snapshot_(store);
        var source=store.rows.filter(function(r){return String(r.ticket_id)===selected.ticket_id;});
        if(source.length!==1)throw new Error('DUPLICATE_OR_MISSING_ID');
        ONU20_saveSnapshot_(props,selected.ticket_id,source[0]);
        request={action:'report_onu_correction_apply',request_id:'onu20-owner-'+Utilities.getUuid(),ticket_id:selected.ticket_id,
          expected:{source_version:selected.source_version,source_hash:selected.source_hash,before:selected.before}};
      }
      if(Date.now()-started>45000)throw new Error('PREFLIGHT_TIME_BUDGET_RETRY');
      // Durable exact request BEFORE mutation; hard timeout can be resumed
      // with the same request_id/expected, not with a new apply request.
      var next={request:request,baseline:baseline};
      if(Utilities.newBlob(JSON.stringify(next)).getBytes().length>8000)throw new Error('PENDING_SNAPSHOT_TOO_LARGE');
      props.setProperty(key,JSON.stringify(next));control=next;
      var result=ONU20_signed_(config,request);
      if(!result||!result.ok)throw new Error('CORRECTION_REJECTED');
      SpreadsheetApp.flush();
      var readback=reportStore_(config);ONU20_same_(baseline,readback);
      var p=reportOnuCorrectionPreview_(readback,request.ticket_id).items[0];
      var isApply=request.action==='report_onu_correction_apply';
      if(!p||isApply&&(p.state!=='APPLIED'||p.after.onu_used!==1||p.correction_id!==result.correction_id)||
        !isApply&&p.state==='APPLIED')throw new Error('CORRECTION_READBACK_FAILED');
      var visibleResult=ONU20_visible_(readback);
      // Clear only this helper's pending marker, never dispatcher receipts.
      props.deleteProperty(key);control=null;
      output={ok:true,code:isApply?'ONE_APPLIED':'ONE_ROLLED_BACK',ticket_id:request.ticket_id,
        onu_used_before:p.before.onu_used,onu_used_after:p.after.onu_used,
        onu_replacement_unchanged:p.before.onu_replacement===p.after.onu_replacement,
        total_before:p.total_before,total_after:p.total_after,money_unchanged:true,
        raw_rows_unchanged:true,receipts_unchanged:true,visible:visibleResult,
        next:isApply?'RUN_APPLY_NEXT_AGAIN_OR_VERIFY':'ROLLBACK_LAST_AGAIN_IF_REQUIRED'};
    }
  }catch(error){
    output={ok:false,code:ONU20_code_(error),stopped:true,pending_operation:!!control,
      next:control?'STOP; USE_RESUME_PENDING_FOR_INTERRUPTED_RENDER_OR_ROLLBACK_LAST':'STOP; DO_NOT_CHANGE_DATA'};
  }finally{if(locked)lock.releaseLock();}
  console.log('ONU_CORRECTION_RESULT '+JSON.stringify(output));return output;
}
