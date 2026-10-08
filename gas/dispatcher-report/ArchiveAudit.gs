/* Owner-run metadata audit in the SEPARATE report project. Not a Web App
   action, not included in the deployed bundle. No writes, contents or IDs in
   output; legacy reads are strictly A:B (id/date). */
function reportArchiveAudit(){
  var c=reportAuthorize_();
  if(c.id!=='1auELr1O8ThLimp9kU5xoD7v6VQHf1knOMTOlAjCHVpA')throw new Error('AUDIT_TARGET_MISMATCH');
  var source=SpreadsheetApp.openById('1fc_yXm7XihQn7medg8H25a9cxBn_HIqMhXx-rZyVD5M').getSheetByName('Заявки');
  var report=SpreadsheetApp.openById(c.id).getSheetByName('_DispatcherData');
  if(!source||!report)throw new Error('AUDIT_SHEET_MISSING');
  var sourceSize=source.getLastRow(),reportSize=report.getLastRow();
  if(sourceSize>10001||reportSize>10001)throw new Error('AUDIT_CAPACITY');
  var sourceRows=source.getRange(1,1,Math.max(sourceSize,1),2).getDisplayValues();
  var reportRows=report.getRange(1,1,Math.max(reportSize,1),2).getDisplayValues();
  var deleted=report.getRange(1,28,Math.max(reportSize,1),1).getDisplayValues();
  if(sourceRows[0][0]!=='id'||sourceRows[0][1]!=='date'||reportRows[0][0]!=='ticket_id'||reportRows[0][1]!=='work_date'||deleted[0][0]!=='deleted_at')throw new Error('AUDIT_SCHEMA_MISMATCH');
  function date(value){try{return MTDispatcherReportCore.dateKey(value);}catch(e){return '';}}
  var dated=sourceRows.slice(1).filter(function(r){return date(r[1]);});
  if(dated.some(function(r){return !r[0];}))throw new Error('AUDIT_SOURCE_ID_MISSING');
  var sourceIds=new Set(dated.map(function(r){return r[0];}));
  if(sourceIds.size!==dated.length)throw new Error('AUDIT_DUPLICATE_SOURCE_ID');
  var active=reportRows.slice(1).filter(function(r,i){return r[0]&&!deleted[i+1][0];});
  var activeIds=new Set(active.map(function(r){return r[0];}));
  if(activeIds.size!==active.length)throw new Error('AUDIT_DUPLICATE_REPORT_ID');
  var missing=dated.filter(function(r){return !activeIds.has(r[0]);});
  var sourceDates=dated.map(function(r){return date(r[1]);}).sort();
  var reportDates=active.map(function(r){return date(r[1]);}).sort();
  if(reportDates.some(function(d){return !d;}))throw new Error('AUDIT_INVALID_REPORT_DATE');
  var months={};missing.forEach(function(r){var month=date(r[1]).slice(0,7);months[month]=(months[month]||0)+1;});
  var result={source_count:dated.length,report_count:active.length,matched_count:dated.length-missing.length,missing_count:missing.length,
    unexpected_active_count:active.filter(function(r){return !sourceIds.has(r[0]);}).length,
    deleted_count:reportRows.slice(1).filter(function(r,i){return r[0]&&deleted[i+1][0];}).length,
    earliest_source:sourceDates[0]||'',latest_source:sourceDates[sourceDates.length-1]||'',
    earliest_report:reportDates[0]||'',latest_report:reportDates[reportDates.length-1]||'',missing_by_month:months};
  console.log(JSON.stringify(result));return result;
}
