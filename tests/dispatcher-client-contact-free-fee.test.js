'use strict';
// Synthetic contacts only. No production browser, storage, queue or endpoint.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const core=require('../js/dispatcher-report-core.js');
const hash=d=>crypto.createHash('sha256').update(core.content(d)).digest('hex');
const card=d=>core.render([d]).layout.rows.find(r=>r.kind==='ticket').text.replace(/[\u00a0\u202f]/g,'');
const ordered=(text,parts)=>{let at=-1;for(const part of parts){const next=text.indexOf(part);assert(next>at,'missing/order: '+part);at=next;}};
(async()=>{
  const {buildDTO}=await import('../js/dispatcher-report-projection.mjs');
  const ticket={id:'synthetic-contact',date:'12.10.2026',time:'12:34',type:'Підключення',contractNumber:'123456',clientName:'Тестовий Тест Тестович',phone:'+380 (00) 000-00-01',city:'Тестове',address:'Тестова 4',macAddress:'AA:BB:CC:DD:EE:FF',connectMasters:['Майстер'],equipment:[{label:'ONU',qty:1,price:800}],cables:[],callFee:500,tariff:300,payment:'Готівка',sum:1600,note:'Публічна нотатка',masterNote:'PRIVATE-CANARY'};
  const before=JSON.stringify(ticket),paid=await buildDTO(ticket,core,100),text=card(paid);
  assert.equal(JSON.stringify(ticket),before,'saved ticket/callFee never modified');
  assert.equal(paid.client_name,ticket.clientName);assert.equal(paid.client_phone,ticket.phone);
  ordered(text,['Наряд №1','Договір №123456','📍 Тестове, Тестова 4','👤 ПІБ: '+ticket.clientName,'📞 Телефон: '+ticket.phone,'🔢 MAC: '+ticket.macAddress,'Напарник:','Матеріали:','Підключення — 500 грн','Тариф — 300 грн','Оплата:','Разом: 1600 грн','Диспетчеру:']);
  assert.equal(text.split(ticket.phone).length-1,1);assert.equal(text.split('Тестове').length-1,1);assert(text.endsWith(ticket.note));
  assert.equal(paid.total,ticket.sum);assert.equal(core.stats([paid]).total,ticket.sum);
  const repair=await buildDTO({...ticket,type:'Ремонт',callFee:300,sum:1400},core,100);
  assert(card(repair).includes('Виклик — 300 грн'));assert(!card(repair).includes('Підключення —'));
  for(const type of ['Ремонт','Підключення']){
    const original={...ticket,type,payment:'Безкоштовно',sum:0,callFee:type==='Ремонт'?300:500},snapshot=JSON.stringify(original);
    const free=await buildDTO(original,core,100),s=card(free);
    assert(!('service_fee' in free));assert(!s.includes('Виклик —'));assert(!s.includes('Підключення —'));
    assert(s.includes('Оплата: Безкоштовно'));if(type==='Ремонт')assert(s.includes('Разом: 0 грн'));
    assert(!card({...free,service_fee:original.callFee}).includes(type==='Ремонт'?'Виклик —':'Підключення —'),'legacy positive fee hidden by formatter too');
    assert.equal(free.tariff_amount,300,'tariff semantics unchanged');assert(s.includes('Тариф — 300 грн'));
    assert.equal(free.materials_json,paid.materials_json);assert.equal(free.materials_display,paid.materials_display);
    assert.equal(core.stats([free]).onu_used,core.stats([paid]).onu_used);assert.equal(JSON.stringify(original),snapshot);
  }
  for(const [patch,label,field] of [[{clientName:''},'ПІБ:','client_name'],[{phone:''},'Телефон:','client_phone'],[{macAddress:''},'MAC:'],[{contractNumber:''},'Договір'],[{connectMasters:[]},'Напарник:'],[{equipment:[]},'Матеріали:'],[{callFee:0},'Підключення —'],[{tariff:0},'Тариф —'],[{note:''},'Диспетчеру:']]){
    const d=await buildDTO({...ticket,...patch},core,100);assert(!card(d).includes(label),'omit '+label);if(field)assert(!(field in d));
  }
  assert(card({...paid,address_display:''}).includes('🏙 Тестове'));assert(!text.includes('🏙'));
  for(const note of ['Телефон: '+ticket.phone,'phone: '+ticket.phone,'Зателефонувати '+ticket.phone,'Зателефонувати 380000000001']){
    const d=await buildDTO({...ticket,note},core,100);
    assert(!/380|000-00-01/.test(d.dispatcher_comment),'free-text phone removed');assert.equal(d.client_phone,ticket.phone);
    assert.equal(card(d).split(ticket.phone).length-1,1);
  }
  for(const note of ['+380 (67) 123-45-67','123 45 67','123-456-789','Телефон: +380 (67) 123-45-67','phone: 1234567']){
    assert.equal(core.sanitizeComment(note),'','7–15 digit free-text phone removed');
    const d=await buildDTO({...ticket,note},core,100);
    assert.equal(d.dispatcher_comment,'');assert.equal(d.client_phone,ticket.phone);
    assert.equal(card(d).split(ticket.phone).length-1,1,'structured phone still renders exactly once');
  }
  const numericNote='25 м; 300 грн; 1 шт.; 12:34; 12.10.2026; AA:BB:CC:DD:EE:FF';
  assert.equal(core.sanitizeComment(numericNote),numericNote,'quantities/money/time/date/MAC intact');
  assert.equal((await buildDTO({...ticket,note:numericNote},core,100)).dispatcher_comment,numericNote);
  for(const value of ['a1234567b','1234567890123456'])assert.equal(core.sanitizeComment(value),value,'retain original token boundaries');
  const raw=await buildDTO({...ticket,clientName:'',phone:'',cloudImported:true,note:undefined,content:'👤 ПІБ: Тестовий Тест\n📞 Телефон: +380000000001\n📝 phone: +380000000001'},core,100);
  assert(!('client_name' in raw));assert(!('client_phone' in raw));assert(!raw.dispatcher_comment.includes('380'));
  const other=await buildDTO({...ticket,type:'Інше',otherNote:'Лише нотатка'},core,100);
  for(const field of ['contract_number','client_name','client_phone','service_fee','tariff_amount'])assert(!(field in other));
  assert.equal(card({...paid,work_type:'Інше',dispatcher_comment:'Лише нотатка'}),'📋 Наряд №1 · 🕒 12:34 · Інше\nЛише нотатка');
  for(const value of ['=SUM(1,2)','+380=1','+380000000001\n=1','@evil','secret: value','https://example.invalid','123','+380000000001;1'])await assert.rejects(buildDTO({...ticket,phone:value},core,100),/INVALID_CLIENT_PHONE/);
  for(const value of ['=HYPERLINK','@evil','secret value','https://example.invalid','Тест\nІнший','123','x'.repeat(161)])await assert.rejects(buildDTO({...ticket,clientName:value},core,100));
  assert.throws(()=>core.validate({...paid,phone:ticket.phone}),/UNKNOWN_OR_MISSING_FIELD/,'raw phone key remains forbidden');
  assert.throws(()=>core.validate({...paid,masterNote:'private'}),/UNKNOWN_OR_MISSING_FIELD/);
  for(const [field,value] of [['client_name','Інший Тест'],['client_phone','+380000000002']])assert.notEqual(hash({...paid,[field]:value}),paid.source_hash,'contact hash-bound: '+field);
  // Freeze every prior canonical field order, not merely validation success.
  const legacy={...paid};delete legacy.client_name;delete legacy.client_phone;
  const oldFields=[...core.FIELDS,'materials_json','contract_number','service_fee','tariff_amount'],content={};
  for(const k of oldFields)if(!['source_version','source_hash','updated_at'].includes(k)&&legacy[k]!==undefined)content[k]=legacy[k];
  legacy.source_hash=crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
  assert.equal(hash(legacy),legacy.source_hash);assert.deepEqual(core.validate(legacy),legacy);
  assert.deepEqual(core.stats([paid]),core.stats([legacy]),'contact presentation never changes aggregates');
  console.log('PASS client contacts/free fee A-O: order, omission, saved totals, privacy, typed validation, old hashes and unchanged materials');
})().catch(e=>{console.error(e);process.exitCode=1;});
