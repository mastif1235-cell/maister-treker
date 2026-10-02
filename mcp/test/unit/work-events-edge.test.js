import test from 'node:test';
import assert from 'node:assert/strict';
import {workEvents,semanticSignal} from '../../src/ask/work-events.js';
import {runSmartQuery} from '../../src/ask/smart-query.js';
import {createAskOrchestrator} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';

const ticket={id:'EDGE',date:'15.09.2026',time:'10:00',sum:100,connectMasters:[],equipment:[],presetWorks:[],additionalWork:[],tags:[]};
test('review: negation, planned and future never enter definite count',()=>{
  for(const text of ['не поставил ONU','надо заменить ONU','будем менять ONU','завтра поставим ONU']){
    const analysis=workEvents(ticket,text);
    assert.ok(analysis.events.length,text);
    assert.ok(analysis.events.every(e=>e.category==='excluded'),text);
  }
  const mixed=workEvents(ticket,'не поставил ONU, заменил роутер');
  assert.equal(mixed.events.find(e=>e.entity==='onu').category,'excluded');
  assert.equal(mixed.events.find(e=>e.entity==='router').category,'definite');
});
test('review: quantity word order; unsupported word numeral stays unknown',()=>{
  for(const text of ['поставил 2 ONU','2 ONU поставил']){
    const event=workEvents(ticket,text).events[0];
    assert.equal(event.action,'install');assert.equal(event.quantity,2,text);
  }
  assert.equal(workEvents(ticket,'установили две ONU').events[0].quantity,null);
});
test('review: several actions and compounds preserve separate real components',()=>{
  for(const [text,pairs] of [
    ['поставил ONU, заменил роутер',[['onu','install'],['router','replace']]],
    ['заменил БП ONU и проверил ONU',[['onu_power_supply','replace'],['onu','check']]],
    ['подключили абонента, поставили ONU, настроили роутер',[['connection','complete'],['onu','install'],['router','configure']]],
    ['поставил ONU и заменил БП ONU',[['onu','install'],['onu_power_supply','replace']]],
    ['поставил роутер и заменил блок питания роутера',[['router','install'],['router_power_supply','replace']]],
    ['встановив ONU, заменил БП ONU, підключили абонента',[['onu','install'],['onu_power_supply','replace'],['connection','complete']]]
  ]){
    const events=workEvents(ticket,text).events;
    assert.deepEqual(events.map(e=>[e.entity,e.action]),pairs,text);
    assert.ok(events.every(e=>e.category==='definite'),text);
  }
});
test('review: input/subscriber, exact boundary, uncertain continuation, multi-action metric',()=>{
  const mixed=workEvents(ticket,'вход -10, ONU -27');
  assert.equal(semanticSignal(mixed,{signal_context:'input'}),-10);
  assert.equal(semanticSignal(mixed,{signal_context:'subscriber'}),-27);
  for(const signal of [undefined,'-27','-29']){
    const repeated=workEvents({...ticket,signal},'ONU -27, потом -29');
    assert.equal(semanticSignal(repeated,{signal_context:'subscriber'}),null,'second reading must not be ignored');
  }
  assert.equal(semanticSignal(workEvents(ticket,'сигнал -28'),{signal_context:'subscriber'}),-28);
  assert.equal(semanticSignal(workEvents(ticket,'ONU -27, скидка -29 грн'),{signal_context:'subscriber'}),-27,'unrelated negative money is not a second reading');
  const ctx={tickets:[ticket],shifts:[],searchIndex:[{id:ticket.id,text:'сигнал -28'}]};
  assert.equal(runSmartQuery(ctx,{semantic:{},signal_worse_than:-28,mode:'count'}).data.matched,0);
  assert.equal(runSmartQuery(ctx,{semantic:{},signal_worse_or_equal:-28,mode:'count'}).data.matched,1);
  assert.ok(workEvents(ticket,'поставил ONU, проверил ONU, сигнал -28').events.every(e=>!e.metric));
});
test('review: direct multiple coworkers, blank names, same-day shift and grouping',()=>{
  const tickets=[{...ticket,id:'DIRECT',connectMasters:['Петя','Саша']},{...ticket,id:'SHIFT'},{...ticket,id:'EMPTY',connectMasters:['']}];
  const ctx={tickets,shifts:[{date:ticket.date,coworker:'Петя',hours:8}],searchIndex:tickets.map(t=>({id:t.id,text:'поставил ONU'}))};
  const params={semantic:{entity:'onu',action:'install'},coworker:'Петей',mode:'list'};
  assert.deepEqual(runSmartQuery(ctx,params).data.tickets.map(t=>t.id),['DIRECT']);
  const groups=runSmartQuery(ctx,{semantic:{entity:'onu',action:'install'},mode:'group',group_by:'coworker'}).data.work_totals.groups;
  assert.equal(groups.find(g=>g.key==='Петя').tickets,1);
  assert.equal(groups.find(g=>g.key==='Саша').tickets,1);
  assert.ok(!groups.some(g=>g.key===''));
  const objectNames={...ctx,tickets:[{...ticket,connectMasters:[{name:'Петя'},{name:'Саша'},{name:'Петя'},{name:''}]}],searchIndex:[{id:ticket.id,text:'поставил ONU'}]};
  const evidence=runSmartQuery(objectNames,params).data.evidence;
  assert.deepEqual(evidence[0].coworkers,['Петя','Саша']);
  assert.equal(runSmartQuery({...ctx,tickets:tickets.slice(0,2)},{coworker:'Петей',mode:'count'}).data.matched,0,'legacy inflection semantics must stay unchanged');
});
test('review: both evidence follow-ups keep exact semantic/date/coworker filters',async()=>{
  const calls=[];
  const ctx={tickets:[{...ticket,connectMasters:['Петя','Саша']}],shifts:[],searchIndex:[{id:ticket.id,text:'поставил ONU'}]};
  const orch=createAskOrchestrator({groq:{chat(){throw new Error('No approximate calculation');}},toolDefs:TOOL_DEFINITIONS,tools:{query_tickets:async p=>{calls.push(p);return runSmartQuery(ctx,p);}}});
  const first=await orch.handle('Сколько ONU поставил с Петей в сентябре?',{now:new Date(2026,9,2,12)});
  for(const question of ['Показать заявки','Почему так посчитано?']){
    const result=await orch.handle(question,{queryContext:JSON.parse(JSON.stringify(first.queryContext))});
    assert.equal(result.total,1);
    for(const key of ['semantic','date_from','date_to','coworker'])assert.deepEqual(calls.at(-1)[key],calls[0][key],key);
    assert.equal(result.queryContext.resolved_filters.semantic.entity,'onu');
  }
});
