import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {workEvents} from '../../src/ask/work-events.js';
import {ticketFromGasRow,redactTicket,publicBackupText} from '../../src/gas/mappers.js';
import {runSmartQuery} from '../../src/ask/smart-query.js';
import {workIntent} from '../../src/ask/work-intent.js';
import {resolveRosterCoworker} from '../../src/ask/coworker-names.js';
import {createAskOrchestrator} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';
const base={id:'SYNTHETIC',date:'15.09.2026',time:'10:00',type:'Підключення',macAddress:'001122334455',tags:[],connectMasters:[],sum:0};
const placements=text=>workEvents(base,text,{profile:'work_v2'}).events.filter(e=>e.entity==='onu'&&e.category==='definite'&&['install','replace'].includes(e.action));
test('H3 temporal phrases never become coworker filters',()=>{
 for(const q of ['Сколько ONU поставил с сентября','Сколько ONU поставил с понедельника']){
  const intent=workIntent(q,new Date(2026,9,3),[{name:'Петя'}]);assert.equal(intent?.coworker,undefined);assert.equal(intent.clarification,true,'unsupported since-date is clarified, never silently broadened');
 }
});
test('roster case forms resolve uniquely, dynamically, never via substring/fuzzy',()=>{
 const roster=['Артем','Петя','Женя','Паша','Олег'];
 for(const [target,forms] of [['Петя',['Петя','Петей','Пете','Петю']],['Женя',['Женя','Женей','Жене','Женю']],['Паша',['Паша','Пашей','Паше','Пашу']],['Артем',['Артем','Артём','Артема','Артемом']],['Олег',['Олег','Олегом']]])for(const query of forms)assert.equal(resolveRosterCoworker(query,roster),target,query);
 for(const query of ['Тем','Женечка','сентября','Ваня'])assert.equal(resolveRosterCoworker(query,roster),null);
 assert.equal(resolveRosterCoworker('Паше',['Паша','Пашя']),null,'two supported case forms are ambiguous');
});
test('unknown temporal/person constraint never enters queryContext or follow-up',async()=>{
 const orch=createAskOrchestrator({groq:{chat(){throw Error('no LLM fallback');}},toolDefs:TOOL_DEFINITIONS,tools:{query_tickets(){throw Error('no fabricated coworker filter');}}});
 for(const question of ['Сколько ONU поставил с сентября','Сколько ONU поставил с понедельника','Сколько ONU поставил с Женечкой']){
  const result=await orch.handle(question,{coworkerRoster:['Женя','Петя']});assert.equal(result.ok,true);assert.equal(result.meta.clarification,true);assert.equal(result.queryContext,null);
 }
});
test('L2 direct semantic coworker cannot match substring or unrelated names',()=>{
 for(const [query,stored] of [['Аня','Ваня'],['Тем','Артем'],['Влад','Владимир'],['Ян','Янина']]){
  const result=runSmartQuery({tickets:[{...base,connectMasters:[stored]}],shifts:[],searchIndex:[]},{mode:'count',coworker:query,semantic:{entity:'onu',action:'install',profile:'onu_physical'}});
  assert.equal(result.data.matched,0,query+' != '+stored);
 }
});
test('L1 malformed MAC cannot supply business-derived evidence',()=>{
 for(const macAddress of ['0','1A2B','not-a-mac'])assert.equal(workEvents({...base,macAddress},'',{profile:'work_v2'}).events.filter(e=>e.reason==='derived_from_connection').length,0);
});
for(const text of ['Перенесли роутер в зал','Перенос розетки','Візит перенесли, потім підключили'])test('H2 unrelated transfer does not exclude ONU: '+text,()=>assert.equal(placements(text).length,1));
test('ONU context must stay in same clause; unrelated router ownership does not exclude ONU',()=>{
 for(const text of ['перенесли\nONU проверили','перенос розетки; ONU проверили','роутер абонента','клиентский роутер'])assert.equal(placements(text).length,1,text);
});
test('valid MAC formats still derive one ONU without exposing its value',()=>{
 for(const macAddress of ['001122334455','00:11:22:33:44:55','00-11-22-33-44-55','0011.2233.4455']){
  const event=workEvents({...base,macAddress},'',{profile:'work_v2'}).events.find(e=>e.reason==='derived_from_connection');assert.equal(event.quantity,1);assert.ok(!JSON.stringify(event).includes(macAddress));
 }
});
test('privacy section resumes only at known section, not arbitrary labels',()=>{
 const safe=publicBackupText('public\nПриватна примітка майстра: password SECRET\nперенос ONU абонента\nАдреса: PRIVATE\nГеолокація: https://maps.example.test\nЛогін: SECRET_LOGIN\nПовніДаніJSON: {"password":"SECRET"}');
 assert.ok(safe.includes('public'));assert.ok(safe.includes('Геолокація:'));for(const value of ['PRIVATE','SECRET','перенос ONU'])assert.ok(!safe.includes(value));
});
test('structured private textarea cannot reopen indexing with marker-looking text',()=>{
 const masterNote='SECRET\nГеолокація: private MAC 001122334455\nперенос ONU абонента\nФИО тест, телефон 0501234567\nПароль: hidden';
 const mapped=ticketFromGasRow({id:'PRIVACY',tags:[],backupNote:'Приватна примітка майстра: '+masterNote,fullDataJson:JSON.stringify({...base,masterNote,note:'публічна робота'})});
 for(const value of ['SECRET','001122334455','перенос ONU','0501234567','ФИО тест','hidden'])assert.ok(!mapped.searchableText.includes(value));assert.ok(mapped.searchableText.includes('публічна робота'));
});
for(const text of ['клиентская ONU','абонентская ONU','клієнтська ONU','абонентська ONU'])test('customer-owned adjective excludes derived ONU: '+text,()=>assert.equal(placements(text).length,0));
for(const text of ['перенос ONU абонента','перенесли старую ONU','reuse ONU','старая ONU'])test('ONU-owned/reuse context still excludes: '+text,()=>assert.equal(placements(text).length,0));
test('H1 real sync chain removes entire multiline masterNote from index and analytics',()=>{
 const source=fs.readFileSync(new URL('../../../app.js',import.meta.url),'utf8');const sandbox={};vm.createContext(sandbox);vm.runInContext(source.slice(source.indexOf('function ticketToSyncPayload('),source.indexOf('function shiftToSyncPayload(')),sandbox);
 const ticket={...base,masterNote:'Wi-Fi пароль: SECRET\nперенос ONU абонента\nтелефон 0501234567',login:'LOGIN_SENTINEL',note:'публічна примітка'};
 const payload=sandbox.ticketToSyncPayload(ticket),mapped=ticketFromGasRow(payload),redacted=redactTicket(mapped);
 for(const value of ['SECRET','перенос ONU абонента','0501234567','LOGIN_SENTINEL'])assert.ok(!mapped.searchableText.includes(value),value);
 assert.ok(mapped.searchableText.includes('публічна примітка'));
 const result=runSmartQuery({tickets:[redacted],shifts:[],searchIndex:[{id:base.id,text:mapped.searchableText}]},{mode:'list',semantic:{entity:'onu',action:'install',profile:'onu_physical'}}).data;
 assert.equal(result.matched,1);assert.equal(result.evidence[0].events[0].reason,'derived_from_connection');
 assert.ok(!JSON.stringify(result.evidence).includes('SECRET'));
});
