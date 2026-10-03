import test from 'node:test';
import assert from 'node:assert/strict';
import {workEvents} from '../../src/ask/work-events.js';
import {runSmartQuery} from '../../src/ask/smart-query.js';
import {workIntent,workAnswer} from '../../src/ask/work-intent.js';
import {ticketFromGasRow,redactTicket} from '../../src/gas/mappers.js';
import fs from 'node:fs';
import vm from 'node:vm';
import {projectQueryFilters} from '../../src/ask/query-context.js';
const base={id:'SYNTHETIC',date:'15.09.2026',time:'10:00',type:'Ремонт',macAddress:'',connectMasters:[],tags:[],equipment:[],cables:[],presetWorks:[],additionalWork:[]};
const profile={profile:'physical_consumption',category:'definite'};
const analyze=(fields,text='')=>workEvents({...base,...fields},text,profile).events.filter(e=>e.category==='definite');
const count=(fields,text='',entity='onu')=>analyze(fields,text).filter(e=>e.entity===entity).reduce((n,e)=>n+e.quantity,0);
test('date groups keep local units instead of inheriting global mixed-unit total',()=>{
 const tickets=[{...base,id:'PCS',equipment:[{label:'ONU',qty:2}]},{...base,id:'METERS',date:'16.09.2026',cables:[{label:'UTP',meters:35}]}];
 const data=runSmartQuery({tickets,shifts:[],searchIndex:[]},{mode:'group',group_by:'date',semantic:profile}).data;
 assert.equal(data.work_totals.quantity_sum,null);
 assert.match(data.work_totals.count_policy,/structured > explicit > business_derived/);
 assert.deepEqual(data.work_totals.groups.map(g=>[g.key,g.quantity_sum,g.unit]).sort(),[['15.09.2026',2,'pcs'],['16.09.2026',35,'m']]);
});
test('generic material query, English PSU compounds and custom separator label',()=>{
 const params=workIntent('Сколько всего материалов списать за сентябрь?',new Date('2026-10-03T12:00:00Z'));
 assert.equal(params.mode,'group');assert.equal(params.semantic.profile,'physical_consumption');
 const t={...base,equipment:[{label:'ONU PSU',qty:1},{label:'PSU ONU',qty:1},{label:'Крепление | X',qty:3}],cables:[{label:'UTP',meters:35}]};
 assert.equal(count(t),0);assert.equal(count(t,'','onu_power_supply'),2);
 const data=runSmartQuery({tickets:[t],shifts:[],searchIndex:[]},{mode:'group',group_by:'entity',semantic:profile}).data;
 assert.equal(data.work_totals.quantity_sum,null);assert.equal(data.work_totals.consumption_totals.length,3);
 assert.ok(data.work_totals.consumption_totals.some(e=>e.entity==='material:крепление | x'&&e.quantity===3));
 assert.ok(!workAnswer(data,params).includes('null'));
});
for(const [name,fields,text,expected] of [
 ['connection MAC',{type:'Підключення',macAddress:'001122334455'},'',1],
 ['connection MAC selected',{type:'Підключення',macAddress:'001122334455',equipment:[{label:'ONU',qty:1}]},'',1],
 ['repair priced',{equipment:[{label:'ONU',qty:1,price:100}]},'',1],
 ['repair free',{equipment:[{label:'ONU',qty:1,price:0}]},'',1],
 ['repair dedup',{equipment:[{label:'ONU',qty:1}]},'замена ONU',1],
 ['explicit two',{},'поставил 2 ONU',2],
 ['explicit two with MAC',{type:'Підключення',macAddress:'001122334455'},'поставил 2 ONU',2],
 ['customer',{},'ONU абонента',0],['reuse',{},'reused ONU',0],['transfer',{},'перенесли ONU из другой комнаты',0],
 ['signal',{},'сигнал ONU -24',0],['planned',{},'нужно заменить ONU',0],['negated',{},'ONU не менял',0],
 ['selected customer',{equipment:[{label:'ONU',qty:1}]},'клиентская ONU',0],
 ['explicit new customer',{equipment:[{label:'ONU',qty:1}]},'ONU абонента, поставил новую ONU',1],
 ['unrelated transfer',{type:'Підключення',macAddress:'001122334455'},'перенос роутера',1],
 ['saved selected no native qty',{equipment:[{label:'ONU',price:0}]},'',1]
])test('ONU physical: '+name,()=>assert.equal(count(fields,text),expected));
for(const [name,fields,text,expected] of [
 ['selected',{equipment:[{label:'Роутер',qty:1}]},'',1],['free',{equipment:[{label:'Роутер',qty:1,price:0}]},'',1],
 ['customer',{},'роутер клиента',0],['old',{},'перенесли старый роутер',0],['replacement',{},'заменил роутер',1],
 ['dedup',{equipment:[{label:'Роутер',qty:1}]},'поставил роутер',1],['new priority',{},'роутер клиента, поставил новый роутер',1]
])test('router physical: '+name,()=>assert.equal(count(fields,text,'router'),expected));
for(const [name,fields,text,expected] of [
 ['structured',{cables:[{label:'UTP',meters:35}]},'',35],['zero',{cables:[{label:'UTP',meters:0}]},'',0],
 ['explicit',{},'использовал 20 м кабеля',20],['unknown',{},'кабель протянули',0],['negated',{},'не использовал 20 м кабеля',0]
])test('cable physical: '+name,()=>assert.equal(count(fields,text,'cable'),expected));
test('structured zero/unchecked preserved through actual GAS mapper; legacy qty unchanged',()=>{
 for(const item of [{label:'ONU',qty:0},{label:'ONU',checked:false},{label:'ONU',qty:-1}]){
  const t=redactTicket(ticketFromGasRow({id:base.id,date:base.date,fullDataJson:JSON.stringify({...base,equipment:[item]})}));
  assert.equal(t.equipment[0].consumption_qty,0);assert.equal(count(t),0);
 }
});
test('PSU component identity, custom catalog item, meters and pieces never summed',()=>{
 const t={...base,equipment:[{label:'БП ONU',qty:2},{label:'Крепление X',qty:3}],cables:[{label:'UTP',meters:35}]};
 assert.equal(count(t,'','onu'),0);assert.equal(count(t,'','onu_power_supply'),2);
 const data=runSmartQuery({tickets:[t],shifts:[],searchIndex:[]},{mode:'group',group_by:'entity',semantic:profile}).data;
 assert.equal(data.work_totals.quantity_sum,null);assert.equal(data.work_totals.consumption_totals.length,3);
 assert.ok(data.work_totals.consumption_totals.some(e=>e.entity==='cable'&&e.unit==='m'&&e.quantity===35));
});
test('private masterNote ignored and original ticket never mutated',()=>{
 const t={...base,masterNote:'поставил 9 ONU\nиспользовал 999 м кабеля',password:'private',equipment:[{label:'ONU',qty:1}]},before=JSON.stringify(t);
 assert.equal(count(t),1);assert.equal(count(t,'','cable'),0);assert.equal(JSON.stringify(t),before);
 assert.ok(!JSON.stringify(analyze(t)).includes('private'));
});
for(const [question,entity,type,action] of [
 ['Сколько ONU поставил за сентябрь?','onu',undefined,'install'],
 ['Сколько ONU заменил на ремонтах за сентябрь?','onu','Ремонт','replace'],
 ['Сколько ONU на подключениях за сентябрь?','onu','Підключення','install'],
 ['Сколько ONU списать за сентябрь?','onu',undefined,'install'],
 ['Сколько роутеров поставил за сентябрь?','router',undefined,'install'],
 ['Сколько кабеля использовал за сентябрь?','cable',undefined,'install'],
 ['Сколько всего оборудования использовал за сентябрь?',undefined,undefined,'install']
])test('physical intent: '+question,()=>{
 const p=workIntent(question,new Date('2026-10-03T12:00:00Z'),[]);assert.ok(p,question);assert.equal(p.semantic.entity,entity);assert.equal(p.type,type);assert.equal(p.semantic.action,action);assert.ok(['onu_physical','physical_consumption'].includes(p.semantic.profile));assert.equal(p.date_from,'01.09.2026');assert.equal(p.date_to,'30.09.2026');
});
test('mixed job query counts all quantities and work type filter narrows physical result',()=>{
 const tickets=[{...base,id:'A',type:'Підключення',equipment:[{label:'ONU',qty:1}]},{...base,id:'B',equipment:[{label:'ONU',qty:2,price:0}]}];
 const ctx={tickets,shifts:[],searchIndex:[]};
 const params=workIntent('Сколько ONU поставил за сентябрь?',new Date('2026-10-03'),[]),all=runSmartQuery(ctx,params).data;
  assert.equal(all.work_totals.quantity_sum,3);assert.equal(all.work_totals.onu_breakdown.total_physical_placements,3);assert.match(workAnswer(all,params),/3 ONU/);
 const repair=runSmartQuery(ctx,workIntent('Сколько ONU заменил на ремонтах за сентябрь?',new Date('2026-10-03'),[])).data;
 assert.equal(repair.work_totals.quantity_sum,2);assert.equal(repair.matched,1);
});
test('explicit new priority is action-scoped, numeric new claim and unknown plurals are safe',()=>{
 assert.equal(count({},'заменил 2 ONU абонента, поставил новую ONU'),1);
 assert.equal(count({},'ONU клиента, поставил 2 новые ONU'),2);
 assert.equal(count({type:'Підключення',macAddress:'001122334455'},'поставил несколько ONU'),0);
 assert.equal(count({},'использовал 0 ONU'),0);
 assert.equal(count({},'не использовал ONU'),0);
 assert.equal(count({},'протянул 20.5 м кабеля','cable'),20.5);
 assert.equal(count({},'использовал -20 м кабеля','cable'),0);
});
test('real ticket sync serialization preserves selected free stock, cable meters, private note and snapshot v4 compatibility',()=>{
 const app=fs.readFileSync(new URL('../../../app.js',import.meta.url),'utf8');
 const fn=app.slice(app.indexOf('function ticketToSyncPayload('),app.indexOf('function shiftToSyncPayload(')),sandbox={};vm.createContext(sandbox);vm.runInContext(fn,sandbox);
 const local={...base,equipment:[{id:'onu',label:'ONU',price:0},{id:'router',label:'Роутер',price:0}],cables:[{id:'utp',label:'UTP',meters:35,pricePerMeter:0}],masterNote:'поставил 7 ONU\nиспользовал 999 м кабеля'},before=JSON.stringify(local);
 const payload=sandbox.ticketToSyncPayload(local),mapped=redactTicket(ticketFromGasRow(payload));
 assert.equal(payload.id,local.id);assert.equal(JSON.stringify(local),before);assert.equal(count(mapped),1);assert.equal(count(mapped,'','router'),1);assert.equal(count(mapped,'','cable'),35);
 // Existing v4 records can omit the additive read-only numeric hint. The saved
 // equipment list still means one selected item; no ticket/schema rewrite.
 const old=JSON.parse(JSON.stringify(mapped));old.equipment.forEach(e=>delete e.consumption_qty);assert.equal(count(old),1);assert.equal(count(old,'','cable'),35);
 assert.ok(!JSON.stringify(mapped).includes('masterNote'));
});
test('server follow-up whitelist preserves exact physical/type/date/coworker context and rejects invalid work actions',()=>{
 const filters={type:'Ремонт',date_from:'01.09.2026',date_to:'30.09.2026',coworker:'Петя',semantic:{entity:'router',action:'install',category:'definite',signal_context:'subscriber',profile:'physical_consumption'}};
 assert.deepEqual(projectQueryFilters(JSON.parse(JSON.stringify(filters))),filters);
 assert.equal(projectQueryFilters({semantic:{profile:'physical_consumption',action:'check'}}),null);
 const bad=runSmartQuery({tickets:[base],shifts:[],searchIndex:[]},{semantic:{profile:'physical_consumption',entity:'connection'}});assert.equal(bad.ok,false);
});
test('actual default work catalog PSU is material; setup, crimp and splice services are not inventory',()=>{
 assert.equal(count({presetWorks:[{label:'Блок живлення оптичного термінала',qty:1,price:0}]},'','onu_power_supply'),1);
 assert.equal(count({equipment:[{label:'БП ONU',qty:1}],presetWorks:[{label:'БП ONU',qty:1}]},'','onu_power_supply'),1,'mirrored billing rows are not two physical PSUs');
 const fields={presetWorks:[{label:'Налаштування роутера',qty:1},{label:'Переобжати конектор RJ-45',qty:2},{label:'Пайка оптичного кабелю',qty:3}]};
 assert.equal(count(fields,'','router'),0);assert.equal(count(fields,'','connector'),0);assert.equal(count(fields,'','fiber'),0);
});
test('meters require real units; work quantity and conflicting length claims do not invent cable length',()=>{
 assert.equal(count({},'протянул 20 кабеля','cable'),0);
 assert.equal(count({presetWorks:[{label:'Прокладка кабелю',qty:35}]},'','cable'),0);
 assert.equal(count({presetWorks:[{label:'Прокладка 20 м кабелю',qty:3}]},'','cable'),20);
 assert.equal(count({},'протянул 20 м кабеля; протянул 35 м кабеля','cable'),0);
 assert.equal(count({type:'Підключення',macAddress:'001122334455'},'поставил 2 ONU; поставил 3 ONU'),0);
});
test('generic component consumption uses shared entity dictionary for ownership/reuse/new priority',()=>{
 assert.equal(count({equipment:[{label:'БП ONU',qty:1}]},'БП ONU клиента','onu_power_supply'),0);
  assert.equal(count({equipment:[{label:'Коннектор',qty:1}]},'старый коннектор','connector'),0);
 assert.equal(count({equipment:[{label:'Коннектор',qty:1}]},'коннектор клиента, поставил новый коннектор','connector'),1);
 assert.equal(count({type:'Підключення',macAddress:'001122334455'},'заменил БП ONU клиента'),1,'component ownership does not mask separate derived ONU');
});
