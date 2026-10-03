import test from 'node:test';
import assert from 'node:assert/strict';
import {createAskOrchestrator} from '../../src/ask/orchestrator.js';
import {runSmartQuery} from '../../src/ask/smart-query.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';
import {temporalWorkIntent} from '../../src/ask/work-intent.js';
import {workEvents} from '../../src/ask/work-events.js';
import {readFile} from 'node:fs/promises';
const tickets=[['SEPT','15.09.2026','Підключення'],['AUG_CONNECT','15.08.2026','Підключення'],['AUG_REPAIR','18.08.2026','Ремонт']].map(([id,date,type])=>({id,date,type,connectMasters:['Женя'],tags:[],equipment:[{label:'ONU',qty:1}],note:'',cables:[]}));
test('September -> August changes only dates, retaining physical all-install scope and exact coworker after reload',async()=>{
 const calls=[];
 const o=createAskOrchestrator({toolDefs:TOOL_DEFINITIONS,groq:{chat(){throw new Error('Temporal continuation must not ask LLM to reconstruct filters');}},tools:{query_tickets:async p=>{calls.push(p);return runSmartQuery({tickets,shifts:[],searchIndex:[]},p);}}});
 const first=await o.handle('Сколько ONU я поставил с Женей за сентябрь?',{now:new Date('2026-10-03'),coworkerRoster:['Женя']});
 assert.equal(first.ok,true);
 const next=await o.handle('А в августе?',{now:new Date('2026-10-03'),queryContext:JSON.parse(JSON.stringify(first.queryContext))});
 assert.equal(next.ok,true);assert.equal(next.total,2);
 const p=calls.at(-1);assert.equal(p.date_from,'01.08.2026');assert.equal(p.date_to,'31.08.2026');assert.equal(p.coworker,'Женя');
 assert.deepEqual(p.semantic,calls[0].semantic);assert.equal(p.semantic.action,'install');assert.equal(p.semantic.profile,'onu_physical');assert.equal(p.type,undefined);assert.equal(p.mode,'count');
 assert.equal(next.queryContext.resolved_filters.coworker,'Женя');
 assert.match(next.answer,/август/);assert.doesNotMatch(next.answer,/только|на заменах/);
 const oldClient=await o.handle('А в августе?',{now:new Date('2026-10-03'),coworkerRoster:['Женя'],queryContext:{resolved_filters:first.queryContext.resolved_filters},history:[{role:'user',content:'Сколько ONU я поставил с Женей за сентябрь?'},{role:'assistant',content:first.answer}]});
 assert.equal(oldClient.ok,true);assert.equal(oldClient.total,2);assert.equal(calls.at(-1).mode,'count','pre-v91.84 serialized context restores count without changing filters');
});
test('fixed event regex dictionaries are compiled once; repeated analyses do not leak global-regex state',async()=>{
 const file=new URL('../../src/ask/work-events.js',import.meta.url);
 const raw=await readFile(file,'utf8');
 const instrumented=raw.replace(/from (['"])(\.[^'"]+)\1/g,(_m,_q,p)=>'from '+JSON.stringify(new URL(p,file).href)).replaceAll('new RegExp(','compileProbe(');
 const probe=await import('data:text/javascript;base64,'+Buffer.from('let n=0;function compileProbe(...args){n++;return new RegExp(...args);}\n'+instrumented+'\nexport function compilations(){return n;}').toString('base64'));
 const initial=probe.compilations();assert.ok(initial>0);
 const row={...tickets[1],note:'Установил ONU, сигнал -25'},sem={entity:'onu',action:'install',profile:'onu_physical',category:'definite'};
 const expected=workEvents(row,'',sem);
 for(let i=0;i<50;i++)assert.deepEqual(probe.workEvents(row,'',sem),expected);
 assert.equal(probe.compilations(),initial,'no per-ticket dictionary regex compilation');
});
test('explicit ONU б/у is not a new business-derived connection ONU; future replacement is not completed',()=>{
 const base={id:'SYNTHETIC_USED',date:'19.08.2026',type:'Підключення',macAddress:'001122334455',equipment:[],connectMasters:['Женя'],tags:[]};
 const sem={entity:'onu',action:'install',profile:'onu_physical',category:'definite'};
 const a=workEvents({...base,note:'ONU б/у'},'',sem);
 assert.equal(a.events.filter(e=>e.entity==='onu'&&e.category==='definite').length,0);
 assert.ok(a.contexts.some(e=>e.reason==='reused_onu_transfer'));
 for(const note of ['ONU оказалось что это бу','ONU (б/у)','ONU: бу','б/у ONU']){
  const a=workEvents({...base,note},'',sem);assert.equal(a.events.filter(e=>e.entity==='onu'&&e.category==='definite').length,0,note);
 }
 for(const note of ['ONU б/у, поставил новую ONU','БП ONU б/у, поставил ONU','БП ONU оказалось что это бу, поставил ONU','ONU новая и роутер это бу','не ONU б/у']){
  const a=workEvents({...base,note},'',sem);assert.equal(a.events.filter(e=>e.entity==='onu'&&e.category==='definite').reduce((s,e)=>s+e.quantity,0),1,note);
 }
 const oldFault=workEvents({...base,equipment:[{label:'ONU',qty:1}],note:'старая ONU гудит'},'',sem);
 assert.equal(oldFault.events.filter(e=>e.entity==='onu'&&e.category==='definite').reduce((s,e)=>s+e.quantity,0),1);
 const planned=workEvents({...base,type:'Ремонт',macAddress:'',note:'Если будет ещё пропадать будем делать замену ONU'},'',sem);
 assert.equal(planned.events.filter(e=>e.entity==='onu'&&e.category==='definite').length,0);
});
test('date-only grammar refuses additional constraints and never widens intentional work-type/action filters',()=>{
 const context={mode:'count',resolved_filters:{type:'Ремонт',coworker:'Женя',semantic:{entity:'onu',action:'replace',profile:'physical_consumption',category:'definite'}}};
 for(const q of ['А в августе?','А за серпень 2026?','за август 2026']){
  const p=temporalWorkIntent(q,new Date('2026-10-03'),context);assert.equal(p.date_from,'01.08.2026');assert.equal(p.date_to,'31.08.2026');assert.equal(p.type,'Ремонт');assert.deepEqual(p.semantic,context.resolved_filters.semantic);
 }
 for(const q of ['А в августе с Петей?','А в августе только замены?','А в августе и сентябре?','А в августе по улице Садовая?','А за неизвестный период?','А в маяке?'])assert.equal(temporalWorkIntent(q,new Date('2026-10-03'),context),null,q);
 const historical={...context,resolved_filters:{...context.resolved_filters,date_from:'01.09.2025',date_to:'30.09.2025'}};
 assert.equal(temporalWorkIntent('А в августе?',new Date('2026-10-03'),historical).date_from,'01.08.2025');
 assert.equal(temporalWorkIntent('А в августе 2026?',new Date('2026-10-03'),historical).date_from,'01.08.2026');
 assert.equal(temporalWorkIntent('А в августе?',new Date(),{...context,mode:'group'}),null);
 assert.equal(temporalWorkIntent('А в августе?',new Date(),null),null);
});
