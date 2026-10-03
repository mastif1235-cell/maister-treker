import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {workEvents,validateSemantic} from '../../src/ask/work-events.js';
import {runSmartQuery} from '../../src/ask/smart-query.js';
import {workIntent,workAnswer} from '../../src/ask/work-intent.js';
import {createAskOrchestrator} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';
import {ticketFromGasRow,redactTicket,assertNoForbidden} from '../../src/gas/mappers.js';

const base={id:'SYNTHETIC',date:'15.09.2026',time:'10:00',sum:100,type:'Підключення',macAddress:'001122334455',connectMasters:[],tags:[],equipment:[],presetWorks:[],additionalWork:[]};
const profile={entity:'onu',action:'install',category:'definite',signal_context:'subscriber',profile:'onu_physical'};
const analyze=(fields={},text='')=>workEvents({...base,...fields},text,{profile:'work_v2'});
const placed=a=>a.events.filter(e=>e.entity==='onu'&&['install','replace'].includes(e.action)&&e.category==='definite');
function context(tickets,texts=[]){return {tickets,shifts:[{date:base.date,coworker:'Петя'},{date:base.date,coworker:'Женя'}],searchIndex:tickets.map((t,i)=>({id:t.id,text:texts[i]||''}))};}

test('C1 real local -> sync JSON -> GAS mapper -> redaction -> semantic direct coworker round-trip',()=>{
 const source=fs.readFileSync(new URL('../../../app.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('function ticketToSyncPayload('),source.indexOf('function shiftToSyncPayload('));
 const sandbox={};vm.createContext(sandbox);vm.runInContext(fn,sandbox);
 for(const masters of [[{name:'Петя',letter:'П'},{name:'Артем',letter:'А'}],['Петя','Артем']]){
  const local={...base,connectMasters:masters,tags:['підключення','Петя','Артем']},before=JSON.stringify(local);
  const payload=sandbox.ticketToSyncPayload(local);const ticket=redactTicket(ticketFromGasRow(payload));
  assert.equal(payload.id,base.id);assert.equal(JSON.stringify(local),before);
  assert.deepEqual(JSON.parse(payload.fullDataJson).connectMasters,masters);
  assert.deepEqual(ticket.connectMasters,['Петя','Артем']);
  const result=runSmartQuery(context([ticket]),{mode:'list',coworker:'Петей',semantic:{entity:'connection',action:'complete',profile:'work_v2'}}).data;
  assert.equal(result.matched,1);assert.equal(result.evidence[0].coworker_reason,'direct_ticket');
 }
 const legacy=sandbox.ticketToSyncPayload({...base,connectMasters:undefined});
 assert.equal(Object.hasOwn(JSON.parse(legacy.fullDataJson),'connectMasters'),false);
 assert.equal(redactTicket(ticketFromGasRow(legacy)).connectMasters.length,0);
});
test('C2 exact historical tag is definite for a specific coworker, without any roster/shift',()=>{
 const t={...base,tags:['підключення','Женя','Артем']};
 const params={mode:'list',coworker:'Женей',semantic:{entity:'connection',action:'complete',profile:'work_v2'}};
 const data=runSmartQuery(context([t]),params).data;
 assert.equal(data.matched,1);assert.equal(data.work_totals.legacy_coworker_tickets,1);
 assert.equal(data.evidence[0].coworker_reason,'legacy_master_tag');assert.equal(data.evidence[0].events[0].category,'definite');
 assert.match(workAnswer(data,params),/історичному тезі самої заявки/);
 const unknown=runSmartQuery({...context([t]),shifts:[]},params).data;
 assert.equal(unknown.matched,1,'no roster or shift is required for the user-approved specific filter');
});
test('C3 same-day shift without a tag is not definite or a legacy ticket candidate',()=>{
 const data=runSmartQuery(context([base]),{mode:'count',coworker:'Петя',semantic:{entity:'connection',action:'complete',profile:'work_v2'}}).data;
 assert.equal(data.matched,0);assert.equal(data.work_totals.legacy_coworker_tickets,0);
});
for(const [id,masters,tags,coworker,shift,matched,reason] of [
 ['L1',[],['Женя','Артем','підключення'],'Женей','Петя',1,'legacy_master_tag'],
 ['L2',[],['Петя'],'Петя','Женя',1,'legacy_master_tag'],
 ['L3',[],[],'Петя','Петя',0,null],
 ['L4',['Петя'],['Женя'],'Петя','Женя',1,'direct_ticket'],
 ['L5',[],['важная заявка','ремонт'],'Петя','Петя',0,null],
 ['L6',[],['Женя'],'Женей',null,1,'legacy_master_tag']
])test(id+': specific coworker historical business rule',()=>{
 const ctx={tickets:[{...base,connectMasters:masters,tags}],shifts:shift?[{date:base.date,coworker:shift}]:[],searchIndex:[]};
 const params={mode:'list',coworker,semantic:{entity:'connection',action:'complete',profile:'work_v2'}};
 const data=runSmartQuery(ctx,params).data;assert.equal(data.matched,matched);
 if(reason)assert.equal(data.evidence[0].coworker_reason,reason);
 if(id==='L4'){
  const second=runSmartQuery(ctx,{...params,coworker:'Женя'}).data;
  assert.equal(second.matched,1);assert.equal(second.evidence[0].coworker_reason,'legacy_master_tag');
  const direct=runSmartQuery({...ctx,tickets:[{...ctx.tickets[0],tags:['Петя','Женя']}]},params).data;
  assert.equal(direct.evidence[0].coworker_reason,'direct_ticket','direct provenance wins when both exist');
 }
 if(id==='L1'){
  const other=runSmartQuery(ctx,{...params,coworker:'Артем'}).data;assert.equal(other.matched,1);
  assert.equal(runSmartQuery(ctx,{...params,coworker:'Петя'}).data.matched,0,'shift conflict never creates a second definite master');
 }
});
test('no fuzzy/substring legacy tags; general historical grouping remains direct-only; raw semantic filter supported',()=>{
 const params={mode:'list',coworker:'Женей',semantic:{entity:'connection',action:'complete',profile:'work_v2'}};
 for(const tags of [['Женечка'],['Женя extra'],['Же'],['старый Женя'],['Женей']])assert.equal(runSmartQuery(context([{...base,tags}]),params).data.matched,0,JSON.stringify(tags));
 const exact=runSmartQuery(context([{...base,tags:['  ЖЕНЯ  ']}]),params).data;assert.equal(exact.matched,1);
 const grouped=runSmartQuery(context([{...base,tags:['Петя','Женя'],connectMasters:['Артем']}]),{mode:'group',group_by:'coworker',semantic:params.semantic}).data;
 assert.deepEqual(grouped.groups.map(g=>g.key),['Артем'],'do not derive a general roster from tags');
 const raw=runSmartQuery(context([{...base,tags:['Женя']}],['подключили абонента']),{...params,semantic:{entity:'connection',action:'complete'}}).data;
 assert.equal(raw.matched,1);assert.equal(raw.evidence[0].coworker_reason,'legacy_master_tag');
});
for(const [id,text,fields,placements,reason] of [
 ['O1','',{},1,'derived_from_connection'],
 ['O2','ONU абонента',{},0,'customer_owned_onu'],
 ['O3','своя онушка клиента',{},0,'customer_owned_onu'],
 ['O4','перенос с другого адреса, ONU старая',{},0,'reused_onu_transfer'],
 ['O5','поставил ONU',{},1,'explicit_install'],
 ['O6','заменил ONU',{type:'Ремонт'},1,'explicit_replace'],
 ['O7','заменил БП ONU',{type:'Ремонт'},0,null],
 ['O8','ONU клиента не работает, поставил новую ONU',{},1,'explicit_install'],
 ['O9','',{macAddress:''},0,null],
 ['O10','',{signal:'-24'},1,'derived_from_connection']
])test(id+': approved ONU business boundary',()=>{
 const analysis=analyze(fields,text);assert.equal(placed(analysis).length,placements);
 if(reason)assert.ok(analysis.events.some(e=>e.reason===reason));
 if(id==='O1'||id==='O5'||id==='O10'){assert.equal(placed(analysis)[0].quantity,1);assert.equal(placed(analysis)[0].quantity_source,'business_derived');}
 if(id==='O7')assert.ok(analysis.events.some(e=>e.entity==='onu_power_supply'&&e.action==='replace'));
 if(id==='O10')assert.equal(analysis.signals[0].value,-24);
 if(['O2','O3','O4'].includes(id))assert.ok(analysis.events.some(e=>e.entity==='connection'&&e.action==='complete'&&e.category==='definite'));
 assert.ok(!JSON.stringify(analysis.events).includes(base.macAddress));
});
test('ownership/reuse RU UA dictionary, new explicit priority and PSU isolation',()=>{
 for(const text of ['власна ONU','обладнання абонента','ONU клієнта','перенесли з адреси, стара ONU','reused ONU'])assert.equal(placed(analyze({},text)).length,0,text);
 for(const text of ['переніс з адреси, замінив на нову ONU','ONU абонента, установил новую ONU'])assert.equal(placed(analyze({},text)).length,1,text);
 assert.equal(placed(analyze({},'заменил БП ONU клиента')).length,1,'PSU ownership must not mask a separate business-derived ONU');
});
test('connection+replacement deduplicates physical placement and keeps provenance; quantity conflicts conservative',()=>{
 const a=analyze({},'поставил ONU, заменил ONU');assert.equal(placed(a).length,1);assert.equal(placed(a)[0].reason,'explicit_replace');
  assert.equal(placed(analyze({},'поставил 2 ONU')).length,0,'one connection cannot silently override two explicit units');
  for(const text of ['поставил 2 новые ONU','установили две ONU','встановив дві ONU'])assert.equal(placed(analyze({},text)).length,0,'unparsed multi-unit claim stays ambiguous: '+text);
 for(const text of ['не поставил ONU','завтра поставим ONU','надо заменить ONU','завтра подключим абонента'])assert.equal(placed(analyze({},text)).length,0,text);
 assert.ok(!analyze().events.some(e=>e.entity==='router'));
});
test('physical breakdown, approved single-unit action fallback, all-set totals before paging',()=>{
 const texts=['','поставил ONU','заменил ONU','ONU абонента','перенос, старая ONU','поставил ONU'];
 const tickets=texts.map((_,i)=>({...base,id:'CASE'+i,type:i===2||i===5?'Ремонт':'Підключення'}));
 const data=runSmartQuery(context(tickets,texts),{mode:'list',limit:1,semantic:profile}).data;
 assert.deepEqual(data.work_totals.onu_breakdown,{new_connections:2,standalone_installs:1,replacements:1,total_physical_placements:4,customer_owned_excluded:1,reused_excluded:1});
  assert.equal(data.work_totals.quantity_sum,4);assert.equal(data.work_totals.quantity_unknown_events,0);
 assert.equal(data.work_totals.business_derived_quantity_events,2);assert.equal(data.evidence.length,1);
 assert.match(workAnswer(data,{mode:'list'}),/business-derived/);assertNoForbidden(data);
});
test('profile opt-in preserves v91.79 explicit events, fails closed on wrong/unknown profile',()=>{
 assert.equal(workEvents(base,'').events.length,0);
 assert.equal(workEvents(base,'заменил ONU').events[0].reason,'explicit_action');
 for(const semantic of [{...profile,profile:'unsafe'},{...profile,entity:'router'},{...profile,action:'replace'}])assert.equal(validateSemantic(semantic),null);
 assert.equal(runSmartQuery(context([base]),{semantic:{...profile,profile:'unsafe'}}).ok,false);
});
test('new ONU priority is action-scoped; excluded events never become physical totals',()=>{
 const a=analyze({},'заменил старую ONU, поставил новую ONU');
 assert.equal(placed(a).length,1);assert.equal(placed(a)[0].action,'install');
 assert.ok(a.events.some(e=>e.action==='replace'&&e.reason==='reused_onu_transfer'));
 const data=runSmartQuery(context([base],['ONU абонента']),{mode:'list',semantic:{...profile,category:'all'}}).data;
 assert.equal(data.work_totals.onu_breakdown.total_physical_placements,0);
 assert.equal(data.exclusion_evidence[0].reason,'customer_owned_onu');
 assert.ok(!JSON.stringify(data.exclusion_evidence).includes(base.macAddress));
});
test('specific legacy matches respect date/item filters and direct priority',()=>{
 const tickets=[{...base,id:'DIRECT',connectMasters:['Женя'],tags:['Женя']},{...base,id:'CANDIDATE',tags:['Женя']},{...base,id:'OLD',date:'01.08.2026',tags:['Женя']}];
 const ctx={...context(tickets),shifts:[{date:base.date,coworker:'Петя, Женя'}]};
 const params={mode:'list',date_from:'01.09.2026',date_to:'30.09.2026',coworker:'Женей',semantic:{entity:'connection',action:'complete',profile:'work_v2'}};
 const data=runSmartQuery(ctx,params).data;
 assert.equal(data.matched,2);assert.equal(data.work_totals.legacy_coworker_tickets,1);
 assert.equal(data.evidence.find(e=>e.ticket_id==='DIRECT').coworker_reason,'direct_ticket');
 assert.equal(data.evidence.find(e=>e.ticket_id==='CANDIDATE').coworker_reason,'legacy_master_tag');
 assert.equal(runSmartQuery(ctx,{...params,items:[{kind:'equipment',text:'router'}]}).data.matched,0);
 assert.equal(workIntent('Сколько подключений я провёл с Женей в сентябре?',new Date(2026,9,2),['Женя']).semantic.profile,'work_v2');
});
test('count -> both evidence follow-ups survive serialized context, preserve profile/date/coworker and evidence privacy',async()=>{
 const tickets=[{...base,connectMasters:['Петя']},{...base,id:'LEGACY',tags:['Петя']}],calls=[];
 const orch=createAskOrchestrator({groq:{chat(){throw new Error('no LLM arithmetic');}},toolDefs:TOOL_DEFINITIONS,tools:{query_tickets:async p=>{calls.push(p);return runSmartQuery(context(tickets),p);}}});
 const first=await orch.handle('Сколько ONU поставил с Петей в сентябре?',{now:new Date(2026,9,2,12),coworkerRoster:['Петя']});
 assert.equal(first.queryContext.resolved_filters.semantic.profile,'onu_physical');assert.equal(first.total,2);
 assert.match(first.answer,/legacy_master_tag/);
 for(const question of ['Показать заявки','Почему так посчитано?']){
  const follow=await orch.handle(question,{queryContext:JSON.parse(JSON.stringify(first.queryContext))});
  for(const key of ['semantic','date_from','date_to','coworker'])assert.deepEqual(calls.at(-1)[key],calls[0][key]);
  assert.match(follow.answer,/derived_from_connection/);assert.match(follow.answer,/direct_ticket/);assert.match(follow.answer,/legacy_master_tag/);
  assert.ok(!follow.answer.includes(base.macAddress));
 }
 assert.equal(workIntent('Сколько ONU было в сентябре?',new Date(2026,9,2)).semantic.action,undefined);
});
