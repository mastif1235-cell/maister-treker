'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),core=require('../js/dispatcher-report-core.js');
let count=0;function test(name,fn){fn();count++;}
function fixture(id='safe-1',date='2026-09-30',time='12:34'){
  const d=Object.fromEntries(core.FIELDS.map(k=>[k,'']));Object.assign(d,{ticket_id:id,work_date:date,work_time:time,work_type:'Ремонт',work_category:'repair',address_display:'Місто, Вулиця 106, кв. 29',payment_type:'Готівка',amount:100,total:100,onu_used:1,onu_replacement:1,router_used:0,payment_cash:100,payment_cashless:0,payment_free_amount:0,payment_free_count:0,updated_at:'2026-10-06T00:00:00.000Z',source_version:1791244800000});d.source_hash=crypto.createHash('sha256').update(core.content(d)).digest('hex');return d;
}
test('exact 27-field DTO',()=>assert.equal(core.FIELDS.length,27));
test('popup report flow does not broaden the application frame CSP',()=>{for(const name of ['index.html','_headers'])assert(!/frame-src/.test(fs.readFileSync(path.join(root,name),'utf8')));assert(!fs.readFileSync(path.join(root,'js/dispatcher-report-client.js'),'utf8').includes("createElement('iframe')"));});
test('unknown field rejected',()=>assert.throws(()=>core.validate({...fixture(),masterNote:'private'}),/UNKNOWN/));
test('private content rejected',()=>assert.throws(()=>core.validate({...fixture(),dispatcher_comment:'password: abc'}),/PRIVACY/));
for(const s of ['geoLat: 48.45, geoLng: 35.05','latitude 48.45 longitude 35.05','location: 48.45, 35.05','https://maps.google.com/?q=48.45,35.05','ONU signal before: -25; after: -20','signal -18 dBm','optical level: -18 dBm'])test('inline sensitive fragment '+s,()=>assert.equal(core.sanitize('виконано, '+s+', працює'),'виконано, працює'));
test('multiline private tail excluded',()=>assert.equal(core.sanitize('виконано\nmasterNote:\nНЕ ПЕРЕДАВАТИ\nсекрет'),'виконано'));
test('work/address/negative amounts not erased',()=>assert.equal(core.sanitize('Вулиця 106, кв.29; сума 500, різниця -15'),'Вулиця 106, кв.29; сума 500, різниця -15'));
test('MAC permitted explicit field',()=>assert.equal(core.validate({...fixture(),mac_onu:'AA:BB:CC:DD:EE:FF'}).mac_onu,'AA:BB:CC:DD:EE:FF'));
for(const [key,value] of [['work_date','2026-02-30'],['work_time','24:15'],['updated_at','2026-02-30T00:00:00.000Z'],['onu_used',-1],['onu_used',1.5],['payment_cash',99]])test('bad '+key+' rejected',()=>assert.throws(()=>core.validate({...fixture(),[key]:value})));
test('no mutation',()=>{const t=fixture(),before=JSON.stringify(t);core.validate(t);core.render([t]);assert.equal(JSON.stringify(t),before);});
test('date/time descending and ID ascending',()=>assert.deepEqual(core.sorted([fixture('b'),fixture('a'),fixture('later','2026-10-01'),fixture('late-time','2026-09-30','23:59')]).map(r=>r.ticket_id),['later','late-time','a','b']));
test('daily numbering restarts',()=>{const x=core.render([fixture('a'),fixture('b'),fixture('c','2026-10-01')]);assert.equal(x.blocks.filter(b=>b.kind==='ticket'&&b.text.startsWith('📋 Наряд №1')).length,2);});
test('daily numbering chronological: 4 existing + 13:41 = Наряд №5, next = №6',()=>{
  const day='2026-10-10';
  const rows=['08:00','09:15','10:30','11:45'].map((t,i)=>fixture('old-'+i,day,t));
  const fifth=fixture('fifth',day,'13:41'),sixth=fixture('sixth',day,'15:00');
  const x=core.render([...rows,fifth]);
  const texts=Object.fromEntries(x.blocks.filter(b=>b.kind==='ticket').map(b=>[b.key,b.text]));
  for(let i=0;i<4;i++)assert.ok(texts['old-'+i].startsWith('📋 Наряд №'+(i+1)),'existing ticket '+(i+1)+' keeps chronological number');
  assert.ok(texts.fifth.startsWith('📋 Наряд №5'),'the 13:41 ticket is Наряд №5');
  const y=core.render([...rows,fifth,sixth]);
  const yTexts=Object.fromEntries(y.blocks.filter(b=>b.kind==='ticket').map(b=>[b.key,b.text]));
  assert.ok(yTexts.fifth.startsWith('📋 Наряд №5'),'№5 is stable after the next ticket');
  assert.ok(yTexts.sixth.startsWith('📋 Наряд №6'),'the next ticket is Наряд №6');
  // Display order stays newest-first; numbering does not depend on it.
  assert.deepEqual(y.blocks.filter(b=>b.kind==='ticket').map(b=>b.key),['sixth','fifth','old-3','old-2','old-1','old-0']);
  // Same numbers in the sheet layout; deterministic under any input order.
  assert.ok(y.layout.rows.find(r=>r.key==='fifth').text.startsWith('📋 Наряд №5'));
  assert.equal(JSON.stringify(y),JSON.stringify(core.render([sixth,fifth,...rows.slice().reverse()])));
});
test('cross-month week unified; monthly independent',()=>{const x=core.render([fixture('s'),fixture('o','2026-10-01')]);assert.equal(Object.keys(x.weekly).length,1);assert.equal(x.weekly['2026-09-28'].ticket_count,2);assert.equal(x.monthly['2026-09'].ticket_count,1);assert.equal(x.monthly['2026-10'].ticket_count,1);assert.equal(x.blocks.filter(b=>b.kind==='weekly').length,1);assert.equal(x.blocks.filter(b=>b.kind==='monthly').length,2);assert(x.blocks.findIndex(b=>b.kind==='weekly')>x.blocks.findIndex(b=>b.kind==='day'&&b.key==='2026-09-30'));});
test('B tickets, C daily, D weekly, E monthly aligned spans',()=>{
  const rows=[fixture('a','2026-10-07'),fixture('b','2026-10-07'),fixture('c','2026-10-07'),fixture('d','2026-10-06'),fixture('e','2026-10-01'),fixture('f','2026-09-30'),fixture('g','2026-09-23')],before=JSON.stringify(rows),x=core.render(rows),l=x.layout;
  assert.equal(JSON.stringify(rows),before);assert.deepEqual(l.rows.filter(r=>r.kind==='day').map(r=>r.key),['2026-10-07','2026-10-06','2026-10-01','2026-09-30','2026-09-23']);
  assert.deepEqual(l.rows.filter(r=>r.kind==='monthHeader').map(r=>r.text),['ЖОВТЕНЬ 2026','ВЕРЕСЕНЬ 2026']);
  assert.equal(l.rows[0].kind,'topSpacer');assert.equal(l.rows[0].text,'');
  assert.equal(l.rows.filter(r=>r.kind==='ticket'&&r.text.startsWith('📋 Наряд №1')).length,5);
  assert.equal(l.rows.filter(r=>r.kind==='ticket'&&r.text.startsWith('📋 Наряд №3')).length,1);
  assert.equal(l.spans.filter(s=>s.kind==='daily').length,5);assert.equal(l.spans.filter(s=>s.kind==='weekly').length,3);assert.equal(l.spans.filter(s=>s.kind==='monthly').length,2);
  for(const frame of l.dayFrames){const s=l.statFrames.find(s=>s.kind==='daily'&&s.key===frame.key);assert.equal(s.column,3);assert.equal(s.row,frame.row);assert.equal(s.height,frame.height);assert(l.spans.some(s=>s.kind==='dailyHeader'&&s.row===frame.row));}
  const week=l.spans.find(s=>s.kind==='weekly'&&s.key==='2026-09-28'),oct=l.dayFrames.find(s=>s.key==='2026-10-01'),sep=l.dayFrames.find(s=>s.key==='2026-09-30');
  assert.equal(week.column,4);assert.equal(week.row,oct.row+1);assert.equal(week.row+week.height,oct.row+oct.height);
  const continuation=l.statFrames.find(s=>s.kind==='weeklyContinuation'&&s.key==='2026-09-28');assert.equal(continuation.row,sep.row);assert.equal(continuation.height,sep.height);
  for(const cut of l.monthSeparators)assert(!l.spans.some(s=>s.row<cut&&s.row+s.height>cut),'merge hides month separator');
  const occupied=new Set();for(const s of l.spans){for(let row=s.row;row<s.row+s.height;row++)for(let column=s.column;column<s.column+s.width;column++){const k=row+':'+column;assert(!occupied.has(k),'overlapping merge '+k);occupied.add(k);}}
  assert(l.spans.filter(s=>s.kind==='monthly').every(s=>s.column===5));
  for(const title of l.spans.filter(s=>s.kind==='monthHeader')){assert.equal(title.column,2);assert.equal(title.width,4);const monthly=l.statFrames.find(s=>s.kind==='monthly'&&s.key===title.key);assert.equal(monthly.row,title.row+1);const frames=l.dayFrames.filter(s=>s.key.startsWith(title.key));assert.equal(monthly.height,frames.reduce((n,s)=>n+s.height,0));}
  assert.equal(Object.values(x.daily).reduce((n,s)=>n+s.total,0),700);assert.equal(Object.values(x.weekly).reduce((n,s)=>n+s.total,0),700);assert.equal(Object.values(x.monthly).reduce((n,s)=>n+s.total,0),700);
});
test('cards have sections, numeric equipment and payment icons without text guessing',()=>{
  const r={...fixture(),materials_display:'ONU 99; роутер 99',onu_used:2,router_used:1,dispatcher_comment:'Виконано'};
  const text=core.render([r]).layout.rows.find(s=>s.kind==='ticket').text;
  for(const label of ['📋 Наряд №1','🕒 12:34','🛠 Ремонт','📍','📦 Матеріали:','💵 Оплата:','💰 Сума:','🧾 Разом:','📝 Диспетчеру:'])assert(text.includes(label));
  assert.equal(core.stats([r]).onu_used,2,'statistics use numeric counters, not material text');assert.equal(core.stats([r]).router_used,1);
  assert.equal(text.split('- - - - - - - - - - - -').length,4);
  assert(core.render([{...r,payment_cashless:100,payment_cash:0}]).layout.rows.find(s=>s.kind==='ticket').text.includes('💳'));
  assert(core.render([{...r,payment_free_count:1,payment_cash:0,total:0}]).layout.rows.find(s=>s.kind==='ticket').text.includes('🆓'));
});
test('layout excludes tombstones and contains only formatted whitelist',()=>{const x=core.render([{...fixture('deleted'),deleted_at:'now'},fixture('visible')]);assert.deepEqual(x.layout.rows.filter(r=>r.kind==='ticket').map(r=>r.key),['visible']);assert(!JSON.stringify(x.layout).includes('source_hash'));assert.equal(core.render([]).layout.rows.length,0);});
test('one aggregator all counters',()=>{const rows=[fixture('a'),{...fixture('b'),work_category:'connection',onu_replacement:0,router_used:1,payment_cash:0,payment_cashless:100},{...fixture('f'),amount:0,total:0,payment_cash:0,payment_free_count:1,payment_free_amount:50}];const x=core.stats(rows);assert.equal(x.total,200);assert.equal(x.onu_used,3);assert.equal(x.onu_replacement,2);assert.equal(x.connections,1);assert.equal(x.repairs,2);assert.equal(x.payment_cash,100);assert.equal(x.payment_cashless,100);assert.equal(x.payment_free_count,1);assert.equal(x.working_days,1);});
test('five identical syncs no doubles',()=>{const rows=[];for(let i=0;i<5;i++)core.upsert(rows,fixture());assert.equal(rows.length,1);assert.equal(core.stats(rows).onu_used,1);});
test('edit replaces instead of appending',()=>{const rows=[];core.upsert(rows,fixture());const d={...fixture(),onu_used:2,source_version:fixture().source_version+1};d.source_hash=crypto.createHash('sha256').update(core.content(d)).digest('hex');core.upsert(rows,d);assert.equal(rows.length,1);assert.equal(rows[0].onu_used,2);});
test('soft-delete excluded and tombstone blocks delayed upsert',()=>{const rows=[];core.upsert(rows,fixture());core.remove(rows,'safe-1',fixture().source_version+2,'2026-10-06T00:01:00Z');assert.equal(core.render(rows).blocks.length,0);assert.throws(()=>core.upsert(rows,fixture()),/STALE/);assert.equal(rows.length,1);});
test('missing ID delete retains tombstone',()=>{const rows=[];core.remove(rows,'safe-1',fixture().source_version+1,'now');assert.throws(()=>core.upsert(rows,fixture()),/STALE/);});
for(const n of [100,500,1000])test(n+' tickets render+rebuild deterministic',()=>{const rows=Array.from({length:n},(_,i)=>fixture('test-'+i,'2026-09-'+String(i%30+1).padStart(2,'0'))),a=core.render(rows);assert.equal(a.blocks.filter(b=>b.kind==='ticket').length,n);assert.equal(JSON.stringify(a),JSON.stringify(core.render(rows)));assert.equal(a.monthly['2026-09'].ticket_count,n);});

async function asyncTests(){
  const {buildDTO}=await import('../js/dispatcher-report-projection.mjs');
  const ticket={id:'synthetic-1',date:'30.09.2026',time:'12:34',type:'Ремонт',city:'Місто',address:'Вулиця 106, кв.29',sum:100,payment:'Готівка',equipment:[{label:'ONU',qty:1}],macAddress:'AA:BB:CC:DD:EE:FF',connectMasters:['Майстер'],note:'Замінено ONU, signal -18 dBm, працює',masterNote:'PRIVATE-CANARY',geoLat:48.45,geoLng:35.05,phone:'PHONE-CANARY',photo:'PHOTO-CANARY'};
  const before=JSON.stringify(ticket),dto=await buildDTO(ticket,core);assert.equal(JSON.stringify(ticket),before);assert.equal(dto.onu_used,1);assert.equal(dto.onu_replacement,1);assert.equal(dto.dispatcher_comment,'Замінено ONU, працює');assert.equal(dto.mac_onu,ticket.macAddress);assert.deepEqual(Object.keys(dto),core.FIELDS);for(const v of ['PRIVATE-CANARY','PHONE-CANARY','PHOTO-CANARY','48.45','35.05','dBm'])assert(!JSON.stringify(dto).includes(v));count++;
  const connection=await buildDTO({...ticket,type:'Підключення',equipment:[],note:'На старій ONU гудять дроселі'},core);assert.equal(connection.onu_used,1);count++;
  const reuse=await buildDTO({...ticket,type:'Підключення',equipment:[],note:'Залишили стару ONU'},core);assert.equal(reuse.onu_used,0);count++;
  const formula=await buildDTO({...ticket,note:'=IMPORTXML("evil")'},core);assert.equal(formula.dispatcher_comment,'=IMPORTXML("evil")'); // server must reject, not execute
  const context={globalThis:{},URL,setTimeout,clearTimeout};vm.runInNewContext(fs.readFileSync(path.join(root,'js/dispatcher-report-client.js'),'utf8'),context);
  const {createOutbox,endpoint}=context.globalThis.MTDispatcherReportClient;
  assert.throws(()=>endpoint('https://example.com/exec'));assert.throws(()=>endpoint('https://script.google.com/macros/s/abc/exec?secret=x'));count++;
  for(const value of ['', 'not-a-url','https://user:password@script.google.com/macros/s/abc/exec','https://script.google.com:444/macros/s/abc/exec'])assert.throws(()=>endpoint(value),/INVALID_ENDPOINT/);count++;
  const store=new Map(),storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};let now=Date.now(),sends=0,result={ok:true},timers=[];
  const cfg={dispatcherReportEnabled:true,dispatcherReportEndpoint:'https://script.google.com/macros/s/synthetic/exec',scriptUrl:'legacy-unchanged'},deps={storage,settings:()=>cfg,ticket:()=>ticket,tickets:()=>[ticket],dto:async(t,v)=>buildDTO(t,core,v),send:async()=>{sends++;return result;},requestId:()=>crypto.randomUUID(),now:()=>now,setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},online:()=>true};
  const q=createOutbox(deps);q.enqueueUpsert(ticket);assert.equal(sends,0);assert(![...store.values()].join('').includes('PRIVATE-CANARY'));assert(![...store.values()].join('').includes('Вулиця'));await q.flush();assert.equal(sends,1);assert.equal(q.status().pending,0);assert.equal(cfg.scriptUrl,'legacy-unchanged');count++;
  const brokenTimer=createOutbox({...deps,storage:{getItem:()=>null,setItem:()=>{}},setTimeout:()=>{throw new TypeError('Illegal invocation');}});assert.equal(brokenTimer.enqueueUpsert(ticket),false);assert.equal(brokenTimer.status().lastError,'REPORT_QUEUE_ERROR');assert.equal(brokenTimer.status().pending,1);count++;
  result={ok:false,code:'REPORT_NETWORK_ERROR'};q.enqueueUpsert(ticket);for(let i=0;i<5;i++){now+=180000;await q.flush();}assert.equal(q.status().failed,1);assert.equal(sends,4);count++;
  const restored=createOutbox(deps);assert.equal(restored.status().failed,1);await restored.flush();assert.equal(sends,4);count++;
  result={ok:false,code:'PRIVACY_REJECTED'};restored.retry();await restored.flush();assert.equal(restored.status().failed,1);await restored.flush();assert.equal(sends,5);count++;
  cfg.dispatcherReportEndpoint='https://script.google.com/macros/s/another/exec';q.enqueueDelete('synthetic-2');const metadata=JSON.parse(store.get('mtDispatcherReportOutboxV1'));assert.equal(metadata.operations.length,2,'endpoint edit must not discard pending work');assert.equal(metadata.operations[1].id,'synthetic-2');count++;
  const original=fs.readFileSync(path.join(root,'Code.gs'),'utf8');assert(!original.includes('report_upsert'));assert(!fs.readFileSync(path.join(root,'js/sync-contract.js'),'utf8').includes('report_upsert'));count++;
  // Material pricing display (v91.95): quantity + informational line price
  // from real ticket/calculator data; total is never increased by it.
  const priced={id:'priced-1',date:'10.10.2026',time:'13:41',type:'Підключення',city:'Тест',address:'Тестова 1',sum:6000,payment:'Готівка',
    equipment:[{label:'ДБЖ',checked:true,qty:1,price:2500},{label:'Роутер',checked:true,qty:1,price:2300},{label:'ONU',checked:true,qty:1,price:800}],
    cables:[{label:'Оптика',meters:40,pricePerMeter:10}],note:'',masterNote:''};
  const pricedDto=await buildDTO(priced,core);
  assert.equal(pricedDto.total,6000,'total stays 6000');
  assert.equal(pricedDto.amount,6000,'amount stays 6000');
  const lines=pricedDto.materials_display.split('\n');
  assert.deepEqual(lines.slice(0,3),['ДБЖ — 1 шт. — 2500 грн','Роутер — 1 шт. — 2300 грн','ONU — 1 шт. — 800 грн']);
  assert.ok(lines.includes('Оптика — 40 м — 400 грн'),'cable line shows meters × pricePerMeter');
  assert.equal(lines.length,4,'each material exactly once');
  assert.equal(core.stats([pricedDto]).total,6000,'statistics do not double count');
  const pricedRows=[];for(let i=0;i<5;i++)assert.equal(core.upsert(pricedRows,pricedDto),i?'unchanged':'inserted');
  assert.equal(pricedRows.length,1);assert.equal(core.stats(pricedRows).total,6000,'repeat sync never inflates total');
  const raw=await buildDTO({id:'raw-1',date:'10.10.2026',time:'12:00',type:'Ремонт',sum:300,payment:'Готівка',cloudImported:true,
    content:'📋 ЗАЯВКА: РЕМОНТ\n🛠️ ДБЖ: 1 шт. х 2500 грн\n🔌 Оптика: 40м х 10грн = 400грн'},core);
  assert.ok(raw.materials_display.includes('ДБЖ — 1 шт. — 2500 грн'),'raw content price tail is decoded');
  assert.ok(raw.materials_display.includes('Оптика — 40 м — 400 грн'),'raw explicit total wins over unit price');
  const zero=await buildDTO({id:'zero-1',date:'10.10.2026',time:'12:00',type:'Ремонт',sum:0,payment:'Безкоштовно',
    equipment:[{label:'Free-part',checked:true,qty:1,price:0},{label:'Hidden-part',checked:true,qty:0,price:5}],cables:[],note:'',masterNote:''},core);
  assert.deepEqual(zero.materials_display.split('\n'),['Free-part — 1 шт.'],'zero price shows quantity only; zero quantity hidden');
  count++;
  console.log('Dispatcher contract/projection/outbox: '+count+' PASS');
}
asyncTests().catch(e=>{console.error(e);process.exitCode=1;});
