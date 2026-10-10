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

/* Explicitly requested ID/date diagnostic, owner-only and NOT a Web App action.
   Offsets refer to SOURCE sheet order, not an observed client request. */
function reportArchiveMissingDetails(){
  var c=reportAuthorize_();
  if(c.id!=='1auELr1O8ThLimp9kU5xoD7v6VQHf1knOMTOlAjCHVpA')throw new Error('AUDIT_TARGET_MISMATCH');
  var source=SpreadsheetApp.openById('1fc_yXm7XihQn7medg8H25a9cxBn_HIqMhXx-rZyVD5M').getSheetByName('Заявки');
  var report=SpreadsheetApp.openById(c.id).getSheetByName('_DispatcherData');
  if(!source||!report)throw new Error('AUDIT_SHEET_MISSING');
  var n=source.getLastRow(),m=report.getLastRow();if(n>10001||m>10001)throw new Error('AUDIT_CAPACITY');
  var s=source.getRange(1,1,Math.max(n,1),2).getDisplayValues(),r=report.getRange(1,1,Math.max(m,1),2).getDisplayValues(),d=report.getRange(1,28,Math.max(m,1),1).getDisplayValues();
  if(s[0][0]!=='id'||s[0][1]!=='date'||r[0][0]!=='ticket_id'||r[0][1]!=='work_date'||d[0][0]!=='deleted_at')throw new Error('AUDIT_SCHEMA_MISMATCH');
  var stored=new Map();r.slice(1).forEach(function(row,i){if(row[0])stored.set(row[0],{deleted:!!d[i+1][0],report_row:i+2});});
  var sourceIds=new Set(),dated=[];
  s.slice(1).forEach(function(row,i){var date;try{date=MTDispatcherReportCore.dateKey(row[1]);}catch(e){return;}
    if(!row[0]||sourceIds.has(row[0]))throw new Error('AUDIT_SOURCE_ID_INVALID');sourceIds.add(row[0]);
    var found=stored.get(row[0]);dated.push({id:row[0],date:date,source_row:i+2,offset:dated.length,status:!found?'absent':found.deleted?'soft_deleted':'active',report_row:found?found.report_row:0});
  });
  var missing=dated.filter(function(row){return row.status!=='active';}),runs=[],batches=[];
  missing.forEach(function(row){var last=runs[runs.length-1];if(last&&last.end_offset+1===row.offset){last.end_offset=row.offset;last.last_id=row.id;last.last_date=row.date;last.count++;}else runs.push({start_offset:row.offset,end_offset:row.offset,count:1,first_id:row.id,last_id:row.id,first_date:row.date,last_date:row.date});});
  for(var start=0;start<dated.length;start+=50){var block=dated.slice(start,start+50);batches.push({source_block_50:1+start/50,start_offset:start,end_offset:start+block.length-1,rows:block.length,active:block.filter(function(row){return row.status==='active';}).length,absent:block.filter(function(row){return row.status==='absent';}).length,soft_deleted:block.filter(function(row){return row.status==='soft_deleted';}).length,first_date:block[0].date,last_date:block[block.length-1].date});}
  var summary={source_count:dated.length,missing_count:missing.length,missing_runs:runs,source_blocks_50:batches,first_missing:missing[0]||null,last_missing:missing[missing.length-1]||null,offset_basis:'zero-based dated SOURCE order; NOT actual client batches'};
  console.log('AUDIT_DETAIL_SUMMARY '+JSON.stringify(summary));
  for(var page=0;page<missing.length;page+=20)console.log('AUDIT_MISSING_PAGE '+JSON.stringify({page:page/20+1,rows:missing.slice(page,page+20)}));
  return summary;
}

/* Stored write timestamps/version groups are evidence, NOT sent/received ACKs. */
function reportArchiveSyncEvidence(){
  var c=reportAuthorize_();if(c.id!=='1auELr1O8ThLimp9kU5xoD7v6VQHf1knOMTOlAjCHVpA')throw new Error('AUDIT_TARGET_MISMATCH');
  var sheet=SpreadsheetApp.openById(c.id).getSheetByName('_DispatcherData');if(!sheet)throw new Error('AUDIT_SHEET_MISSING');
  var n=sheet.getLastRow();if(n>10001)throw new Error('AUDIT_CAPACITY');
  var rows=sheet.getRange(1,1,Math.max(n,1),2).getDisplayValues(),meta=sheet.getRange(1,25,Math.max(n,1),2).getDisplayValues(),deleted=sheet.getRange(1,28,Math.max(n,1),1).getDisplayValues();
  if(rows[0][0]!=='ticket_id'||rows[0][1]!=='work_date'||meta[0][0]!=='updated_at'||meta[0][1]!=='source_version'||deleted[0][0]!=='deleted_at')throw new Error('AUDIT_SCHEMA_MISMATCH');
  var groups={},active=[];rows.slice(1).forEach(function(row,i){if(!row[0]||deleted[i+1][0])return;var version=meta[i+1][1],key=version||'ABSENT',g=groups[key]||(groups[key]={source_version:version,count:0,dates:[],updated_at:[]});g.count++;g.dates.push(row[1]);g.updated_at.push(meta[i+1][0]);active.push({id:row[0],date:row[1],report_row:i+2});});
  var result={active_count:active.length,first_stored_active:active[0]||null,last_stored_active:active[active.length-1]||null,version_groups:Object.keys(groups).map(function(key){var g=groups[key];g.dates.sort();g.updated_at.sort();return {source_version:g.source_version,count:g.count,earliest_date:g.dates[0],latest_date:g.dates[g.dates.length-1],earliest_updated:g.updated_at[0],latest_updated:g.updated_at[g.updated_at.length-1]};}),last_sync:c.p.getProperty('REPORT_LAST_SYNC')||'',last_rebuild:c.p.getProperty('REPORT_LAST_REBUILD')||'',last_error:c.p.getProperty('REPORT_LAST_ERROR')||'',rejected_count:c.p.getProperty('REPORT_REJECTED_COUNT')||'0'};
  console.log('AUDIT_SYNC_EVIDENCE '+JSON.stringify(result));return result;
}
