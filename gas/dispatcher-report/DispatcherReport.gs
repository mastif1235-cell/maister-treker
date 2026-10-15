/* ONLY the separate dispatcher Apps Script project. Legacy Code.gs untouched.
   v91.95 direct transport: deployment MUST execute as the owner
   (webapp executeAs USER_DEPLOYING, access ANYONE). Every mutation request is
   authenticated by the signed MT-SYNC-HMAC-V3 envelope (secret property
   MT_DISPATCHER_HMAC_SECRET, >=32 chars) — never by Google session identity.
   The legacy HtmlService bridge (reportDispatch) is READ-ONLY: report_status
   only; mutations there fail closed with REPORT_DIRECT_TRANSPORT_REQUIRED.
   The private spreadsheet stays private: only this script opens it.
   Script Properties: REPORT_SPREADSHEET_ID, REPORT_ALLOWED_EMAIL,
   REPORT_ALLOWED_ORIGINS (comma-separated origins), MT_DISPATCHER_HMAC_SECRET.
   No other client secrets. */
var REPORT_LEGACY_HEADERS=MTDispatcherReportCore.FIELDS.concat(['deleted_at','sync_status']);
// Append only: every existing column and legacy content hash stays unchanged.
var REPORT_HEADERS=REPORT_LEGACY_HEADERS.concat(['materials_json','contract_number','service_fee','tariff_amount','client_name','client_phone','works_display']);
function reportStoredHeaders_(sheet){
  if(JSON.stringify(sheet.getRange(1,1,1,REPORT_LEGACY_HEADERS.length).getValues()[0])!==JSON.stringify(REPORT_LEGACY_HEADERS))throw new Error('REPORT_SCHEMA_CONFLICT');
  var headers=REPORT_LEGACY_HEADERS.slice(),gap=false;
  for(var i=REPORT_LEGACY_HEADERS.length;i<REPORT_HEADERS.length;i++){
    var value=sheet.getMaxColumns()>i?sheet.getRange(1,i+1,1,1).getValues()[0][0]:'';
    if(!value){gap=true;continue;}
    if(gap||value!==REPORT_HEADERS[i])throw new Error('REPORT_SCHEMA_CONFLICT');
    headers.push(value);
  }
  return headers;
}
function reportExtendHeaders_(sheet){
  if(sheet.getLastRow()>0)reportStoredHeaders_(sheet);
  if(sheet.getMaxColumns()<REPORT_HEADERS.length)sheet.insertColumnsAfter(sheet.getMaxColumns(),REPORT_HEADERS.length-sheet.getMaxColumns());
  sheet.getRange(1,1,1,REPORT_HEADERS.length).setValues([REPORT_HEADERS]);
}
var REPORT_ACTIONS=['report_upsert','report_sync_all','report_delete','report_rebuild','report_status','report_receipt','report_onu_correction_preview','report_onu_correction_apply','report_onu_correction_rollback'];
// User-confirmed repairs and the six connections verified in the current
// primary Заявки sheet on 2026-10-15. Archive rows and MAC inference are excluded.
var REPORT_ONU_CORRECTION_TARGETS=Object.freeze({
  '1774458317612':Object.freeze({work_type:'Ремонт',work_category:'repair',onu_used:1}),
  '1774458317619':Object.freeze({work_type:'Ремонт',work_category:'repair',onu_used:1}),
  '1783937356212':Object.freeze({work_type:'Ремонт',work_category:'repair',onu_used:1}),
  '1783937356227':Object.freeze({work_type:'Ремонт',work_category:'repair',onu_used:1}),
  '1783937356219':Object.freeze({work_type:'Ремонт',work_category:'repair',onu_used:1}),
  '9a61c8b5-f8c8-4f0a-9446-d8e7cbfadf21':Object.freeze({work_type:'Підключення',work_category:'connection',onu_used:1}),
  'f22710e7-1142-49f5-a2b1-7f4a6e54fe94':Object.freeze({work_type:'Підключення',work_category:'connection',onu_used:1}),
  'a65dd9a4-fefb-4381-be39-8b1b0ed8d793':Object.freeze({work_type:'Підключення',work_category:'connection',onu_used:1}),
  'ac5bb18a-cd71-4e9e-97d9-bdf57353d921':Object.freeze({work_type:'Підключення',work_category:'connection',onu_used:1}),
  '2edc4344-42ed-44d8-9e10-384126505bcf':Object.freeze({work_type:'Підключення',work_category:'connection',onu_used:1}),
  '8b933540-b8e2-4493-8020-75754fb5ebec':Object.freeze({work_type:'Підключення',work_category:'connection',onu_used:1})
});
// Keep the existing phone preview limited to its five repairs. Connections are
// prepared individually via signed preview(ticket_id), without a frontend release.
var REPORT_ONU_CORRECTION_REPAIR_IDS=Object.keys(REPORT_ONU_CORRECTION_TARGETS).filter(function(id){return REPORT_ONU_CORRECTION_TARGETS[id].work_category==='repair';});
var REPORT_ONU_CORRECTION_HEADERS=['request_id','request_hash','operation','ticket_id','source_version','source_hash','before_json','after_json','target_request_id','result_json','created_at'];
function reportOnuCorrectionJournal_(ss,create){
  var sheet=ss.getSheetByName('_DispatcherOnuCorrections');
  if(sheet&&JSON.stringify(sheet.getRange(1,1,1,REPORT_ONU_CORRECTION_HEADERS.length).getValues()[0])!==JSON.stringify(REPORT_ONU_CORRECTION_HEADERS))throw new Error('REPORT_ONU_CORRECTION_SCHEMA');
  if(!sheet&&create){sheet=ss.insertSheet('_DispatcherOnuCorrections');sheet.getRange(1,1,1,REPORT_ONU_CORRECTION_HEADERS.length).setValues([REPORT_ONU_CORRECTION_HEADERS]);sheet.hideSheet();}
  var last=sheet?sheet.getLastRow():1,values=sheet&&last>1?sheet.getRange(2,1,last-1,REPORT_ONU_CORRECTION_HEADERS.length).getValues():[];
  return {sheet:sheet,rows:values.map(function(v,i){var row={};REPORT_ONU_CORRECTION_HEADERS.forEach(function(k,j){row[k]=v[j];});row._row=i+2;return row;}),append:function(event){
    if(!sheet)throw new Error('REPORT_ONU_CORRECTION_JOURNAL_MISSING');
    if(last>=100001)throw new Error('REPORT_ONU_CORRECTION_CAPACITY');
    if(sheet.getMaxRows()<last+1)sheet.insertRowsAfter(sheet.getMaxRows(),1);
    var row=last+1;sheet.getRange(row,1,1,REPORT_ONU_CORRECTION_HEADERS.length).setNumberFormat('@').setValues([REPORT_ONU_CORRECTION_HEADERS.map(function(k){return event[k]===undefined?'':event[k];})]);SpreadsheetApp.flush();
    var written=sheet.getRange(row,1,1,REPORT_ONU_CORRECTION_HEADERS.length).getValues()[0];return written;
  }};
}
function reportOnuCorrectionActive_(journal){
  var active=new Map();journal.rows.forEach(function(e){
    if(e.operation==='APPLY')active.set(String(e.ticket_id),e);
    else if(e.operation==='ROLLBACK'&&active.get(String(e.ticket_id))&&String(active.get(String(e.ticket_id)).request_id)===String(e.target_request_id))active.delete(String(e.ticket_id));
  });return active;
}
function reportOnuCorrectionEvidence_(row){
  var evidence={};['work_date','work_time','work_type','work_category','onu_used','onu_replacement','mac_onu','dispatcher_comment'].forEach(function(k){evidence[k]=row[k]===undefined?'':row[k];});
  // Prices are not physical evidence. Preserve repricing just like total/payment
  // updates, while guarding material identities/quantities and work descriptions.
  evidence.materials=(row.materials_json?MTDispatcherReportCore.readMaterials(row.materials_json):[]).map(function(m){return {label:m.label,quantity:m.quantity,unit:m.unit};});
  function physicalText(value){return String(value||'').replace(/\s*(?:—|×|x)\s*[\d\s.,]+\s*грн(?:\/\S+)?/giu,'').trim();}
  evidence.materials_display=physicalText(row.materials_display);evidence.works_display=physicalText(row.works_display);return evidence;
}
function reportOnuCorrectionBefore_(row){
  return {work_type:row.work_type,work_category:row.work_category,onu_used:row.onu_used,onu_replacement:row.onu_replacement,total:row.total,source_evidence:reportOnuCorrectionEvidence_(row)};
}
function reportOnuCorrectionPatch_(event,row){
  var before=JSON.parse(event.before_json),after=JSON.parse(event.after_json),target=REPORT_ONU_CORRECTION_TARGETS[String(row.ticket_id)];
  if(!before.source_evidence||JSON.stringify(before.source_evidence)!==JSON.stringify(reportOnuCorrectionEvidence_(row)))throw new Error('ONU_CORRECTION_SOURCE_CONFLICT');
  if(!target||['work_type','work_category','onu_used'].some(function(k){return after[k]!==target[k];}))throw new Error('ONU_CORRECTION_CONFLICT');
  // Never merge snapshot JSON: money, replacement, materials and every other
  // field must always come from the current source row, including old journals.
  return {work_type:after.work_type,work_category:after.work_category,onu_used:after.onu_used};
}
function reportOnuCorrectionEffectiveRows_(ss,rows){
  var active=reportOnuCorrectionActive_(reportOnuCorrectionJournal_(ss,false));
  return rows.map(function(row){var event=active.get(String(row.ticket_id));return event&&!row.deleted_at?Object.assign({},row,reportOnuCorrectionPatch_(event,row)):row;});
}
function reportOnuCorrectionPreview_(store,ticketId){
  if(ticketId!==undefined&&!Object.prototype.hasOwnProperty.call(REPORT_ONU_CORRECTION_TARGETS,ticketId))throw new Error('INVALID_ONU_CORRECTION');
  var journal=reportOnuCorrectionJournal_(store.ss,false),active=reportOnuCorrectionActive_(journal),items=(ticketId===undefined?REPORT_ONU_CORRECTION_REPAIR_IDS:[ticketId]).map(function(id){
    var target=REPORT_ONU_CORRECTION_TARGETS[id],row=store.rows.find(function(r){return String(r.ticket_id)===id;});
    if(!row||row.deleted_at)return {ticket_id:id,state:'NOT_ACTIVE',code:'ROW_NOT_ACTIVE'};
    var saved=active.get(id),before=reportOnuCorrectionBefore_(row),after=Object.assign({},before,target),state=saved?'APPLIED':JSON.stringify(before)===JSON.stringify(after)?'NO_CHANGE':'READY',code='OK';
    if(saved)try{after=Object.assign({},before,reportOnuCorrectionPatch_(saved,row));}catch(e){state='CONFLICT';code=reportErrorCode_(e);after=before;}
    return {ticket_id:id,date:row.work_date,time:row.work_time,state:state,code:code,source_version:row.source_version,source_hash:row.source_hash,before:before,after:after,total_before:row.total,total_after:row.total,correction_id:saved?String(saved.request_id):''};
  });
  return {ok:true,code:'OK',items:items};
}
function reportOnuCorrectionExecute_(store,request,requestHash){
  function renderCurrent(){
    reportRender_(store.ss,store.rows);
    var p=PropertiesService.getScriptProperties();if(/^ONU_CORRECTION_[A-Z_]+$/.test(String(p.getProperty('REPORT_LAST_ERROR')||'')))p.deleteProperty('REPORT_LAST_ERROR');
  }
  var isApply=request.action==='report_onu_correction_apply',isRollback=request.action==='report_onu_correction_rollback',id=String(request.ticket_id||''),target=REPORT_ONU_CORRECTION_TARGETS[id];
  if(isApply){
    if(Object.keys(request).sort().join(',')!=='action,expected,request_id,ticket_id'||!target||!request.expected||Object.keys(request.expected).sort().join(',')!=='before,source_hash,source_version'||!request.expected.before||Object.keys(request.expected.before).sort().join(',')!=='onu_replacement,onu_used,source_evidence,total,work_category,work_type'||!Number.isSafeInteger(request.expected.source_version)||!/^[a-f0-9]{64}$/.test(request.expected.source_hash))throw new Error('INVALID_ONU_CORRECTION');
  }else if(isRollback){
    if(Object.keys(request).sort().join(',')!=='action,correction_id,request_id,ticket_id'||!target||typeof request.correction_id!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(request.correction_id))throw new Error('INVALID_ONU_CORRECTION');
  }else throw new Error('INVALID_ONU_CORRECTION');
  var journal=reportOnuCorrectionJournal_(store.ss,false),priorRequest=journal.rows.find(function(e){return String(e.request_id)===request.request_id;});
  if(priorRequest&&priorRequest.request_hash!==requestHash)throw new Error('INVALID_REQUEST_ID');
  var active=reportOnuCorrectionActive_(journal),current=active.get(id),result,operation,before={},after={},source=null,targetRequest='';
  source=store.rows.find(function(r){return String(r.ticket_id)===id;});if(!source||source.deleted_at)throw new Error('ROW_NOT_ACTIVE');
  if(priorRequest){
    if(isApply&&(!current||String(current.request_id)!==request.request_id)||isRollback&&current)throw new Error('ONU_CORRECTION_SUPERSEDED');
    var replay=isApply?Object.assign({},source,reportOnuCorrectionPatch_(current,source)):source;
    renderCurrent();return Object.assign({},JSON.parse(priorRequest.result_json),{onu_used:replay.onu_used,onu_replacement:source.onu_replacement,work_type:replay.work_type,work_category:replay.work_category,total:Number(source.total)});
  }
  if(isApply){
    if(current){reportOnuCorrectionPatch_(current,source);renderCurrent();return {ok:true,code:'ALREADY_APPLIED',ticket_id:id,onu_used:target.onu_used,onu_replacement:source.onu_replacement,work_type:target.work_type,work_category:target.work_category,total:Number(source.total),correction_id:String(current.request_id)};}
    if(source.source_version!==request.expected.source_version||source.source_hash!==request.expected.source_hash)throw new Error('STALE_VERSION');
    before=reportOnuCorrectionBefore_(source);
    if(JSON.stringify(before)!==JSON.stringify(request.expected.before))throw new Error('STALE_VERSION');
    after={work_type:target.work_type,work_category:target.work_category,onu_used:target.onu_used};operation='APPLY';
  }else{
    if(!current||String(current.request_id)!==request.correction_id)throw new Error('ONU_CORRECTION_NOT_ACTIVE');
    source=store.rows.find(function(r){return String(r.ticket_id)===id;});if(!source||source.deleted_at)throw new Error('ROW_NOT_ACTIVE');
    before=reportOnuCorrectionBefore_(source);after=before;operation='ROLLBACK';targetRequest=String(current.request_id);
  }
  result={ok:true,code:operation==='APPLY'?'APPLIED':'ROLLED_BACK',ticket_id:id,onu_used:after.onu_used,onu_replacement:source.onu_replacement,work_type:after.work_type,work_category:after.work_category,total:Number(source.total),correction_id:operation==='APPLY'?request.request_id:targetRequest};
  var event={request_id:request.request_id,request_hash:requestHash,operation:operation,ticket_id:id,source_version:source.source_version,source_hash:source.source_hash,before_json:JSON.stringify(before),after_json:JSON.stringify(after),target_request_id:targetRequest,result_json:JSON.stringify(result),created_at:new Date().toISOString()};
  if(!journal.sheet)journal=reportOnuCorrectionJournal_(store.ss,true);
  journal.append(event);
  var checked=reportOnuCorrectionJournal_(store.ss,false),nowActive=reportOnuCorrectionActive_(checked).get(id);
  if(operation==='APPLY'&&(!nowActive||String(nowActive.request_id)!==request.request_id||Object.keys(target).some(function(k){return JSON.parse(nowActive.after_json)[k]!==target[k];})))throw new Error('ONU_CORRECTION_READBACK_MISMATCH');
  if(operation==='ROLLBACK'&&nowActive)throw new Error('ONU_CORRECTION_READBACK_MISMATCH');
  renderCurrent();return result;
}
// Durable write-ahead receipts, separate from ticket schema and CacheService.
// No payload/PII: identity/hash, exact item ACKs and commit evidence only.
function reportReceiptJournal_(store){
  var headers=['request_key','request_hash','result_json','evidence_json','state','created_at'];
  var sheet=store.ss.getSheetByName('_DispatcherReceipts');
  if(sheet&&JSON.stringify(sheet.getRange(1,1,1,6).getValues()[0])!==JSON.stringify(headers))throw new Error('REPORT_RECEIPT_SCHEMA');
  var last=sheet?sheet.getLastRow():1,values=sheet&&last>1?sheet.getRange(2,1,last-1,6).getValues():[];
  return {pending:function(){return values.map(function(v,i){return {v:v,row:i+2};}).filter(function(r){return r.v[4]==='PREPARED';});},
    find:function(id){var key='request:'+id,found=values.map(function(v,i){return {v:v,row:i+2};}).filter(function(r){return r.v[0]===key;});if(found.length>1)throw new Error('REPORT_RECEIPT_CONFLICT');return found[0]||null;},
    prepare:function(id,hash,result,evidence){
      var resultJson=JSON.stringify(result),evidenceJson=JSON.stringify(evidence);
      if(last>=100001||resultJson.length>45000||evidenceJson.length>45000)throw new Error('REPORT_RECEIPT_CAPACITY');
      // Lazy creation: checking a missing receipt before nonce verification
      // must be read-only, including for a rejected replayed nonce.
      if(!sheet){sheet=store.ss.insertSheet('_DispatcherReceipts');sheet.getRange(1,1,1,6).setValues([headers]);sheet.hideSheet();}
      if(sheet.getMaxRows()<last+1)sheet.insertRowsAfter(sheet.getMaxRows(),1);
      var row=last+1;sheet.getRange(row,1,1,6).setNumberFormat('@').setValues([['request:'+id,hash,resultJson,evidenceJson,'PREPARED',new Date().toISOString()]]);
      SpreadsheetApp.flush();return {v:['request:'+id,hash,resultJson,evidenceJson,'PREPARED'],row:row};
    },commit:function(receipt){sheet.getRange(receipt.row,5).setValue('COMMITTED');SpreadsheetApp.flush();}};
}
function reportEvidence_(rows,result){return result.items.filter(function(i){return i.code==='OK';}).map(function(i){var r=rows.find(function(r){return r.ticket_id===i.ticket_id;});return {ticket_id:r.ticket_id,source_version:r.source_version,source_hash:r.source_hash,sync_status:r.sync_status,deleted_at:r.deleted_at||''};});}
function reportEvidenceMatches_(rows,evidence){return evidence.every(function(e){var r=rows.find(function(r){return r.ticket_id===e.ticket_id;});return !!r&&r.source_version===e.source_version&&r.source_hash===e.source_hash&&r.sync_status===e.sync_status&&(r.deleted_at||'')===e.deleted_at;});}
function reportRecoverPrepared_(store,request,evidence){
  if(reportEvidenceMatches_(store.rows,evidence))return;
  // A write that definitely did not persist may be resumed, but only for the
  // originally successful items and with the original stale-version fences.
  // Never re-evaluate rejected siblings or overwrite a newer/conflicting row.
  var dtos=request.action==='report_upsert'?[request.ticket]:request.tickets||[];
  try{
    evidence.forEach(function(e){
      if(reportEvidenceMatches_(store.rows,[e]))return;
      if(e.deleted_at){
        if(!(request.deletes||[]).some(function(d){return d.ticket_id===e.ticket_id&&d.source_version===e.source_version;}))throw new Error('REPORT_COMMIT_UNRESOLVED');
        MTDispatcherReportCore.remove(store.rows,e.ticket_id,e.source_version,e.deleted_at);
      }else{
        var dto=dtos.find(function(d){return d&&d.ticket_id===e.ticket_id&&d.source_version===e.source_version&&d.source_hash===e.source_hash;});
        if(!dto||reportHash_(dto)!==e.source_hash)throw new Error('REPORT_COMMIT_UNRESOLVED');
        MTDispatcherReportCore.upsert(store.rows,dto);
      }
    });
    if(!reportEvidenceMatches_(store.rows,evidence))throw new Error('REPORT_COMMIT_UNRESOLVED');
  }catch(_){throw new Error('REPORT_COMMIT_UNRESOLVED');}
  reportWrite_(store);SpreadsheetApp.flush();
}
function reportBestEffort_(c,code,fn){try{fn();return true;}catch(error){if(/^ONU_CORRECTION_[A-Z_]+$/.test(String(error&&error.message||'')))code=error.message;try{console.warn(JSON.stringify({scope:'dispatcher-report',code:code}));c.p.setProperty('REPORT_LAST_ERROR',code);}catch(ignored){}return false;}}
function reportConfig_(){
  var p=PropertiesService.getScriptProperties(),email=String(p.getProperty('REPORT_ALLOWED_EMAIL')||'').toLowerCase();
  var id=String(p.getProperty('REPORT_SPREADSHEET_ID')||''),origins=String(p.getProperty('REPORT_ALLOWED_ORIGINS')||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
  if(!id||!email||!origins.length)throw new Error('REPORT_NOT_CONFIGURED');return {id:id,email:email,origins:origins,p:p};
}
function reportAuthorize_(){
  var c=reportConfig_(),active=String(Session.getActiveUser().getEmail()||'').toLowerCase();
  if(!active||active!==c.email)throw new Error('UNAUTHORIZED');return c;
}
function reportSetup(){
  // User runs this once in this bound project after granting Google consent.
  // The explicit ID and identity are server-side config, not credentials.
  if(String(Session.getActiveUser().getEmail()||'').toLowerCase()!=='mastif1235@gmail.com')throw new Error('UNAUTHORIZED');
  var p=PropertiesService.getScriptProperties();
  p.setProperties({REPORT_SPREADSHEET_ID:'1auELr1O8ThLimp9kU5xoD7v6VQHf1knOMTOlAjCHVpA',REPORT_ALLOWED_EMAIL:'mastif1235@gmail.com',REPORT_ALLOWED_ORIGINS:'https://mastif1235-cell.github.io'});
  var c=reportAuthorize_(),ss=SpreadsheetApp.openById(c.id);
  // Refuse to touch a legacy workbook even if configured incorrectly.
  if(ss.getSheetByName('Заявки')||ss.getSheetByName('Зміни'))throw new Error('LEGACY_WORKBOOK_FORBIDDEN');
  var visible=ss.getSheetByName('Отчет');
  if(!visible){var existing=ss.getSheets();if(existing.length===1&&existing[0].getLastRow()===0){visible=existing[0];visible.setName('Отчет');}else visible=ss.insertSheet('Отчет');}
  var data=ss.getSheetByName('_DispatcherData')||ss.insertSheet('_DispatcherData');
  reportExtendHeaders_(data);data.hideSheet();
  var store=reportStore_(c);reportRender_(ss,store.rows);return {ok:true,code:'READY',active_count:store.rows.filter(function(r){return !r.deleted_at;}).length};
}
function reportStore_(c){
  var ss=SpreadsheetApp.openById(c.id);
  if(ss.getSheetByName('Заявки')||ss.getSheetByName('Зміни'))throw new Error('LEGACY_WORKBOOK_FORBIDDEN');
  var sheet=ss.getSheetByName('_DispatcherData');if(!sheet||!ss.getSheetByName('Отчет'))throw new Error('REPORT_NOT_INITIALIZED');
  var headers=reportStoredHeaders_(sheet);
  if(sheet.getLastRow()>10001)throw new Error('REPORT_CAPACITY');
  var values=sheet.getLastRow()>1?sheet.getRange(2,1,sheet.getLastRow()-1,headers.length).getValues():[];
  var rows=values.map(function(v){var r={};headers.forEach(function(k,i){if(MTDispatcherReportCore.FIELDS.includes(k)||k==='deleted_at'||k==='sync_status'||v[i]!=='')r[k]=v[i];});return r;});
  var seen=new Set();rows.forEach(function(r){if(seen.has(r.ticket_id))throw new Error('DUPLICATE_STORED_ID');seen.add(r.ticket_id);if(!r.deleted_at){var dto={};MTDispatcherReportCore.ALL_FIELDS.forEach(function(k){if(r[k]!==undefined)dto[k]=r[k];});MTDispatcherReportCore.validate(dto);if(reportHash_(dto)!==dto.source_hash)throw new Error('HASH_MISMATCH');}});
  return {ss:ss,sheet:sheet,rows:rows};
}
function reportHash_(dto){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,MTDispatcherReportCore.content(dto),Utilities.Charset.UTF_8).map(function(n){return ((n+256)%256).toString(16).padStart(2,'0');}).join('');}
function reportWrite_(store){
  var rows=store.rows;if(rows.length>10000)throw new Error('REPORT_CAPACITY');
  reportExtendHeaders_(store.sheet);
  if(store.sheet.getMaxRows()<rows.length+1)store.sheet.insertRowsAfter(store.sheet.getMaxRows(),rows.length+1-store.sheet.getMaxRows());
  if(rows.length){var range=store.sheet.getRange(2,1,rows.length,REPORT_HEADERS.length);range.setNumberFormat('@');
    // Reject formula-looking text BEFORE storage; never rely on formatting
    // alone to prevent Spreadsheet formula injection.
    range.setValues(rows.map(function(r){return REPORT_HEADERS.map(function(k){return r[k]===undefined?'':r[k];});}));}
}
function reportRender_(ss,rows){
  var sheet=ss.getSheetByName('Отчет');if(!sheet)throw new Error('REPORT_NOT_INITIALIZED');
  rows=reportOnuCorrectionEffectiveRows_(ss,rows);
  var layout=MTDispatcherReportCore.render(rows).layout,blocks=layout.rows;
  // Prepare every RichText value before any sheet mutation. API/build failures
  // must leave the existing visible report intact.
  var richValues=[];
  if(blocks.length){
    var bold=SpreadsheetApp.newTextStyle().setBold(true).build();
    richValues=blocks.map(function(b){
      var text=String(b.text||''),nl=text.indexOf('\n'),rich=SpreadsheetApp.newRichTextValue().setText(text);
      if(b.kind==='ticket'&&nl>0)rich.setTextStyle(0,nl,bold);
      return [rich.build()];
    });
  }
  // Only owned A:E, including old merged footprints whose bottom cells may
  // be empty. Refuse a merge crossing the boundary rather than touch F+.
  var oldMerges=sheet.getRange(1,1,sheet.getMaxRows(),5).getMergedRanges(),clearRows=Math.max(sheet.getLastRow(),blocks.length,1);
  oldMerges.forEach(function(r){if(r.getColumn()+r.getNumColumns()-1>5)throw new Error('REPORT_LAYOUT_CONFLICT');clearRows=Math.max(clearRows,r.getRow()+r.getNumRows()-1);});
  if(sheet.getMaxRows()<clearRows)sheet.insertRowsAfter(sheet.getMaxRows(),clearRows-sheet.getMaxRows());
  sheet.getRange(1,1,clearRows,5).breakApart().clear();
  sheet.setRowHeights(1,clearRows,21);
  sheet.setColumnWidth(1,8);sheet.setColumnWidth(2,380);[3,4,5].forEach(function(column){sheet.setColumnWidth(column,250);});sheet.setHiddenGridlines(true);
  var colors={topSpacer:'#FFFFFF',monthHeader:'#DCC4F4',day:'#FFE49C',ticket:'#FFF6E5',statsSpacer:'#FFF6E5',daily:'#E5F1FA',dailyHeader:'#C9DFEF',weekly:'#E6F2E2',weeklyHeader:'#C8DFBF',weeklyContinuation:'#E6F2E2',weeklyContinuationHeader:'#C8DFBF',monthly:'#EFE5F7',monthlyHeader:'#DCC9EA'};
  var border='#233E69',thick=SpreadsheetApp.BorderStyle.SOLID_THICK;
  if(!blocks.length){sheet.getRange('B2').setValue('Нарядів поки немає').setFontColor('#243447');return;}
  var range=sheet.getRange(1,2,blocks.length,4);range.setNumberFormat('@').setValues(blocks.map(function(b){return [b.text,'','',''];})).setWrap(true).setVerticalAlignment('top').setHorizontalAlignment('left').setFontFamily('Arial').setFontSize(11).setFontColor('#243447');
  sheet.getRange(1,2,blocks.length,1).setBackgrounds(blocks.map(function(b){return [colors[b.kind]];})).setFontWeights(blocks.map(function(b){return [b.kind==='ticket'?'normal':'bold'];}));
  // Bold «Наряд №N» title line of every наряд (rich text, first line only).
  sheet.getRange(1,2,blocks.length,1).setRichTextValues(richValues);
  layout.spans.forEach(function(s){
    var cell=sheet.getRange(s.row,s.column,s.height,s.width);if(s.height>1||s.width>1)cell.merge();
    cell.setValue(s.text).setBackground(colors[s.kind]);
    if(/Header$/.test(s.kind))cell.setFontWeight('bold').setFontSize(s.kind==='monthHeader'?16:12).setBorder(true,true,true,true,false,false,border,thick);
    if(s.kind==='monthHeader')cell.setHorizontalAlignment('center').setVerticalAlignment('middle').setBorder(true,true,true,true,false,false,border,thick);
  });
  layout.statFrames.forEach(function(s){sheet.getRange(s.row,s.column,s.height,1).setBorder(true,true,true,true,null,null,border,thick);});
  layout.dayFrames.forEach(function(s){
    var frame=sheet.getRange(s.row,2,s.height,1);
    frame.setBorder(null,null,null,null,false,true,'#E0D2B3',SpreadsheetApp.BorderStyle.SOLID);
    frame.setBorder(true,true,true,true,null,null,border,thick);
    sheet.getRange(s.row,2,1,1).setFontSize(12).setBorder(null,null,true,null,null,null,border,thick);
  });
  // Visible thick separator BETWEEN adjacent наряды only; the inner card
  // content has no decorative text rules.
  blocks.forEach(function(b,i){if(b.kind==='ticket'&&i>0&&blocks[i-1].kind==='ticket')sheet.getRange(i+1,2,1,1).setBorder(true,null,null,null,false,false,border,thick);});
  // Complete B:E month frames; no statistical merge crosses a title band.
  layout.monthSeparators.forEach(function(row,i){
    var end=layout.monthSeparators[i+1]||blocks.length+1;
    sheet.getRange(row,2,end-row,4).setBorder(true,true,true,true,null,null,border,thick);
    // Final vertical-edge pass includes panel headers and padding, but never
    // divides the merged month title. Shared cell borders replace, not stack.
    sheet.getRange(row+1,2,end-row-1,4).setBorder(null,true,null,true,true,null,border,thick);
  });
  // Content-sized tickets; explicit day padding supports adjacent statistics
  // without stretching a short ticket. C:E retain their readable widths.
  var heights=blocks.map(function(b){var lines=b.text.split('\n').reduce(function(n,s){return n+Math.max(1,Math.ceil(s.length/48));},0);return b.kind==='topSpacer'?21:b.kind==='monthHeader'?44:b.kind==='day'?64:b.kind==='statsSpacer'?b.height:Math.max(58,lines*18+16);});
  for(var start=0;start<heights.length;){var end=start+1;while(end<heights.length&&heights[end]===heights[start])end++;sheet.setRowHeights(start+1,end-start,heights[start]);start=end;}
}
function reportAudit_(c,code){
  var count=Number(c.p.getProperty('REPORT_REJECTED_COUNT')||0)+1;c.p.setProperty('REPORT_REJECTED_COUNT',String(count));c.p.setProperty('REPORT_LAST_ERROR',code);
  // Safe metadata only; never payload, notes, addresses, identity or MAC.
  console.warn(JSON.stringify({scope:'dispatcher-report',code:code,rejected_count:count}));
}
function reportErrorCode_(error){var code=String(error&&error.message||'');return /^(?:UNAUTHORIZED|AUTH_FAILED|REPORT_[A-Z_]+|LEGACY_WORKBOOK_FORBIDDEN|DUPLICATE_STORED_ID|INVALID_[A-Z_]+|UNKNOWN_OR_MISSING_FIELD|PRIVACY_REJECTED|STALE_VERSION|PAYMENT_MISMATCH|RATE_LIMITED|BUSY|HASH_MISMATCH|FORMULA_REJECTED|ROW_NOT_ACTIVE|ONU_CORRECTION_[A-Z_]+)$/.test(code)?code:'REPORT_INTERNAL_ERROR';}
function reportDispatch(request){
  // Interactive HtmlService RPC path — READ-ONLY since the direct-transport
  // security fix: only report_status (diagnostics) may execute here. Google
  // identity no longer grants mutation capability; every known MUTATION action
  // fails closed with REPORT_DIRECT_TRANSPORT_REQUIRED and must arrive as a
  // signed HMAC envelope through doPost below. Unknown actions keep the old
  // INVALID_ACTION contract. Do not remove this entry point: rollback/debug
  // status checks and the owner identity gate still need it.
  var c;try{c=reportAuthorize_();}catch(e){return {ok:false,code:reportErrorCode_(e)};}
  try{
    if(request&&typeof request==='object'&&!Array.isArray(request)&&REPORT_ACTIONS.includes(request.action)&&request.action!=='report_status')throw new Error('REPORT_DIRECT_TRANSPORT_REQUIRED');
    var lock=LockService.getScriptLock();
    try{
      if(!lock.tryLock(10000))throw new Error('BUSY');
      return reportExecute_(c,request);
    }finally{if(lock.hasLock())lock.releaseLock();}
  }catch(e){var code=reportErrorCode_(e);reportAudit_(c,code);return {ok:false,code:code,rejected:1,privacy_violations:code==='PRIVACY_REJECTED'?1:0};}
}
// The ONE mutation engine shared by both entry points. Assumes the script lock
// is already held. envelopeNonce is provided ONLY by the signed doPost path:
// the anti-replay nonce is consumed AFTER the idempotent REPORT_ACK_ replay and
// BEFORE the first mutation, so a same-request retry answers from the receipt
// cache while a reused nonce can never execute twice.
function reportExecute_(c,request,envelopeNonce){
  if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(function(k){return !['action','tickets','ticket','deletes','request_id','rebuild','proof','ticket_id','expected','correction_id'].includes(k);})||!REPORT_ACTIONS.includes(request.action))throw new Error('INVALID_ACTION');
  if(typeof request.request_id!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(request.request_id))throw new Error('INVALID_REQUEST_ID');
  if(JSON.stringify(request).length>500000)throw new Error('INVALID_SIZE');
  var cache=CacheService.getScriptCache(),cached=cache.get('REPORT_ACK_'+request.request_id);
  var requestHash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(request),Utilities.Charset.UTF_8).map(function(n){return ((n+256)%256).toString(16).padStart(2,'0');}).join('');
  if(cached){var ack=JSON.parse(cached);if(ack.hash!==requestHash)throw new Error('INVALID_REQUEST_ID');
    // Correction ACKs must recheck current evidence and render/read back current
    // money. A cached success cannot hide a later source conflict or rollback.
    if(request.action==='report_onu_correction_apply'||request.action==='report_onu_correction_rollback')return reportOnuCorrectionExecute_(reportStore_(c),request,requestHash);
    if(request.action==='report_onu_correction_preview')return reportOnuCorrectionPreview_(reportStore_(c),request.ticket_id);
    return ack.result;}
  var store=reportStore_(c),journal=null,receipt=null;
  if(['report_upsert','report_sync_all','report_delete'].includes(request.action)){
    journal=reportReceiptJournal_(store);receipt=journal.find(request.request_id);
    if(receipt){
      if(receipt.v[1]!==requestHash)throw new Error('INVALID_REQUEST_ID');
      var saved=JSON.parse(receipt.v[2]),evidence=JSON.parse(receipt.v[3]);
      if(receipt.v[4]!=='COMMITTED'){
        // A process may have stopped between the data flush and receipt marker.
        // Only exact durable evidence can promote a PREPARED receipt to ACK.
        reportRecoverPrepared_(store,request,evidence);
        journal.commit(receipt);
        if(request.rebuild!==false)reportBestEffort_(c,'REPORT_RENDER_FAILED',function(){reportRender_(store.ss,store.rows);});
      }
      return saved;
    }
  }
  if(envelopeNonce!==undefined&&!reportConsumeNonce_(envelopeNonce))throw new Error('AUTH_FAILED');
  // New requests pass nonce verification before ANY receipt mutation. No
  // newer data mutation may destroy unresolved write-ahead commit evidence.
  if(journal)journal.pending().forEach(function(pending){
    if(!reportEvidenceMatches_(store.rows,JSON.parse(pending.v[3])))throw new Error('REPORT_COMMIT_UNRESOLVED');
    journal.commit(pending);
  });
  var minute=Math.floor(Date.now()/60000),rateKey='REPORT_RATE_'+minute,count=Number(cache.get(rateKey)||0);if(count>=40)throw new Error('RATE_LIMITED');cache.put(rateKey,String(count+1),120);
  var result={ok:true,code:'OK',inserted:0,updated:0,unchanged:0,deleted:0,rejected:0,privacy_violations:0,errors:0},now=new Date().toISOString();
  if(request.action==='report_onu_correction_preview'){
    if(!['action,request_id','action,request_id,ticket_id'].includes(Object.keys(request).sort().join(','))||request.ticket_id!==undefined&&typeof request.ticket_id!=='string')throw new Error('INVALID_ACTION');
    result=reportOnuCorrectionPreview_(store,request.ticket_id);cache.put('REPORT_ACK_'+request.request_id,JSON.stringify({hash:requestHash,result:result}),600);return result;
  }
  if(request.action==='report_onu_correction_apply'||request.action==='report_onu_correction_rollback'){
    // These narrowly scoped actions use their own append-only correction log;
    // they never prepare/modify dispatcher receipts or the ticket outbox.
    var receiptState=reportReceiptJournal_(store),pendingCorrections=receiptState.pending();
    if(pendingCorrections.length)throw new Error('REPORT_COMMIT_UNRESOLVED');
    result=reportOnuCorrectionExecute_(store,request,requestHash);cache.put('REPORT_ACK_'+request.request_id,JSON.stringify({hash:requestHash,result:result}),600);return result;
  }
  if(request.action!=='report_receipt'&&request.proof!==undefined)throw new Error('INVALID_ACTION');
  if(request.action==='report_receipt'){
    var proof=request.proof;
    if(request.ticket||request.tickets||request.deletes||request.rebuild!==undefined||!proof||Object.keys(proof).sort().join(',')!=='source_hash,source_version,ticket_id'||typeof proof.ticket_id!=='string'||!/^[\p{L}\p{N}_:.@-]{1,128}$/u.test(proof.ticket_id)||!Number.isSafeInteger(proof.source_version)||!/^[a-f0-9]{64}$/.test(proof.source_hash))throw new Error('INVALID_PROOF');
    var row=store.rows.find(function(r){return r.ticket_id===proof.ticket_id;});
    if(!row||row.deleted_at||row.sync_status!=='SYNCED'||row.source_version!==proof.source_version||row.source_hash!==proof.source_hash)return {ok:false,code:'REPORT_RECEIPT_MISMATCH'};
    return {ok:true,code:'OK',ticket_id:row.ticket_id,source_version:row.source_version,source_hash:row.source_hash,sync_status:'SYNCED'};
  }
  if(request.action==='report_status'){
    if(request.ticket||request.tickets||request.deletes||request.rebuild!==undefined)throw new Error('INVALID_ACTION');
    result={ok:true,code:'OK',active_count:store.rows.filter(function(r){return !r.deleted_at;}).length,deleted_count:store.rows.filter(function(r){return !!r.deleted_at;}).length,rejected_count:Number(c.p.getProperty('REPORT_REJECTED_COUNT')||0),last_sync:c.p.getProperty('REPORT_LAST_SYNC')||'',last_rebuild:c.p.getProperty('REPORT_LAST_REBUILD')||'',last_error:c.p.getProperty('REPORT_LAST_ERROR')||'',pending_retry:0};
    // Safe archive evidence: no IDs, ticket text or private fields leave GAS.
    var active=store.rows.filter(function(r){return !r.deleted_at;}),dates=active.map(function(r){return r.work_date;}).sort();
    result.earliest_date=dates[0]||'';result.latest_date=dates[dates.length-1]||'';
    result.id_set_hash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(active.map(function(r){return r.ticket_id;}).sort()),Utilities.Charset.UTF_8).map(function(n){return ((n+256)%256).toString(16).padStart(2,'0');}).join('');
  }else{
    var items=request.action==='report_upsert'?[request.ticket]:request.action==='report_sync_all'?request.tickets||[]:[],deletes=request.deletes||[];
    if(!Array.isArray(items)||!Array.isArray(deletes)||items.length>100||deletes.length>100)throw new Error('INVALID_BATCH');
    if(request.action==='report_upsert'&&(request.tickets||deletes.length))throw new Error('INVALID_ACTION');
    if(request.action==='report_sync_all'&&request.ticket)throw new Error('INVALID_ACTION');
    if(request.action==='report_delete'&&(!deletes.length||request.ticket||request.tickets))throw new Error('INVALID_DELETE');
    if(request.action==='report_rebuild'&&(items.length||deletes.length))throw new Error('INVALID_ACTION');
    // An item failure never grants an ACK to its siblings or prevents their
    // writes. The request envelope/auth checks remain fail-closed above.
    result.items=[];
    function applyItem(dto,action){
      var item={ticket_id:dto&&typeof dto.ticket_id==='string'&&/^[\p{L}\p{N}_:.@-]{1,128}$/u.test(dto.ticket_id)?dto.ticket_id:'',action:action,source_version:dto&&Number.isSafeInteger(dto.source_version)?dto.source_version:null};
      try{
        var outcome;
        if(action==='upsert'){
          var v=MTDispatcherReportCore.validate(dto);
          if(reportHash_(v)!==v.source_hash)throw new Error('HASH_MISMATCH');
          // Enforce the new contact boundary for incoming DTOs only. Reading
          // old stored rows/hashes must not rewrite or reclassify history.
          if(MTDispatcherReportCore.sanitizeComment(v.dispatcher_comment)!==v.dispatcher_comment)throw new Error('PRIVACY_REJECTED');
          // validate() has already constrained client_phone to phone digits/
          // punctuation; its leading + is data, not a general formula escape.
          Object.keys(v).forEach(function(k){if(k!=='client_phone'&&typeof v[k]==='string'&&/^[\s]*[=+@-]/.test(v[k]))throw new Error('FORMULA_REJECTED');});
          if(store.rows.length>=10000&&!store.rows.some(function(r){return r.ticket_id===v.ticket_id;}))throw new Error('REPORT_CAPACITY');
          outcome=MTDispatcherReportCore.upsert(store.rows,v);
        }else{
          if(!dto||Object.keys(dto).some(function(k){return !['ticket_id','source_version'].includes(k);}))throw new Error('INVALID_DELETE');
          if(store.rows.length>=10000&&!store.rows.some(function(r){return r.ticket_id===dto.ticket_id;}))throw new Error('REPORT_CAPACITY');
          outcome=MTDispatcherReportCore.remove(store.rows,dto.ticket_id,dto.source_version,now);
        }
        result[outcome]++;item.status=outcome==='unchanged'?'unchanged':'synced';item.code='OK';
      }catch(error){
        var code=reportErrorCode_(error);item.code=code;
        item.status=code==='STALE_VERSION'?'stale_version':/^(?:INVALID_|UNKNOWN_|PRIVACY_|HASH_|FORMULA_|PAYMENT_)/.test(code)?'invalid_dto':'error';
        result.rejected++;result.errors++;if(code==='PRIVACY_REJECTED')result.privacy_violations++;
      }
      result.items.push(item);
    }
    items.forEach(function(dto){applyItem(dto,'upsert');});
    deletes.forEach(function(dto){applyItem(dto,'delete');});
    if(result.errors)result.code='PARTIAL';
    if(journal)receipt=journal.prepare(request.request_id,requestHash,result,reportEvidence_(store.rows,result));
    if(result.inserted+result.updated+result.unchanged+result.deleted){reportWrite_(store);SpreadsheetApp.flush();}
    // No success ACK before the write/flush. A durable PREPARED record allows
    // exact recovery even if marking COMMITTED fails after the data commit.
    if(journal)reportBestEffort_(c,'REPORT_RECEIPT_MARK_FAILED',function(){journal.commit(receipt);});
    if(journal)reportBestEffort_(c,'REPORT_ACK_CACHE_FAILED',function(){cache.put('REPORT_ACK_'+request.request_id,JSON.stringify({hash:requestHash,result:result}),600);});
    reportBestEffort_(c,'REPORT_METADATA_FAILED',function(){
      if(result.inserted+result.updated+result.unchanged+result.deleted)c.p.setProperty('REPORT_LAST_SYNC',now);
      if(result.errors)result.items.filter(function(item){return item.code!=='OK';}).forEach(function(item){reportAudit_(c,item.code);});
      else c.p.deleteProperty('REPORT_LAST_ERROR');
    });
    if(request.action==='report_rebuild'||request.rebuild!==false){
      var rendered=reportBestEffort_(c,'REPORT_RENDER_FAILED',function(){reportRender_(store.ss,store.rows);});
      if(rendered)reportBestEffort_(c,'REPORT_METADATA_FAILED',function(){c.p.setProperty('REPORT_LAST_REBUILD',now);});
      else if(request.action==='report_rebuild')return {ok:false,code:'REPORT_RENDER_FAILED'};
    }
    if(journal)return result;
  }
  cache.put('REPORT_ACK_'+request.request_id,JSON.stringify({hash:requestHash,result:result}),600);return result;
}
function reportJson_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function reportHmacSecret_(){
  return String(PropertiesService.getScriptProperties().getProperty('MT_DISPATCHER_HMAC_SECRET')||'');
}
function reportCanonicalField_(value){
  value=String(value==null?'':value);
  return Utilities.newBlob(value).getBytes().length+':'+value;
}
// Byte-compatible with js/sync-contract.js canonical() and the legacy Code.gs
// syncCanonicalRequest_ (prefix MT-SYNC-HMAC-V3). Parity is test-proven.
function reportCanonical_(envelope){
  return ['MT-SYNC-HMAC-V3',
    reportCanonicalField_(String(Number(envelope.v))),
    reportCanonicalField_(String(envelope.method||'').toUpperCase()),
    reportCanonicalField_(String(envelope.action||'')),
    reportCanonicalField_(String(envelope.entity||'')),
    reportCanonicalField_(String(envelope.id||'')),
    reportCanonicalField_(String(envelope.ts||'')),
    reportCanonicalField_(String(envelope.nonce||'')),
    reportCanonicalField_(String(envelope.requestId||'')),
    reportCanonicalField_(String(envelope.body||''))].join('\n');
}
function reportConstantTimeEqual_(a,b){
  a=String(a||'');b=String(b||'');
  var max=a.length>b.length?a.length:b.length,diff=a.length^b.length;
  for(var i=0;i<max;i++)diff|=(i<a.length?a.charCodeAt(i):0)^(i<b.length?b.charCodeAt(i):0);
  return diff===0;
}
function reportConsumeNonce_(nonce){
  var cache=CacheService.getScriptCache(),key='mt-dispatcher-nonce-'+Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(nonce),Utilities.Charset.UTF_8).map(function(n){return ((n+256)%256).toString(16).padStart(2,'0');}).join('');
  if(cache.get(key))return false;
  cache.put(key,'1',600);return true;
}
// Fail-closed envelope verification: shape, timestamp window (+-5 min), nonce
// format, request binding and the HMAC-SHA256 signature over the canonical
// MT-SYNC-HMAC-V3 form. Any miss is a boolean false — the caller denies.
function reportVerifyEnvelope_(envelope){
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope))return false;
  if(Number(envelope.v)!==3||String(envelope.method||'').toUpperCase()!=='POST')return false;
  if(!REPORT_ACTIONS.includes(String(envelope.action||''))||String(envelope.entity||'')!=='system'||String(envelope.id||'')!=='')return false;
  if(!/^\d{13}$/.test(String(envelope.ts||''))||Math.abs(Date.now()-Number(envelope.ts))>5*60*1000)return false;
  if(!/^[A-Za-z0-9_-]{16,128}$/.test(String(envelope.nonce||'')))return false;
  if(!/^[a-zA-Z0-9-]{8,80}$/.test(String(envelope.requestId||'')))return false;
  if(typeof envelope.body!=='string'||envelope.body.length>1536*1024)return false;
  if(!/^[A-Za-z0-9_-]{43}$/.test(String(envelope.sig||'')))return false;
  var secret=reportHmacSecret_();
  if(Utilities.newBlob(secret).getBytes().length<32)return false;
  var expected=Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(reportCanonical_(envelope),secret,Utilities.Charset.UTF_8)).replace(/=+$/g,'');
  return reportConstantTimeEqual_(expected,String(envelope.sig));
}
function doPost(e){
  // v91.95 direct transport: the ONLY accepted mutation path is a signed
  // MT-SYNC-HMAC-V3 envelope. Unsigned, invalid, replayed or tampered requests
  // never reach reportExecute_ — DENY before any read or write.
  var raw=e&&e.postData?String(e.postData.contents||''):'';
  if(!raw||raw.length>2*1024*1024)return reportJson_({ok:false,code:'AUTH_FAILED'});
  var envelope;try{envelope=JSON.parse(raw);}catch(_){return reportJson_({ok:false,code:'AUTH_FAILED'});}
  if(!reportVerifyEnvelope_(envelope))return reportJson_({ok:false,code:'AUTH_FAILED'});
  var request;try{request=JSON.parse(envelope.body);}catch(_){return reportJson_({ok:false,code:'AUTH_FAILED'});}
  if(!request||typeof request!=='object'||Array.isArray(request)||String(request.action)!==envelope.action||String(request.request_id)!==envelope.requestId)return reportJson_({ok:false,code:'AUTH_FAILED'});
  var c;try{c=reportConfig_();}catch(err){return reportJson_({ok:false,code:reportErrorCode_(err)});}
  var lock=LockService.getScriptLock();
  try{
    if(!lock.tryLock(10000))throw new Error('BUSY');
    return reportJson_(reportExecute_(c,request,String(envelope.nonce)));
  }catch(err){var code=reportErrorCode_(err);reportAudit_(c,code);return reportJson_({ok:false,code:code,rejected:1,privacy_violations:code==='PRIVACY_REJECTED'?1:0});}
  finally{if(lock.hasLock())lock.releaseLock();}
}
function doGet(e){
  var c;try{c=reportAuthorize_();}catch(error){return ContentService.createTextOutput(JSON.stringify({ok:false,code:reportErrorCode_(error)})).setMimeType(ContentService.MimeType.JSON);}
  var origin=String(e&&e.parameter&&e.parameter.origin||''),channel=String(e&&e.parameter&&e.parameter.channel||'');
  if(!c.origins.includes(origin)||!/^[a-f0-9]{32}$/.test(channel))return HtmlService.createHtmlOutput('<p>Відкрийте підключення з налаштувань Майстер-Трекера.</p>');
  var template=HtmlService.createTemplateFromFile('Bridge');template.bridgeConfig=JSON.stringify({origin:origin,channel:channel}).replace(/</g,'\\u003c');
  return template.evaluate().setTitle('Отчет диспетчеру — підключення').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
