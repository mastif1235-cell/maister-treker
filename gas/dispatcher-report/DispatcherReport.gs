/* ONLY the separate dispatcher Apps Script project. Legacy Code.gs untouched.
   Deployment MUST execute as USER_ACCESSING. Never deploy as anonymous owner.
   Script Properties: REPORT_SPREADSHEET_ID, REPORT_ALLOWED_EMAIL,
   REPORT_ALLOWED_ORIGINS (comma-separated origins). No client secrets. */
var REPORT_HEADERS=MTDispatcherReportCore.FIELDS.concat(['deleted_at','sync_status']);
var REPORT_ACTIONS=['report_upsert','report_sync_all','report_delete','report_rebuild','report_status'];
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
  if(data.getMaxColumns()<REPORT_HEADERS.length){if(data.getLastRow()>0)throw new Error('REPORT_SCHEMA_CONFLICT');data.insertColumnsAfter(data.getMaxColumns(),REPORT_HEADERS.length-data.getMaxColumns());}
  if(data.getLastRow()>0&&JSON.stringify(data.getRange(1,1,1,REPORT_HEADERS.length).getValues()[0])!==JSON.stringify(REPORT_HEADERS))throw new Error('REPORT_SCHEMA_CONFLICT');
  data.getRange(1,1,1,REPORT_HEADERS.length).setValues([REPORT_HEADERS]);data.hideSheet();
  var store=reportStore_(c);reportRender_(ss,store.rows);return {ok:true,code:'READY',active_count:store.rows.filter(function(r){return !r.deleted_at;}).length};
}
function reportStore_(c){
  var ss=SpreadsheetApp.openById(c.id);
  if(ss.getSheetByName('Заявки')||ss.getSheetByName('Зміни'))throw new Error('LEGACY_WORKBOOK_FORBIDDEN');
  var sheet=ss.getSheetByName('_DispatcherData');if(!sheet||!ss.getSheetByName('Отчет'))throw new Error('REPORT_NOT_INITIALIZED');
  var head=sheet.getRange(1,1,1,REPORT_HEADERS.length).getValues()[0];if(JSON.stringify(head)!==JSON.stringify(REPORT_HEADERS))throw new Error('REPORT_SCHEMA_CONFLICT');
  if(sheet.getLastRow()>10001)throw new Error('REPORT_CAPACITY');
  var values=sheet.getLastRow()>1?sheet.getRange(2,1,sheet.getLastRow()-1,REPORT_HEADERS.length).getValues():[];
  var rows=values.map(function(v){var r={};REPORT_HEADERS.forEach(function(k,i){r[k]=v[i];});return r;});
  var seen=new Set();rows.forEach(function(r){if(seen.has(r.ticket_id))throw new Error('DUPLICATE_STORED_ID');seen.add(r.ticket_id);if(!r.deleted_at){var dto={};MTDispatcherReportCore.FIELDS.forEach(function(k){dto[k]=r[k];});MTDispatcherReportCore.validate(dto);if(reportHash_(dto)!==dto.source_hash)throw new Error('HASH_MISMATCH');}});
  return {ss:ss,sheet:sheet,rows:rows};
}
function reportHash_(dto){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,MTDispatcherReportCore.content(dto),Utilities.Charset.UTF_8).map(function(n){return ((n+256)%256).toString(16).padStart(2,'0');}).join('');}
function reportWrite_(store){
  var rows=store.rows;if(rows.length>10000)throw new Error('REPORT_CAPACITY');
  if(store.sheet.getMaxRows()<rows.length+1)store.sheet.insertRowsAfter(store.sheet.getMaxRows(),rows.length+1-store.sheet.getMaxRows());
  if(rows.length){var range=store.sheet.getRange(2,1,rows.length,REPORT_HEADERS.length);range.setNumberFormat('@');
    // Reject formula-looking text BEFORE storage; never rely on formatting
    // alone to prevent Spreadsheet formula injection.
    range.setValues(rows.map(function(r){return REPORT_HEADERS.map(function(k){return r[k]===undefined?'':r[k];});}));}
}
function reportRender_(ss,rows){
  var sheet=ss.getSheetByName('Отчет');if(!sheet)throw new Error('REPORT_NOT_INITIALIZED');
  var layout=MTDispatcherReportCore.render(rows).layout,blocks=layout.rows;
  // Only owned A:E, including old merged footprints whose bottom cells may
  // be empty. Refuse a merge crossing the boundary rather than touch F+.
  var oldMerges=sheet.getRange(1,1,sheet.getMaxRows(),5).getMergedRanges(),clearRows=Math.max(sheet.getLastRow(),blocks.length,1);
  oldMerges.forEach(function(r){if(r.getColumn()+r.getNumColumns()-1>5)throw new Error('REPORT_LAYOUT_CONFLICT');clearRows=Math.max(clearRows,r.getRow()+r.getNumRows()-1);});
  if(sheet.getMaxRows()<clearRows)sheet.insertRowsAfter(sheet.getMaxRows(),clearRows-sheet.getMaxRows());
  sheet.getRange(1,1,clearRows,5).breakApart().clear();
  sheet.setRowHeights(1,clearRows,21);
  sheet.setColumnWidth(1,8);sheet.setColumnWidth(2,380);[3,4,5].forEach(function(column){sheet.setColumnWidth(column,250);});sheet.setHiddenGridlines(true);
  var colors={topSpacer:'#FFFFFF',monthHeader:'#DCC4F4',day:'#FFE49C',ticket:'#FFF6E5',daily:'#E5F1FA',dailyHeader:'#C9DFEF',weekly:'#E6F2E2',weeklyHeader:'#C8DFBF',weeklyContinuation:'#E6F2E2',weeklyContinuationHeader:'#C8DFBF',monthly:'#EFE5F7',monthlyHeader:'#DCC9EA'};
  var border='#233E69',thick=SpreadsheetApp.BorderStyle.SOLID_THICK;
  if(!blocks.length){sheet.getRange('B2').setValue('Нарядів поки немає').setFontColor('#243447');return;}
  var range=sheet.getRange(1,2,blocks.length,4);range.setNumberFormat('@').setValues(blocks.map(function(b){return [b.text,'','',''];})).setWrap(true).setVerticalAlignment('top').setHorizontalAlignment('left').setFontFamily('Arial').setFontSize(11).setFontColor('#243447');
  sheet.getRange(1,2,blocks.length,1).setBackgrounds(blocks.map(function(b){return [colors[b.kind]];})).setFontWeights(blocks.map(function(b){return [b.kind==='ticket'?'normal':'bold'];}));
  // Bold «Наряд №N» title line of every наряд (rich text, first line only).
  var bold=SpreadsheetApp.newTextStyle().setBold(true).build();
  sheet.getRange(1,2,blocks.length,1).setRichTextValues(blocks.map(function(b){
    var text=String(b.text||''),nl=text.indexOf('\n'),rich=SpreadsheetApp.newRichTextValue().setText(text);
    if(b.kind==='ticket'&&nl>0)rich.setStyle(0,nl,bold);
    return [rich.build()];
  }));
  layout.spans.forEach(function(s){
    var cell=sheet.getRange(s.row,s.column,s.height,s.width);if(s.height>1||s.width>1)cell.merge();
    cell.setValue(s.text).setBackground(colors[s.kind]);
    if(/Header$/.test(s.kind))cell.setFontWeight('bold').setFontSize(s.kind==='monthHeader'?16:12).setBorder(null,null,true,null,false,false,border,thick);
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
  // rules stay thin text lines so the two never get confused.
  blocks.forEach(function(b,i){if(b.kind==='ticket'&&i>0&&blocks[i-1].kind==='ticket')sheet.getRange(i+1,2,1,1).setBorder(true,null,null,null,false,false,border,thick);});
  // Complete B:E month frames; no statistical merge crosses a title band.
  layout.monthSeparators.forEach(function(row,i){var end=layout.monthSeparators[i+1]||blocks.length+1;sheet.getRange(row,2,end-row,4).setBorder(true,true,true,true,null,null,border,thick);});
  // B is readable on a phone without shrinking text; C:E are adjacent
  // horizontally scrollable panels. Guarantee space for a one-ticket day.
  var heights=blocks.map(function(b){var lines=b.text.split('\n').reduce(function(n,s){return n+Math.max(1,Math.ceil(s.length/48));},0);return b.kind==='topSpacer'?21:b.kind==='monthHeader'?44:b.kind==='day'?64:Math.max(100,lines*18+16);});
  layout.dayFrames.forEach(function(s){var height=heights.slice(s.row-1,s.row+s.height-1).reduce(function(a,b){return a+b;},0);if(height<370)heights[s.row+s.height-2]+=370-height;});
  for(var start=0;start<heights.length;){var end=start+1;while(end<heights.length&&heights[end]===heights[start])end++;sheet.setRowHeights(start+1,end-start,heights[start]);start=end;}
}
function reportAudit_(c,code){
  var count=Number(c.p.getProperty('REPORT_REJECTED_COUNT')||0)+1;c.p.setProperty('REPORT_REJECTED_COUNT',String(count));c.p.setProperty('REPORT_LAST_ERROR',code);
  // Safe metadata only; never payload, notes, addresses, identity or MAC.
  console.warn(JSON.stringify({scope:'dispatcher-report',code:code,rejected_count:count}));
}
function reportErrorCode_(error){var code=String(error&&error.message||'');return /^(?:UNAUTHORIZED|REPORT_[A-Z_]+|LEGACY_WORKBOOK_FORBIDDEN|DUPLICATE_STORED_ID|INVALID_[A-Z_]+|UNKNOWN_OR_MISSING_FIELD|PRIVACY_REJECTED|STALE_VERSION|PAYMENT_MISMATCH|RATE_LIMITED|BUSY|HASH_MISMATCH|FORMULA_REJECTED)$/.test(code)?code:'REPORT_INTERNAL_ERROR';}
function reportDispatch(request){
  var c;try{c=reportAuthorize_();}catch(e){return {ok:false,code:reportErrorCode_(e)};}
  var lock=LockService.getScriptLock();
  try{
    if(!lock.tryLock(10000))throw new Error('BUSY');
    if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(function(k){return !['action','tickets','ticket','deletes','request_id','rebuild'].includes(k);})||!REPORT_ACTIONS.includes(request.action))throw new Error('INVALID_ACTION');
    if(typeof request.request_id!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(request.request_id))throw new Error('INVALID_REQUEST_ID');
    if(JSON.stringify(request).length>500000)throw new Error('INVALID_SIZE');
    var cache=CacheService.getScriptCache(),cached=cache.get('REPORT_ACK_'+request.request_id);
    var requestHash=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(request),Utilities.Charset.UTF_8).map(function(n){return ((n+256)%256).toString(16).padStart(2,'0');}).join('');
    if(cached){var ack=JSON.parse(cached);if(ack.hash!==requestHash)throw new Error('INVALID_REQUEST_ID');return ack.result;}
    var minute=Math.floor(Date.now()/60000),rateKey='REPORT_RATE_'+minute,count=Number(cache.get(rateKey)||0);if(count>=40)throw new Error('RATE_LIMITED');cache.put(rateKey,String(count+1),120);
    var store=reportStore_(c),result={ok:true,code:'OK',inserted:0,updated:0,unchanged:0,deleted:0,rejected:0,privacy_violations:0,errors:0},now=new Date().toISOString();
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
      // Validate the entire batch before ANY persistent write. A privacy/schema
      // failure cannot partially store a batch or leak its contents in logs.
      items=items.map(function(dto){var v=MTDispatcherReportCore.validate(dto);if(reportHash_(v)!==v.source_hash)throw new Error('HASH_MISMATCH');Object.keys(v).forEach(function(k){if(typeof v[k]==='string'&&/^[\s]*[=+@-]/.test(v[k]))throw new Error('FORMULA_REJECTED');});return v;});
      deletes.forEach(function(d){if(!d||Object.keys(d).some(function(k){return !['ticket_id','source_version'].includes(k);}))throw new Error('INVALID_DELETE');});
      items.forEach(function(v){result[MTDispatcherReportCore.upsert(store.rows,v)]++;});
      deletes.forEach(function(d){result[MTDispatcherReportCore.remove(store.rows,d.ticket_id,d.source_version,now)]++;});
      if(items.length||deletes.length){reportWrite_(store);c.p.setProperty('REPORT_LAST_SYNC',now);}
      if(request.action==='report_rebuild'||request.rebuild!==false){reportRender_(store.ss,store.rows);c.p.setProperty('REPORT_LAST_REBUILD',now);}
      c.p.deleteProperty('REPORT_LAST_ERROR');
    }
    cache.put('REPORT_ACK_'+request.request_id,JSON.stringify({hash:requestHash,result:result}),600);return result;
  }catch(e){var code=reportErrorCode_(e);reportAudit_(c,code);return {ok:false,code:code,rejected:1,privacy_violations:code==='PRIVACY_REJECTED'?1:0};}
  finally{if(lock.hasLock())lock.releaseLock();}
}
function doPost(e){
  // Session cookies alone are not CSRF proof for an arbitrary cross-site POST.
  // All report actions use Google's authenticated HtmlService RPC bridge.
  // Do not expose a second mutation path or reuse legacy authentication.
  return ContentService.createTextOutput(JSON.stringify({ok:false,code:'METHOD_NOT_ALLOWED'})).setMimeType(ContentService.MimeType.JSON);
}
function doGet(e){
  var c;try{c=reportAuthorize_();}catch(error){return ContentService.createTextOutput(JSON.stringify({ok:false,code:reportErrorCode_(error)})).setMimeType(ContentService.MimeType.JSON);}
  var origin=String(e&&e.parameter&&e.parameter.origin||''),channel=String(e&&e.parameter&&e.parameter.channel||'');
  if(!c.origins.includes(origin)||!/^[a-f0-9]{32}$/.test(channel))return HtmlService.createHtmlOutput('<p>Відкрийте підключення з налаштувань Майстер-Трекера.</p>');
  var template=HtmlService.createTemplateFromFile('Bridge');template.bridgeConfig=JSON.stringify({origin:origin,channel:channel}).replace(/</g,'\\u003c');
  return template.evaluate().setTitle('Отчет диспетчеру — підключення').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
