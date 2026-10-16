// September ONLY, owner/editor invocation, one existing correction/render per run.
// Requires the already installed ONU_Correction_Helper.gs utilities.
// No automatic calls, triggers, imports, new tickets or source-table writes.
function ONU_September_ApplyNext() { return ONUSeptemberRun_('apply'); }
function ONU_September_ResumePending() { return ONUSeptemberRun_('resume'); }
function ONU_September_RollbackLast() { return ONUSeptemberRun_('rollback'); }
function ONU_September_VerifyReadOnly() { return ONUSeptemberRun_('verify'); }
function ONUSeptemberIds_() {
  return ['c20da478-4aa7-48f0-8ed5-c41533b84a17','6cd36f12-102c-47d1-b23b-a6ebe4ef3a7f',
    '4a318a80-b562-4b8b-b514-c37e279849d8','711bbbb6-548b-4f24-87c6-4e920921a890',
    '7cf7d72a-aa05-4e03-bfaa-b2dc8344ae58','9c7d3974-1165-44dc-bffb-18c8a0b9c3e9',
    '98b3d7d8-4735-4adc-b087-4117bc80c7e7','7b41c24c-28a2-4bfe-83ee-5196a90d363d',
    'de173239-ad84-4ca1-8b2d-40879684f670','c2f623a0-e871-49ae-b576-caf938f2e157',
    '96973976-f8d8-4d71-b310-9549018e07c7','00eb1e82-fd6d-4363-8aba-1edbca528755',
    '5e069e10-ddc2-419a-8512-1983f3aee3d1','8818f766-97ba-48fd-97ca-bc0363f2093a',
    'e665e783-94b8-422b-b576-f707283366d8','836df114-ec94-4ee6-a7e2-d23c143d15b6',
    'c0c08af5-a103-4ed0-bdad-42f9c6c8e18d','1b6e8117-37a4-4d80-b173-da64e189e21b',
    'cfbf3824-3f22-4602-8bbd-775f57b72bad','585e60f5-88d4-4bbf-88f1-68a043c924e1'];
}
function ONUSeptemberClassify_(ticket) {
  // Exact modern/legacy precedence and matcher from production v92.23.
  // Modern OFF is NEVER overridden by a historical business default.
  if(ticket.onuAccountingVersion!==undefined){
    if(ticket.onuAccountingVersion!==1||!Array.isArray(ticket.equipment)||ticket.equipment.some(function(item){
      return !item||typeof item!=='object'||Array.isArray(item)||('checked' in item&&typeof item.checked!=='boolean');
    }))throw new Error('SOURCE_MODERN_SCHEMA_REVIEW');
    return ticket.equipment.some(function(item){return MTDispatcherReportCore.isOnuEquipment(item)&&item.checked!==false;})?
      {onu:1,reason:'MODERN_ON'}:{onu:0,reason:'MODERN_OFF'};
  }
  var word='(?:onu|ont|онт|ону)',owner='(?:сво(?:я|й|ю|е|и|его|ей)|его|её|ее|її|його|собственн(?:ая|ый|ую|ое|ой|ого)|власн(?:а|ий|у|е|ої|ого)|клиентск(?:ая|ий|ую|ое)|абонентск(?:ая|ий|ую|ое)|клиент|абонент|користувач)';
  var patterns=[
    new RegExp('(?<![\\p{L}\\p{N}_])'+owner+'\\s+'+word+'(?![\\p{L}\\p{N}_])','iu'),
    new RegExp('(?<![\\p{L}\\p{N}_])'+word+'\\s+(?:клиента|клиенту|абонента|абоненту|пользователя|користувача|користувачу)(?![\\p{L}\\p{N}_])','iu'),
    new RegExp('(?<![\\p{L}\\p{N}_])(?:сам(?:остоятельно)?|сама|самостійно)\\s+(?:купил|купила|купили|покупал|покупала|приобрел|приобрела|придбав|придбала|купив)\\s+(?:(?:себе|собі)\\s+)?'+word+'(?![\\p{L}\\p{N}_])','iu'),
    new RegExp('(?<![\\p{L}\\p{N}_])'+word+'\\s+(?:сам|сама)\\s+(?:купил|купила|купили|покупал|покупала|приобрел|приобрела|придбав|придбала|купив)(?![\\p{L}\\p{N}_])','iu')
  ];
  var text=[ticket.content,ticket.note,ticket.otherNote].concat((Array.isArray(ticket.equipment)?ticket.equipment:[]).map(function(e){return e&&e.label;}))
    .filter(function(v){return typeof v==='string'&&v.trim();}).join('\n').normalize('NFKC').toLocaleLowerCase('uk-UA').replace(/ё/gu,'е').replace(/[’‘`]/gu,"'");
  var customer=text.split(/[\n.!?;]+/u).some(function(sentence){return patterns.some(function(pattern){
    var match=pattern.exec(sentence);return match&&!/(?:^|[^\p{L}\p{N}_])не\s*$/u.test(sentence.slice(0,match.index));
  });});
  return customer?{onu:0,reason:'EXPLICIT_CUSTOMER_ONU'}:{onu:1,reason:'LEGACY_DEFAULT_OUR_ONU'};
}
function ONUSeptemberSource_() {
  var ss=SpreadsheetApp.openById('1fc_yXm7XihQn7medg8H25a9cxBn_HIqMhXx-rZyVD5M');
  var sheet=ss.getSheetByName('Заявки');if(!sheet)throw new Error('PRIMARY_SHEET_MISSING');
  var last=sheet.getLastRow(),width=sheet.getLastColumn();
  if(last>10001||width<8||width>100)throw new Error('PRIMARY_SCHEMA_OR_CAPACITY');
  var data=sheet.getRange(1,1,last,width).getDisplayValues(),headers=data.shift();
  if(headers.slice(0,6).join(',')!=='id,date,time,content,sum,tags')throw new Error('PRIMARY_SCHEMA_CHANGED');
  var column=headers.findIndex(function(h){return /^(?:fullDataJson|повніДаніJSON)$/iu.test(h);});
  // The supplied original Заявки CSV has the persisted canonical JSON in
  // column H with a blank heading. Accept ONLY that exact legacy layout.
  if(column<0&&headers[7]==='')column=7;
  if(column<0)throw new Error('CANONICAL_COLUMN_MISSING');
  var ids=ONUSeptemberIds_(),map=new Map(),connections=[];
  data.forEach(function(cells){
    var date=MTDispatcherReportCore.dateKey(cells[1]);if(!/^2026-09-/.test(date))return;
    var full;try{full=JSON.parse(cells[column]);}catch(e){throw new Error('SEPTEMBER_CANONICAL_JSON_REQUIRED');}
    if(!full||typeof full!=='object'||Array.isArray(full))throw new Error('SEPTEMBER_CANONICAL_JSON_REQUIRED');
    if(!/^п[іо]дключен(?:ня|ие)$/iu.test(String(full.type||'')))return;
    var id=String(cells[0]);connections.push(id);
    if(ids.indexOf(id)<0)throw new Error('UNREVIEWED_SEPTEMBER_CONNECTION');
    if(map.has(id))throw new Error('DUPLICATE_PRIMARY_ID');
    var decision=ONUSeptemberClassify_(Object.assign({},full,{content:cells[3]}));
    map.set(id,{ticket_id:id,date:date,time:cells[2],onu:decision.onu,reason:decision.reason,
      source_hash:ONU20_hash_(cells)});
  });
  if(connections.length!==ids.length||ids.some(function(id){return !map.has(id);}))throw new Error('PRIMARY_CONNECTION_SET_CHANGED');
  return map;
}
function ONUSeptemberPreflight_(store,source) {
  return ONUSeptemberIds_().map(function(id){
    var canonical=source.get(id),row=store.rows.filter(function(r){return String(r.ticket_id)===id&&!r.deleted_at;});
    if(row.length!==1)throw new Error('SEPTEMBER_ACTIVE_ROW_MISSING_OR_DUPLICATE');
    if(row[0].work_date!==canonical.date||row[0].work_time!==canonical.time||row[0].work_category!=='connection')throw new Error('SEPTEMBER_SOURCE_REPORT_MISMATCH');
    var target=REPORT_ONU_CORRECTION_TARGETS[id];
    if(!target||target.work_category!=='connection'||target.onu_used!==canonical.onu)throw new Error('SOURCE_POLICY_CHANGED_STOP');
    var p=reportOnuCorrectionPreview_(store,id).items[0];
    if(!p||['READY','NO_CHANGE','APPLIED'].indexOf(p.state)<0)throw new Error('SEPTEMBER_CORRECTION_CONFLICT');
    if(JSON.stringify(p.after)!==JSON.stringify(Object.assign({},p.before,target))||p.total_before!==p.total_after)throw new Error('PROTECTED_FIELD_CHANGED');
    return p;
  });
}
function ONUSeptemberControl_(store,strict) {
  var report=MTDispatcherReportCore.render(reportOnuCorrectionEffectiveRows_(store.ss,store.rows));
  var sep=report.monthly['2026-09'],oct=report.monthly['2026-10'];
  if(!sep||!oct)throw new Error('CURRENT_MONTHLY_CONTROL_MISSING');
  if(strict!==false&&(sep.connections!==20||sep.onu_repair!==8||sep.total!==46115||oct.onu_connection!==7||oct.onu_repair!==5||oct.total!==20186))throw new Error('CURRENT_MONTHLY_CONTROL_MISMATCH');
  return ONU20_hash_({oct:oct,sepMoney:[sep.total,sep.payment_cash,sep.payment_cashless,sep.payment_free_amount]});
}
function ONUSeptemberRun_(mode) {
  var key='ONU-SEP26-CONTROL-V1',lock,locked=false,control=null,props,output,started=Date.now();
  try{
    if(typeof ONU20_signed_!=='function'||typeof ONU20_visible_!=='function')throw new Error('ORIGINAL_CORRECTION_HELPER_REQUIRED');
    var config=reportAuthorize_();if(config.id!=='1auELr1O8ThLimp9kU5xoD7v6VQHf1knOMTOlAjCHVpA')throw new Error('WRONG_SPREADSHEET');
    props=PropertiesService.getScriptProperties();lock=LockService.getScriptLock();locked=lock.tryLock(1000);if(!locked)throw new Error('BUSY');
    var store=reportStore_(config);if(reportReceiptJournal_(store).pending().length)throw new Error('REPORT_COMMIT_UNRESOLVED');
    control=JSON.parse(props.getProperty(key)||'null');
    var rollbackFlow=mode==='rollback'||mode==='resume'&&control&&control.request.action==='report_onu_correction_rollback';
    var source=rollbackFlow?new Map():ONUSeptemberSource_(),all=rollbackFlow?null:ONUSeptemberPreflight_(store,source);
    if(mode==='verify'){
      output={ok:true,mode:'READ_ONLY',applied:all.filter(function(p){return p.state==='APPLIED';}).length,pending:!!control,visible:ONU20_visible_(store)};
    }else{
      var request,baseline,sourceHash,monthlyHash;
      if(mode==='resume'){
        if(!control)throw new Error('NO_PENDING_OPERATION');
        request=control.request;baseline=control.baseline;sourceHash=control.sourceHash;monthlyHash=control.monthlyHash;
        ONU20_same_(baseline,store);
      }else if(mode==='rollback'){
        if(control&&control.request.action==='report_onu_correction_rollback')throw new Error('USE_RESUME_PENDING');
        var journal=reportOnuCorrectionJournal_(store.ss,false),active=reportOnuCorrectionActive_(journal);
        var owned=journal.rows.filter(function(e){return e.operation==='APPLY'&&String(e.request_id).indexOf('onu-sep26-')===0&&active.get(String(e.ticket_id))===e&&ONUSeptemberIds_().indexOf(String(e.ticket_id))>=0;});
        if(!owned.length)throw new Error('NO_SEPTEMBER_CORRECTION_TO_ROLLBACK');
        var last=owned[owned.length-1];if(control&&control.request.ticket_id!==String(last.ticket_id))throw new Error('PENDING_OTHER_ID');
        request={action:'report_onu_correction_rollback',request_id:'onu-sep26-rollback-'+Utilities.getUuid(),ticket_id:String(last.ticket_id),correction_id:String(last.request_id)};
        baseline=ONU20_snapshot_(store);sourceHash=ONU20_hash_(Array.from(source));monthlyHash=ONUSeptemberControl_(store,false);
      }else{
        if(control)throw new Error('PENDING_OPERATION_STOP');
        monthlyHash=ONUSeptemberControl_(store);
        var next=all.filter(function(p){return p.state!=='APPLIED';})[0];
        if(!next){output={ok:true,code:'ALL_SEPTEMBER_APPLIED',visible:ONU20_visible_(store)};console.log('ONU_SEPTEMBER_RESULT '+JSON.stringify(output));return output;}
        ONU20_saveSnapshot_(props,next.ticket_id,store.rows.filter(function(r){return String(r.ticket_id)===next.ticket_id;})[0]);
        request={action:'report_onu_correction_apply',request_id:'onu-sep26-'+Utilities.getUuid(),ticket_id:next.ticket_id,expected:{source_version:next.source_version,source_hash:next.source_hash,before:next.before}};
        baseline=ONU20_snapshot_(store);sourceHash=ONU20_hash_(Array.from(source));
      }
      if(ONUSeptemberIds_().indexOf(request.ticket_id)<0||sourceHash!==ONU20_hash_(Array.from(source)))throw new Error('PRIMARY_SOURCE_CHANGED_STOP');
      if(Date.now()-started>45000)throw new Error('PREFLIGHT_TIME_BUDGET_RETRY');
      control={request:request,baseline:baseline,sourceHash:sourceHash,monthlyHash:monthlyHash};
      if(Utilities.newBlob(JSON.stringify(control)).getBytes().length>8000)throw new Error('PENDING_SNAPSHOT_TOO_LARGE');
      props.setProperty(key,JSON.stringify(control));
      var result=ONU20_signed_(config,request);if(!result||!result.ok)throw new Error('CORRECTION_REJECTED');
      SpreadsheetApp.flush();var readback=reportStore_(config);ONU20_same_(baseline,readback);
      if(ONUSeptemberControl_(readback,false)!==monthlyHash)throw new Error('MONEY_OR_OCTOBER_CHANGED_STOP');
      if(!rollbackFlow&&ONU20_hash_(Array.from(ONUSeptemberSource_()))!==sourceHash)throw new Error('PRIMARY_SOURCE_CHANGED_STOP');
      var p=reportOnuCorrectionPreview_(readback,request.ticket_id).items[0],apply=request.action==='report_onu_correction_apply';
      if(apply&&(p.state!=='APPLIED'||p.after.onu_used!==1||p.correction_id!==result.correction_id)||!apply&&p.state==='APPLIED')throw new Error('READBACK_FAILED');
      var visible=ONU20_visible_(readback);props.deleteProperty(key);control=null;
      output={ok:true,code:apply?'ONE_SEPTEMBER_APPLIED':'ONE_SEPTEMBER_ROLLED_BACK',ticket_id:request.ticket_id,
        onu_used_before:p.before.onu_used,onu_used_after:p.after.onu_used,money_unchanged:true,raw_rows_unchanged:true,
        receipts_unchanged:true,october_unchanged:true,visible:visible};
    }
  }catch(error){output={ok:false,code:ONU20_code_(error),stopped:true,pending_operation:!!control};}
  finally{if(locked)lock.releaseLock();}
  console.log('ONU_SEPTEMBER_RESULT '+JSON.stringify(output));return output;
}
