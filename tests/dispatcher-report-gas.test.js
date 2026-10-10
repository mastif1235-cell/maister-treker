'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const properties=new Map(),cache=new Map();let email='mastif1235@gmail.com',writes=0,rebuilds=0,rows=[],locked=false;
const c={console:{warn:()=>{}},Date,Map,Set,JSON,PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k)||null,setProperty:(k,v)=>properties.set(k,v),deleteProperty:k=>properties.delete(k),setProperties:o=>Object.entries(o).forEach(([k,v])=>properties.set(k,v))})},Session:{getActiveUser:()=>({getEmail:()=>email})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v)})},LockService:{getScriptLock:()=>({tryLock:()=>{locked=true;return true;},hasLock:()=>locked,releaseLock:()=>{locked=false;}})},Utilities:{DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(_,s)=>Array.from(crypto.createHash('sha256').update(s).digest())}};
vm.createContext(c);vm.runInContext(fs.readFileSync('js/dispatcher-report-core.js','utf8'),c);vm.runInContext(fs.readFileSync('gas/dispatcher-report/DispatcherReport.gs','utf8'),c);
const actualRender=c.reportRender_;
properties.set('REPORT_ALLOWED_EMAIL',email);properties.set('REPORT_SPREADSHEET_ID','only-report-target');properties.set('REPORT_ALLOWED_ORIGINS','https://mastif1235-cell.github.io');
c.reportStore_=()=>({rows:structuredClone(rows),ss:{},sheet:{}});c.reportWrite_=store=>{rows=structuredClone(store.rows);writes++;};c.reportRender_=()=>{rebuilds++;};
const core=c.MTDispatcherReportCore;
function dto(id='test-1',version=1){const d=Object.fromEntries(core.FIELDS.map(k=>[k,'']));Object.assign(d,{ticket_id:id,work_date:'2026-09-30',work_time:'12:30',work_type:'Ремонт',work_category:'repair',amount:0,total:0,onu_used:1,onu_replacement:1,router_used:0,payment_cash:0,payment_cashless:0,payment_free_amount:0,payment_free_count:1,updated_at:'2026-10-06T00:00:00.000Z',source_version:version});d.source_hash=c.reportHash_(d);return d;}
let tests=0,seq=0;function test(name,fn){fn();tests++;}function call(action,extra={},id){return c.reportDispatch({action,...extra,request_id:id||'synthetic-'+(++seq)});}
test('owner status only safe aggregate metadata',()=>{const r=call('report_status');assert(r.ok);assert(!JSON.stringify(r).includes('test-1'));});
test('upsert then repeat 5 times no duplicate',()=>{for(let i=0;i<5;i++)assert(call('report_upsert',{ticket:dto()}).ok);assert.equal(rows.length,1);assert.equal(core.stats(rows).onu_used,1);});
test('same request ID/body idempotent ACK',()=>{const r={ticket:dto()};assert(call('report_upsert',r,'request-duplicate').ok);const oldWrites=writes;assert(call('report_upsert',r,'request-duplicate').ok);assert.equal(writes,oldWrites);});
test('same request ID/different payload rejected',()=>assert.equal(call('report_upsert',{ticket:dto('different')},'request-duplicate').code,'INVALID_REQUEST_ID'));
test('batch privacy failure atomic, no sheet write',()=>{const oldWrites=writes,oldRows=JSON.stringify(rows);assert.equal(call('report_sync_all',{tickets:[dto('safe-new'),{...dto('bad'),dispatcher_comment:'masterNote private'}]}).code,'PRIVACY_REJECTED');assert.equal(writes,oldWrites);assert.equal(JSON.stringify(rows),oldRows);});
test('hash mismatch rejected before write',()=>{const old=writes;assert.equal(call('report_upsert',{ticket:{...dto(),total:10}}).code,'PAYMENT_MISMATCH');assert.equal(call('report_upsert',{ticket:{...dto(),work_type:'Інше'}}).code,'HASH_MISMATCH');assert.equal(writes,old);});
test('arbitrary sheet/legacy action forbidden',()=>{assert.equal(call('save_ticket',{ticket:dto()}).code,'INVALID_ACTION');assert.equal(call('report_upsert',{ticket:dto(),spreadsheet_id:'legacy'}).code,'INVALID_ACTION');});
test('formula injection blocked',()=>{const d={...dto(),dispatcher_comment:'=IMPORTXML("https://evil")'};d.source_hash=c.reportHash_(d);assert.equal(call('report_upsert',{ticket:d}).code,'PRIVACY_REJECTED');d.dispatcher_comment='=SUM(1,2)';d.source_hash=c.reportHash_(d);assert.equal(call('report_upsert',{ticket:d}).code,'FORMULA_REJECTED');});
test('formula injection in ID blocked',()=>assert.equal(call('report_upsert',{ticket:dto('@evil')}).code,'FORMULA_REJECTED'));
test('upsert cannot hide delete action',()=>assert.equal(call('report_upsert',{ticket:dto(),deletes:[{ticket_id:'test-1',source_version:2}]}).code,'INVALID_ACTION'));
test('status cannot mutate',()=>assert.equal(call('report_status',{deletes:[{ticket_id:'test-1',source_version:2}]}).code,'INVALID_ACTION'));
test('lock released for rejected requests',()=>assert.equal(locked,false));
test('delete soft; no physical row erased',()=>{assert(call('report_delete',{deletes:[{ticket_id:'test-1',source_version:2}]}).ok);assert.equal(rows.length,1);assert(rows[0].deleted_at);assert.equal(core.render(rows).blocks.length,0);});
test('stale update cannot resurrect',()=>assert.equal(call('report_upsert',{ticket:dto()}).code,'STALE_VERSION'));
test('rebuild alters only presentation',()=>{const before=JSON.stringify(rows),old=writes,n=rebuilds;assert(call('report_rebuild').ok);assert.equal(writes,old);assert.equal(JSON.stringify(rows),before);assert.equal(rebuilds,n+1);});
test('owner-only authentication enforced before any read',()=>{email='other@example.invalid';let read=false;const original=c.reportStore_;c.reportStore_=()=>{read=true;};assert.equal(call('report_status').code,'UNAUTHORIZED');assert.equal(read,false);c.reportStore_=original;email='mastif1235@gmail.com';});
test('437 historical rows survive paged sync, repeated rebuild and tombstones',()=>{
  const baseline=structuredClone(rows);cache.clear();rows=[];
  const history=Array.from({length:437},(_,i)=>{const d=dto('history-'+i,10);d.work_date=i<200?'2026-02-19':i<400?'2026-07-15':'2026-10-08';d.source_hash=c.reportHash_(d);return d;});
  for(let pass=0;pass<2;pass++){
    for(let i=0;i<history.length;i+=50){const r=call('report_sync_all',{tickets:history.slice(i,i+50),rebuild:false});assert(r.ok);assert.equal(r.inserted+r.updated+r.unchanged,history.slice(i,i+50).length);}
    const before=JSON.stringify(rows);assert(call('report_rebuild').ok);assert.equal(JSON.stringify(rows),before);assert.equal(rows.length,437);
    const status=call('report_status');assert.equal(status.active_count,437);assert.equal(status.earliest_date,'2026-02-19');assert.equal(status.latest_date,'2026-10-08');assert.equal(status.id_set_hash,crypto.createHash('sha256').update(JSON.stringify(history.map(d=>d.ticket_id).sort())).digest('hex'));
  }
  assert(call('report_delete',{deletes:[{ticket_id:'history-0',source_version:11}]}).ok);assert(call('report_rebuild').ok);assert.equal(rows.length,437);assert.equal(call('report_status').active_count,436);assert(rows[0].deleted_at);
  rows=baseline;cache.clear();
});
test('rate limiter bounded',()=>{let result;for(let i=0;i<50;i++)result=call('report_status');assert.equal(result.code,'RATE_LIMITED');});
test('arbitrary HTTP POST has no mutation path',()=>{const old=writes;c.ContentService={MimeType:{JSON:'json'},createTextOutput:body=>({setMimeType:()=>JSON.parse(body)})};assert.equal(c.doPost({postData:{contents:JSON.stringify({action:'report_upsert',ticket:dto('csrf')})}}).code,'METHOD_NOT_ALLOWED');assert.equal(writes,old);});
test('only report tabs can be targeted',()=>{const source=fs.readFileSync('gas/dispatcher-report/DispatcherReport.gs','utf8');assert(source.includes("getSheetByName('Заявки')"));assert(!source.includes('UrlFetchApp'));assert(!source.includes('getActiveSpreadsheet'));assert(source.includes('REPORT_SPREADSHEET_ID'));assert(source.includes('sheet.getRange(1,1,clearRows,5).breakApart().clear()'));});
function renderSheet(merges=[]){
  const calls=[],sheet={getLastRow:()=>2,getMaxRows:()=>1000,getRange:(row,col,height=1,width=1)=>{if(typeof row==='string'){assert.equal(row,'B2');row=2;col=2;}const range={};for(const method of ['breakApart','clear','merge','setValue','setValues','setRichTextValues','setNumberFormat','setWrap','setVerticalAlignment','setHorizontalAlignment','setFontFamily','setFontSize','setFontColor','setBackground','setBackgrounds','setFontWeight','setFontWeights','setBorder'])range[method]=(...args)=>{calls.push({method,row,col,height,width,args});return range;};range.getMergedRanges=()=>merges;return range;},setRowHeights:(...args)=>calls.push({method:'heights',args}),setColumnWidth:(...args)=>calls.push({method:'width',args}),setHiddenGridlines:()=>{}};
  return {sheet,calls,ss:{getSheetByName:name=>{assert.equal(name,'Отчет');return sheet;}}};
}
function spreadsheetAppMock(){
  return {BorderStyle:{SOLID:'solid',SOLID_THICK:'thick'},
    newTextStyle:()=>({setBold:()=>({build:()=>({bold:true})})}),
    newRichTextValue:()=>{const v={text:'',styles:[]};const api={setText:t=>(v.text=String(t),api),setStyle:(a,b,s)=>(v.styles.push([a,b,s]),api),build:()=>v};return api;}};
}
test('renderer creates B:E merged blocks and clears previous merge bottom',()=>{
  const old={getColumn:()=>5,getNumColumns:()=>1,getRow:()=>1,getNumRows:()=>30},mock=renderSheet([old]),input=[dto('a'),dto('b')],before=JSON.stringify(input);
  c.SpreadsheetApp=spreadsheetAppMock();actualRender(mock.ss,input);
  assert.equal(JSON.stringify(input),before);const clear=mock.calls.find(x=>x.method==='clear');assert.equal(clear.width,5);assert.equal(clear.height,30);
  assert(mock.calls.findIndex(x=>x.method==='breakApart')<mock.calls.findIndex(x=>x.method==='clear'));
  for(const col of [3,4,5])assert(mock.calls.some(x=>x.method==='merge'&&x.col===col&&x.height>1));
  assert(mock.calls.some(x=>x.method==='merge'&&x.col===2&&x.width===4));
  assert(mock.calls.some(x=>x.method==='setHorizontalAlignment'&&x.col===2&&x.width===4&&x.args[0]==='center'));
  assert(mock.calls.some(x=>x.method==='setBorder'&&x.col===2&&x.width===1&&x.args[5]===true&&x.args.at(-1)==='solid'));
  assert(mock.calls.filter(x=>x.method==='heights').every(x=>x.args[2]>=21));
  assert(mock.calls.some(x=>x.method==='setBorder'&&x.args.at(-1)==='thick'));
  assert(mock.calls.some(x=>x.method==='setBorder'&&x.width===4&&x.row===2&&x.args[0]===true&&x.args.at(-1)==='thick'));
  for(const col of [3,4,5])assert(mock.calls.some(x=>x.method==='setFontWeight'&&x.col===col&&x.args[0]==='bold'));
  assert(mock.calls.filter(x=>Number.isInteger(x.col)).every(x=>x.col+x.width-1<=5));
});
test('наряд title bold via rich text and thick separators only between adjacent наряды',()=>{
  c.SpreadsheetApp=spreadsheetAppMock();
  const mock=renderSheet(),input=[dto('a'),dto('b')];
  actualRender(mock.ss,input);
  const rich=mock.calls.find(x=>x.method==='setRichTextValues');
  assert(rich,'ticket titles rendered as rich text');
  const matrix=rich.args[0];
  assert.equal(matrix.length,input.length+3,'one rich row per block: spacer, month, day, 2 tickets');
  for(const row of matrix){assert.equal(row.length,1);}
  const ticketRows=matrix.slice(-2);
  for(const rowArr of ticketRows){
    const rich=rowArr[0];
    assert.equal(rich.styles.length,1,'exactly one bold run per наряд');
    assert.equal(rich.styles[0][0],0,'bold starts at the title');
    assert.equal(rich.styles[0][1],String(rich.text).indexOf('\n'),'bold covers only the title line');
  }
  // Rows: [topSpacer, monthHeader, day, ticket a, ticket b] → tickets at 4,5.
  const separators=mock.calls.filter(x=>x.method==='setBorder'&&x.col===2&&x.width===1&&x.height===1&&x.args[0]===true&&x.args.at(-1)==='thick');
  assert.equal(separators.length,1,'one thick top border between the two adjacent наряды');
  assert.equal(separators[0].row,5,'the separator sits above the second наряд');
  assert.deepEqual(separators[0].args.slice(1,4),[null,null,null],'only the between-наряды top edge is drawn');
  // Internal card rules stay plain text lines — never mixed with the separator.
  const ticketText=String(ticketRows[0][0].text);
  assert.ok(ticketText.includes('- - - - - - - - - - - -'),'inner thin rule stays a text line');
});
test('merge crossing report ownership fails before any clear',()=>{const mock=renderSheet([{getColumn:()=>5,getNumColumns:()=>2,getRow:()=>1,getNumRows:()=>3}]);assert.throws(()=>actualRender(mock.ss,[dto()]),/REPORT_LAYOUT_CONFLICT/);assert.equal(mock.calls.length,0);});
test('empty rebuild removes old overlays but not hidden source rows',()=>{const mock=renderSheet();actualRender(mock.ss,[]);assert(mock.calls.some(x=>x.method==='setValue'&&x.args[0]==='Нарядів поки немає'));assert(!mock.calls.some(x=>x.method==='merge'));});
console.log('Dispatcher GAS security/CRUD: '+tests+' PASS');
