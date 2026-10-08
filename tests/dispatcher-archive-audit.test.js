'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../js/dispatcher-report-core.js');
const code=fs.readFileSync('gas/dispatcher-report/ArchiveAudit.gs','utf8');
const sourceId='1fc_yXm7XihQn7medg8H25a9cxBn_HIqMhXx-rZyVD5M',reportId='1auELr1O8ThLimp9kU5xoD7v6VQHf1knOMTOlAjCHVpA';
const rows=[['id','date'],['PRIVATE-ID-1','19.02.2026'],['PRIVATE-ID-2','15.07.2026'],['PRIVATE-ID-3','08.10.2026']];
const reports=[['ticket_id','work_date'],['PRIVATE-ID-2','2026-07-15'],['PRIVATE-ID-3','2026-10-08']];
const reads=[],logs=[];
function sheet(data,kind){return {getLastRow:()=>data.length,getRange:(row,col,n,w)=>{reads.push({kind,row,col,n,w});assert.equal(row,1);assert(col===1&&w===2||kind==='report'&&col===28&&w===1);return {getDisplayValues:()=>col===28?[['deleted_at'],[''],['2026-10-08T00:00:00Z']]:data};}};}
const context={Set,console:{log:v=>logs.push(v)},MTDispatcherReportCore:core,reportAuthorize_:()=>({id:reportId}),SpreadsheetApp:{openById:id=>({getSheetByName:name=>id===sourceId?(assert.equal(name,'Заявки'),sheet(rows,'source')):(assert.equal(id,reportId),assert.equal(name,'_DispatcherData'),sheet(reports,'report'))})}};
vm.runInNewContext(code,context);const r=context.reportArchiveAudit();
assert.equal(r.source_count,3);assert.equal(r.report_count,1);assert.equal(r.missing_count,2);assert.equal(r.matched_count,1);assert.equal(r.deleted_count,1);assert.equal(r.earliest_report,'2026-07-15');assert.equal(r.earliest_source,'2026-02-19');
assert.equal(reads.length,3);assert(!JSON.stringify(r).includes('PRIVATE-ID'));assert(!logs.join('').includes('PRIVATE-ID'));
context.reportAuthorize_=()=>{throw new Error('UNAUTHORIZED');};assert.throws(()=>context.reportArchiveAudit(),/UNAUTHORIZED/);assert.equal(reads.length,3);
console.log('PASS owner-only archive audit: metadata-only reads, ID comparison, soft deletes, no writes or IDs in output');
