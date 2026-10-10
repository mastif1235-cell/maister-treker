'use strict';
const assert=require('node:assert/strict');
const core=require('../js/dispatcher-report-core.js');

(async()=>{
  const {buildDTO}=await import('../js/dispatcher-report-projection.mjs');
  // Public fields explicitly supplied by the user. No private source-row JSON
  // was fetched; the two envelopes exercise structured and raw-import shapes.
  const note='Скажи какой тут тариф и есть ли задолженность';
  const publicTicket={id:'regression-public-railway-20260715',date:'15.07.2026',time:'00:00',
    type:'ПІДКЛЮЧЕННЯ',city:'Сурсько-Михайлівка',address:'пров. Залізничний, 4',
    tariff:400,payment:'Готівка',sum:3500,note,
    equipment:[{label:'ONU',qty:1,price:800},{label:'Роутер',qty:1,price:2300},
      {label:'Нульовий матеріал',qty:0,price:10}],cables:[{label:'UTP',meters:0}]};
  const rawImport={...publicTicket,cloudImported:true,type:'Підключення',city:'',address:'',
    tariff:0,payment:'',note:'',equipment:[],cables:[],
    content:'📋 ЗАЯВКА: ПІДКЛЮЧЕННЯ\n🏙️ Місто: Сурсько-Михайлівка\n📍 Адреса: пров. Залізничний, 4\n💎 Тариф: 400 грн\n🛠️ ONU: 1 шт. х 800 грн\n🛠️ Роутер: 1 шт. х 2300 грн\n🛠️ Нульовий матеріал: 0 шт. х 10 грн\n🔌 UTP: 0м х 10грн\n💳 Оплата: Готівка\n📝 '+note};
  assert.equal(400+800+2300,3500);
  for(const ticket of [publicTicket,rawImport]){
    const original=JSON.stringify(ticket),dto=await buildDTO(ticket,core,1);
    assert.equal(dto.work_date,'2026-07-15');assert.equal(dto.work_category,'connection');
    assert.equal(dto.city,'Сурсько-Михайлівка');
    assert.equal(dto.address_display,'Сурсько-Михайлівка, пров. Залізничний, 4');
    // v91.95: quantity + informational line price (raw and structured agree).
    assert.equal(dto.materials_display,'ONU — 1 шт. — 800 грн\nРоутер — 1 шт. — 2300 грн');
    assert.equal(dto.dispatcher_comment,'Тариф: 400 грн\n'+note);
    assert.equal(dto.payment_type,'Готівка');assert.equal(dto.payment_cash,3500);
    assert.equal(dto.payment_cashless,0);assert.equal(dto.total,3500);
    if(ticket===publicTicket){assert.equal(dto.onu_used,1);assert.equal(dto.router_used,1);}
    assert.equal(dto.mac_onu,'');
    for(const field of ['phone','macAddress','masterNote','geoLat','geoLng','content','fullDataJson'])assert(!Object.hasOwn(dto,field));
    const text=core.render([dto]).blocks.find(b=>b.kind==='ticket').text;
    for(const value of ['ONU — 1 шт.','Роутер — 1 шт.','Тариф: 400 грн',note])assert(text.includes(value));
    assert(text.replace(/\s/g,'').includes('3500грн'));
    assert(!text.includes('MAC:'));assert(!text.includes('Нульовий матеріал'));assert(!text.includes('UTP'));
    assert.equal(JSON.stringify(ticket),original,'presentation must not mutate the ticket');
  }
  console.log('PASS user-supplied July 15 public Railway case: tariff/materials/cash/total/note/privacy, structured + imported presentation');
})().catch(error=>{console.error(error);process.exitCode=1;});
