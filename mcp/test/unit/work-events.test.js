import test from 'node:test';
import assert from 'node:assert/strict';
import {workEvents,extractSignals,validateSemantic} from '../../src/ask/work-events.js';
import {runSmartQuery} from '../../src/ask/smart-query.js';
import {workIntent} from '../../src/ask/work-intent.js';
import {resolveDateRanges} from '../../src/ask/date-resolver.js';
import {projectQueryContext,sanitizeIncomingQueryContext} from '../../src/ask/query-context.js';
import {createAskOrchestrator} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';
import {createDataPipeline,createReadTools} from '../../src/tools/read.js';

const texts=['Установил ONU, сигнал -21','Сигнал ONU -29','Проверил ONU','Заменил БП ONU','Заменил ONU','Поставил ONU и роутер','С Петей подключили абонента, поставили ONU и роутер','ONU клиента, сигнал -25'];
const rows=texts.map((text,i)=>({id:'ABCDEFGH'[i],date:'15.09.2026',time:'10:00',sum:100,connectMasters:i===6?['Петя']:[],equipment:[],cables:[],presetWorks:[],additionalWork:[],tags:[]}));
const ctx={tickets:rows,shifts:[{date:'15.09.2026',coworker:'Петя',hours:8}],searchIndex:texts.map((text,i)=>({id:rows[i].id,text}))};
const count=(entity,action,extra={})=>runSmartQuery(ctx,{mode:'count',semantic:{entity,action},...extra}).data;
const now=new Date(2026,9,2,12);
test('A–H: actions and composite objects are not keyword mentions',()=>{
  assert.equal(count('onu','install').matched,3);
  assert.equal(count('onu','replace').matched,1);
  assert.equal(count('onu_power_supply','replace').matched,1);
  assert.equal(count('router','install').matched,2);
  assert.equal(count('connection','complete',{coworker:'Петей'}).matched,1);
  assert.equal(count('onu','install',{coworker:'Петей',date_from:'01.09.2026',date_to:'30.09.2026'}).matched,1);
  assert.equal(count('onu','install').work_totals.ambiguous_tickets,2);
  assert.equal(count('onu','install').work_totals.quantity_sum,0,'unknown quantity is not invented');
  assert.equal(count('onu','install').work_totals.events,3);
  assert.equal(count('onu','install').work_totals.money_sum,300);
  assert.equal(count('onu','install').work_totals.signal.min,-21);
});
test('compound entities mask components, verbs bind to the correct object',()=>{
  const result=workEvents(rows[0],'Заменил блок питания роутера; проверил ONU и поставил роутер');
  assert.deepEqual(result.events.map(e=>[e.entity,e.action]),[['router_power_supply','replace'],['onu','check'],['router','install']]);
  const supply=workEvents(rows[0],'Заменил блок питания ONU');
  assert.equal(supply.events.length,1);assert.equal(supply.events[0].entity,'onu_power_supply');
});
test('quantity is explicit, duplicate sources do not double count; mutation forbidden',()=>{
  const ticket={...rows[0],note:'Поставил 2 ONU',presetWorks:[{label:'Установил 2 ONU',qty:2}],equipment:[{label:'ONU',qty:20}]};
  const frozen=JSON.stringify(ticket);
  const result=workEvents(ticket,'Поставил 2 ONU');
  assert.equal(result.events.length,1);assert.equal(result.events[0].quantity,2);
  assert.equal(JSON.stringify(ticket),frozen);
  assert.equal(workEvents({...rows[0],equipment:[{label:'ONU'}]},'').events[0].category,'ambiguous');
});
test('negation, future work and mixed diagnostic clauses do not install equipment',()=>{
  for(const text of ['Не установил ONU','Нужно поставить ONU','Завтра поставим ONU','Если поставить ONU']){
    assert.equal(workEvents(rows[0],text).events[0].category,'excluded',text);
  }
  assert.equal(workEvents(rows[0],'Проверил ONU, поставил роутер').events.find(e=>e.entity==='onu').action,'check');
});
test('signals: subscriber/input/unlabelled; strict threshold and conflicting readings',()=>{
  const cases=[['сигнал -30','subscriber'],['Сигнал ONU -29','subscriber'],['ONU -31 dBm','subscriber'],['-27 dBm','unknown'],['вход -10','input']];
  for(const [text,context] of cases) assert.equal(extractSignals(text)[0].context,context,text);
  assert.equal(extractSignals('долг -30 грн').length,0);
  assert.equal(runSmartQuery(ctx,{mode:'count',semantic:{},signal_worse_than:-28}).data.matched,1);
  const conflict=workEvents(rows[0],'сигнал -29; сигнал -31');
  assert.ok(conflict.signals.every(s=>s.category==='ambiguous'));
  const mix=workEvents(rows[0],'вход -10; ONU -31 dBm');
  assert.deepEqual(mix.signals.map(s=>s.context),['input','subscriber']);
  const ambiguous=runSmartQuery({tickets:[rows[0]],shifts:[],searchIndex:[{id:'A',text:'-31 dBm'}]},{mode:'count',semantic:{},signal_worse_than:-28}).data;
  assert.equal(ambiguous.matched,0);assert.equal(ambiguous.work_totals.ambiguous_tickets,1);
});
test('unknown semantic values fail closed, ambiguous question clarifies',()=>{
  for(const semantic of [{entity:'made_up',action:'install'},{entity:'onu',action:'foobar'},{category:'maybe'},{login:'private'}]){
    assert.equal(validateSemantic(semantic),null);
    assert.equal(runSmartQuery(ctx,{semantic}).ok,false);
  }
  assert.equal(runSmartQuery(ctx,{semantic:{entity:'onu'}}).data.clarification,true);
  assert.equal(runSmartQuery(ctx,{semantic:{entity:'onu'},date_from:'01.09.2026',coworker:'Петя'}).data.resolved_filters.date_from,'01.09.2026','clarification preserves the period and coworker');
});
test('query filters survive evidence follow-up and invalid contexts never widen',()=>{
  const countResult=count('onu','install',{coworker:'Петя'});
  const context=projectQueryContext(countResult);
  const incoming=sanitizeIncomingQueryContext(context);
  const evidence=runSmartQuery(ctx,{...incoming.resolved_filters,mode:'list'}).data;
  assert.equal(evidence.matched,countResult.matched);
  assert.deepEqual(evidence.tickets.map(t=>t.id),['G']);
  assert.equal(evidence.evidence[0].events[0].action,'install');
  assert.equal(sanitizeIncomingQueryContext({resolved_filters:{semantic:{entity:'no'},city:'X'}}),null);
});
test('old query_tickets keyword and same-day shift behavior remains compatible',()=>{
  assert.equal(runSmartQuery(ctx,{mode:'count',items:[{text:'ONU'}]}).data.matched,8);
  assert.equal(runSmartQuery(ctx,{mode:'count',coworker:'Петя'}).data.matched,8);
  assert.equal(runSmartQuery(ctx,{mode:'count',semantic:{entity:'onu',action:'install'},coworker:'Петя'}).data.matched,1);
});
test('privacy: only matched vocabulary leaves the event extractor',()=>{
  const result=workEvents(rows[0],'Пароль: Установил ONU\nЛогін: secret\nПоставил ONU клиенту +380991234567; адрес Частная 123');
  assert.equal(result.events.length,1);
  assert.equal(result.events[0].evidence,'Поставил ONU');
  assert.ok(!JSON.stringify(result).includes('38099'));
  assert.ok(!JSON.stringify(result).includes('secret'));
});
test('periods resolve actual calendar boundaries, day interval wins',()=>{
  for(const [q,from,to] of [
    ['сегодня','02.10.2026','02.10.2026'],['вчера','01.10.2026','01.10.2026'],
    ['эта неделя','28.09.2026','04.10.2026'],['цей тиждень','28.09.2026','04.10.2026'],
    ['прошлая неделя','21.09.2026','27.09.2026'],['минулий тиждень','21.09.2026','27.09.2026'],
    ['этот месяц','01.10.2026','31.10.2026'],['прошлый месяц','01.09.2026','30.09.2026'],
    ['сентябрь','01.09.2026','30.09.2026'],['сентябрь 2026','01.09.2026','30.09.2026'],
    ['с 1 по 15 сентября','01.09.2026','15.09.2026'],['последние 30 дней','03.09.2026','02.10.2026'],
    ['за год','01.01.2026','31.12.2026']
  ]){const ranges=resolveDateRanges(q,now);assert.equal(ranges.length,1,q);assert.deepEqual([ranges[0].from,ranges[0].to],[from,to],q);}
  assert.deepEqual(resolveDateRanges('всё время',now),[]);
  assert.deepEqual(resolveDateRanges('с 31 по 32 сентября',now),[]);
});
test('acceptance questions -> deterministic semantic intents',()=>{
  for(const q of ['Сколько ONU поставил?','Сколько ONU заменил?','Сколько БП ONU заменил?','Сколько роутеров поставил?','Сколько подключений с Петей?','Сколько ONU поставил с Петей в сентябре?','Сколько заявок с сигналом хуже -28?','Сколько ONU было в сентябре?']) assert.ok(workIntent(q,now,['Петя']),q);
});
test('/ask count -> evidence: fresh same filter, no LLM guess or raw data exposure',async()=>{
  const calls=[];
  const orch=createAskOrchestrator({groq:{chat(){throw new Error('LLM should not count');}},tools:{query_tickets:async p=>{calls.push(p);return runSmartQuery(ctx,p);}},toolDefs:TOOL_DEFINITIONS});
  const first=await orch.handle('Сколько ONU поставил с Петей в сентябре?',{now,coworkerRoster:['Петя']});
  assert.equal(first.ok,true);assert.equal(first.total,1);
  const follow=await orch.handle('Показать заявки',{now,queryContext:first.queryContext});
  assert.equal(follow.ok,true);assert.equal(follow.total,1);
  assert.match(follow.answer,/G/);assert.match(follow.answer,/поставили ONU/);
  assert.deepEqual(calls[0].semantic.entity,calls[1].semantic.entity);
  const clarification=await orch.handle('Сколько ONU было в сентябре?',{now});
  assert.match(clarification.answer,/Що рахувати/);
});
test('GAS redacted pipeline works without snapshot schema changes',async()=>{
  const pipeline=createDataPipeline({getList:async()=>({ok:true,data:{tickets:[{id:'T',date:'15.09.2026',content:'Установил ONU, сигнал -21',sum:50,fullDataJson:JSON.stringify({connectMasters:[{name:'Петя'}]})}],shifts:[]}})});
  const tools=createReadTools({data:pipeline});
  const result=await tools.query_tickets({semantic:{entity:'onu',action:'install'},coworker:'Петей',mode:'count'});
  assert.equal(result.data.matched,1);assert.equal(result.data.work_totals.signal.min,-21);
});
test('all-set aggregates precede pagination: quantity, money, entity/action/date/month groups',()=>{
  const tickets=[{...rows[0],id:'Q1',sum:125,presetWorks:[{label:'Установка ONU',qty:2}]},{...rows[0],id:'Q2',sum:75,presetWorks:[{label:'Установка ONU',qty:3}]}];
  const fixture={tickets,shifts:[],searchIndex:[]};
  const query={semantic:{entity:'onu',action:'install'},limit:1};
  const data=runSmartQuery(fixture,{...query,mode:'list'}).data;
  assert.equal(data.tickets.length,1);assert.equal(data.work_totals.events,2);assert.equal(data.work_totals.quantity_sum,5);assert.equal(data.work_totals.money_sum,200);
  for(const group_by of ['entity','action','date','month','coworker']){
    const totals=runSmartQuery(fixture,{...query,mode:'group',group_by}).data.work_totals;
    assert.equal(totals.groups.length,1,group_by);assert.equal(totals.groups[0].quantity_sum,5);assert.equal(totals.groups[0].tickets,2);
  }
});
test('conflicting quantity remains ambiguous through three duplicated sources',()=>{
  const ticket={...rows[0],note:'Поставил 3 ONU',presetWorks:[{label:'Установка ONU',qty:2}]};
  const analysis=workEvents(ticket,'Поставил 2 ONU');
  assert.equal(analysis.events.length,1);assert.equal(analysis.events[0].category,'ambiguous');assert.equal(analysis.events[0].quantity,null);
});
test('legacy input-derived signal does not become subscriber; router never inherits ONU metric',()=>{
  const input=workEvents({...rows[0],signal:'-10'},'входной сигнал -10');
  assert.deepEqual(input.signals.map(s=>s.context),['input']);
  const analysis=workEvents(rows[0],'Поставил ONU и роутер; сигнал -21');
  assert.ok(analysis.events.find(e=>e.entity==='onu').metric);assert.equal(analysis.events.find(e=>e.entity==='router').metric,undefined);
  const result=runSmartQuery({tickets:[rows[0]],shifts:[],searchIndex:[{id:'A',text:'ONU -31 dBm'}]},{mode:'stats',semantic:{},has_signal:true}).data;
  assert.equal(result.stats.signal.worst,-31);assert.equal(result.work_totals.signal.min,-31);
});
test('unknown constraints never silently disappear in the deterministic shortcut',()=>{
  for(const q of ['Сколько ONU поставил в Киеве?','Сколько ONU поставил без напарника?','Сколько ONU поставил с 31 по 32 сентября?','Сколько ONU поставил за неизвестный период?','Скільки роутерів по 1500?']) assert.equal(workIntent(q,now),null,q);
  for(const q of ['Скільки ONU встановив цього місяця?','Скільки БП ONU замінив?']) assert.ok(workIntent(q,now),q);
});
test('future and infinitive free text are never proof of completed installation',()=>{
  for(const text of ['Поставлю ONU','Поставим ONU','Встановлю ONU','Встановимо ONU','Установить ONU','Встановити ONU']){
    assert.equal(workEvents(rows[0],text).events[0].category,'excluded',text);
  }
  const selected=workEvents({...rows[0],presetWorks:[{label:'Установить ONU',qty:1}]},'');
  assert.equal(selected.events[0].category,'definite');
});
test('one ticket signal is not assigned to multiple ONU actions',()=>{
  const result=workEvents(rows[0],'Поставил ONU; проверил ONU; сигнал -21');
  assert.equal(result.signals.length,1);
  assert.equal(result.events.filter(e=>e.metric).length,0);
});
