'use strict';
const assert=require('node:assert/strict');
const core=require('../js/dispatcher-report-core.js');
(async()=>{
 const {buildDTO,projectWorks}=await import('../js/dispatcher-report-projection.mjs');
 const ticket={id:'synthetic-work-prices',date:'13.10.2026',time:'12:34',type:'Підключення',payment:'Готівка',sum:7050,callFee:500,tariff:300,equipment:[{id:'onu',label:'ONU',price:800},{id:'router',label:'Роутер',price:2300},{id:'ups',label:'ДБЖ',price:2500}],cables:[{label:'Оптика',meters:40,pricePerMeter:10}],presetWorks:[{id:'w1',label:'Пайка оптики',price:300,qty:1},{id:'w2',label:'Конектор',price:100,qty:1},{id:'w3',label:'Налаштування роутера',price:200,qty:1}],additionalWork:[{desc:'Прокладання кабелю в коробі',sum:450}],masterNote:'PRIVATE-CANARY'};
 const before=JSON.stringify(ticket),dto=await buildDTO(ticket,core,100);
 const expected='Пайка оптики — 300 грн\nКонектор — 100 грн\nНалаштування роутера — 200 грн\nПрокладання кабелю в коробі — 450 грн';
 assert.equal(dto.works_display,expected);assert.equal(dto.total,7050);assert.equal(dto.onu_used,1);assert.equal(JSON.stringify(ticket),before);
 const text=core.render([dto]).blocks.find(b=>b.kind==='ticket').text;
 for(const line of expected.split('\n'))assert.equal(text.split(line).length-1,1);
 let at=-1;for(const label of ['Матеріали:','Роботи:','Підключення —','Тариф —','Оплата:','Разом:']){const next=text.indexOf(label);assert(next>at);at=next;}
 const project=patch=>buildDTO({...ticket,presetWorks:[],additionalWork:[],...patch},core,100);
 for(const label of ['Пайка оптики','Конектор','Налаштування роутера','Будь-яка нова робота']){
  const d=await project({presetWorks:[{label,price:300,qty:1}]});assert.equal(d.works_display,label+' — 300 грн');
 }
 assert.equal((await project({presetWorks:[{label:'Без ціни',price:0}]})).works_display,'Без ціни');
 assert.equal((await project({presetWorks:[{label:'Без ціни'}]})).works_display,'Без ціни');
 assert.equal((await project({presetWorks:[{label:'Не обрано',price:999,checked:false}]})).works_display,undefined);
 assert.equal((await project({additionalWork:[{desc:'Ручна А',sum:450},{desc:'Ручна Б',sum:125}]})).works_display,'Ручна А — 450 грн\nРучна Б — 125 грн');
 const shared={id:'shared',label:'Та сама робота',price:100,qty:1};
 assert.equal((await project({presetWorks:[shared,shared],additionalWork:[{id:'shared',desc:shared.label,sum:100}]})).works_display,'Та сама робота — 100 грн');
 const distinct=await project({presetWorks:[{id:'a',label:'Однакове ім’я',price:100},{id:'b',label:'Однакове ім’я',price:200}],additionalWork:[{desc:'Однакове ім’я',sum:300},{desc:'Однакове ім’я',sum:300}]});
 assert.equal(distinct.works_display.split('\n').length,4,'different ids/anonymous manual rows not collapsed');
 const quantity=projectWorks({presetWorks:[{id:'q',label:'Конектори',qty:3,price:100}],additionalWork:[{desc:'Ручна кількість',qty:2,price:200,sum:350}]},core);
 assert.deepEqual(quantity.map(w=>[w.quantity,w.unit_price,w.line_total]),[[3,100,300],[2,200,350]]);
 const qdto=await project({presetWorks:[{label:'Конектори',qty:3,price:100}]});assert.equal(qdto.works_display,'Конектори — 3 шт. · 100 грн/шт. — 300 грн');
 const privateDto=await project({additionalWork:[{desc:'Монтаж\nmasterNote: PRIVATE-CANARY',sum:450}],note:'Примітка',masterNote:'PRIVATE-CANARY'});assert(!JSON.stringify(privateDto).includes('PRIVATE-CANARY'));assert.equal(privateDto.works_display,'Монтаж — 450 грн');assert(core.render([privateDto]).blocks.find(b=>b.kind==='ticket').text.endsWith('Примітка'));
 for(const patch of [{presetWorks:[{label:'Work',price:-1}]},{additionalWork:[{desc:'Work',sum:Infinity}]}])await assert.rejects(project(patch),/INVALID_NUMBER/);
 const empty=await project({});assert(!('works_display' in empty));
 console.log('PASS work prices: catalog/manual, qty/unit/line amount, stable-id dedup, distinct rows, saved total, privacy, ONU unchanged');
 console.log(expected);
})().catch(e=>{console.error(e);process.exitCode=1;});
