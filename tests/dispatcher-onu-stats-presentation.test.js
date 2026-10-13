'use strict';
// Synthetic, presentation-only regression. No live data, storage or network.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const core=require('../js/dispatcher-report-core.js');
function fixture(id,category,quantity,materials){
  const dto=Object.fromEntries(core.FIELDS.map(k=>[k,'']));
  Object.assign(dto,{ticket_id:id,work_date:'2026-10-13',work_time:'12:00',work_type:category==='connection'?'Підключення':'Ремонт',work_category:category,
    payment_type:'Готівка',amount:800,total:800,onu_used:quantity,onu_replacement:category==='repair'?quantity:0,router_used:0,
    payment_cash:800,payment_cashless:0,payment_free_amount:0,payment_free_count:0,updated_at:'2026-10-13T12:00:00.000Z',source_version:1,
    materials_json:core.materialJSON(materials),materials_display:'ONU — 1 шт. — 800 грн'});
  dto.source_hash=crypto.createHash('sha256').update(core.content(dto)).digest('hex');return core.validate(dto);
}
const rows=[fixture('connection','connection',13,[{label:'ONU',quantity:13,unit:'шт.'}]),
  fixture('repair','repair',7,[{label:'ONU',quantity:7,unit:'шт.',unit_price:800},{label:'ONT',quantity:1,unit:'шт.'},{label:'ОНУ',quantity:1,unit:'шт.'},
    {label:'Роутер',quantity:2,unit:'шт.',unit_price:2300},{label:'UTP',quantity:40,unit:'м',unit_price:10},{label:'Блок живлення ONU',quantity:1,unit:'шт.',unit_price:250}])];
const before=JSON.stringify(rows),statsBefore=JSON.stringify(core.stats(rows)),hashes=rows.map(r=>r.source_hash);
const rendered=core.render(rows);
for(const kind of ['daily','weekly','monthly']){
  const panel=rendered.blocks.find(b=>b.kind===kind),text=panel.text.replace(/[\u00a0\u202f]/g,' ');
  assert(text.includes('📦 ONU на підключеннях — 13 шт.'));
  assert(text.includes('📦 ONU на ремонтах — 7 шт.'));
  assert.equal((text.match(/^📦 ONU /gm)||[]).length,2);
  for(const forbidden of ['📦 ONU —','Разом ONU','Заміна ONU','\nONU —','\nONT —','\nОНУ —'])assert(!text.includes(forbidden),kind+': '+forbidden);
  for(const kept of ['Роутер — 2 шт. — 2 300 грн','UTP — 40 м — 10 грн/м','Блок живлення ONU — 1 шт. — 250 грн'])assert(text.includes(kept),kind+': '+kept);
}
for(const block of rendered.blocks.filter(b=>b.kind==='ticket'))assert(block.text.includes('ONU — 1 шт. — 800 грн'),'ticket ONU and price unchanged');
assert.equal(JSON.stringify(rows),before,'render never mutates data');
assert.equal(JSON.stringify(core.stats(rows)),statsBefore,'aggregator unchanged');
assert.deepEqual(rows.map(r=>crypto.createHash('sha256').update(core.content(r)).digest('hex')),hashes,'canonical hashes unchanged');
assert.equal(core.stats(rows).onu_connection,13);assert.equal(core.stats(rows).onu_repair,7);assert.equal(core.stats(rows).onu_total,20);assert.equal(core.stats(rows).onu_replacement,7);assert.equal(core.stats(rows).total,1600);
const onuOnly=core.render([rows[0]]).blocks.find(b=>b.kind==='daily').text;
assert(!onuOnly.includes('📦 Матеріали:'),'no empty materials heading after ONU filtering');
const zero=core.render([{...rows[0],onu_used:0,materials_json:'[]'}]).blocks.find(b=>b.kind==='daily').text;
assert(zero.includes('ONU на підключеннях — 0 шт.'));assert(zero.includes('ONU на ремонтах — 0 шт.'));
console.log('PASS ONU presentation: exactly two counters across day/week/month, other materials and cards preserved, data/stats/hashes untouched');
