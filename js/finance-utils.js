/*
 * Чисті функції фінансового представлення заявки.
 *
 * Це класичний script, а не ES-модуль: глобальні імена збережені для
 * зворотної сумісності з app.js. Тут немає DOM, storage, мережі або
 * змінюваного стану застосунку.
 */

function calculateTicketTotal(state){
  const emptyResult = {total:0, callFee:0, tariff:0, equipmentSum:0, cablesSum:0, additionalWorkSum:0, presetWorkSum:0};
  if(state.cloudImported) return {...emptyResult, total:Number(state.rawSum)||0};
  if(state.payment === 'Безкоштовно') return emptyResult;
  const callFee = Number(state.callFee)||0;
  const tariff = Number(state.tariff)||0;
  const equipmentSum = (state.equipment||[]).reduce((s,e)=> s + (e.checked ? (Number(e.price)||0) : 0), 0);
  const cablesSum = (state.cables||[]).reduce((s,c)=> s + (Number(c.meters)||0)*(Number(c.pricePerMeter)||0), 0);
  const additionalWorkSum = (state.additionalWork||[]).reduce((s,w)=> s + (Number(w.sum)||0), 0);
  const presetWorkSum = (state.presetWorks||[]).reduce((s,w)=> s + (w.checked ? (Number(w.price)||0)*(Number(w.qty)||1) : 0), 0);
  return {total:callFee + tariff + equipmentSum + cablesSum + additionalWorkSum + presetWorkSum, callFee, tariff, equipmentSum, cablesSum, additionalWorkSum, presetWorkSum};
}

function callFeeLabelFor(type){
  return type === 'Ремонт' ? 'Виклик' : (type || 'Виклик');
}

function buildMixedPaymentItemsFromTicket(t){
  const items = [];
  if(Number(t.callFee)>0) items.push({key:'callFee', label: callFeeLabelFor(t.type), amount: Number(t.callFee)});
  if(Number(t.tariff)>0) items.push({key:'tariff', label:'Тариф', amount: Number(t.tariff)});
  (t.equipment||[]).filter(e=>e.checked!==false).forEach(e=> items.push({key:'eq_'+e.id, label:e.label, amount: Number(e.price)||0}));
  (t.cables||[]).forEach(c=>{ const m=Number(c.meters)||0; if(m>0) items.push({key:'cab_'+c.id, label:`${c.label} (${m}м)`, amount: m*(Number(c.pricePerMeter)||0)}); });
  (t.presetWorks||[]).filter(w=>w.checked!==false).forEach(w=> items.push({key:'pw_'+w.id, label:w.label, amount:(Number(w.price)||0)*(Number(w.qty)||1)}));
  (t.additionalWork||[]).forEach((w,i)=>{ if(w.desc || w.sum) items.push({key:'aw_'+i, label:w.desc||'Робота', amount:Number(w.sum)||0}); });
  return items;
}

function buildMixedPaymentBreakdownLines(t){
  if(t.payment !== 'Змішана' || !t.itemPayments) return [`   (готівка: ${fmtMoney(t.cashAmount)}, безготівка: ${fmtMoney(t.cardAmount)})`];
  const items = buildMixedPaymentItemsFromTicket(t);
  const cashItems = items.filter(it=> t.itemPayments[it.key]==='cash').map(it=>it.label);
  const cardItems = items.filter(it=> t.itemPayments[it.key]==='card').map(it=>it.label);
  return [
    `   💵 Готівка ${fmtMoney(t.cashAmount)}: ${cashItems.length ? cashItems.join(', ') : '—'}`,
    `   💳 Безготівка ${fmtMoney(t.cardAmount)}: ${cardItems.length ? cardItems.join(', ') : '—'}`
  ];
}

function buildWorkSummaryLines(t){
  const lines = [];
  const isFree = t.payment === 'Безкоштовно';
  if(t.macAddress) lines.push(`🔧 MAC ONU: ${t.macAddress}`);
  if(Number(t.callFee)>0) lines.push(`💎 ${callFeeLabelFor(t.type)}: ${isFree ? '0 грн' : fmtMoney(t.callFee)}`);
  if(Number(t.tariff)>0) lines.push(`💎 Тариф: ${isFree ? '0 грн' : fmtMoney(t.tariff)}`);
  (t.equipment||[]).filter(e=>e.checked!==false).forEach(e=> lines.push(`🛠️ ${e.label}: 1 шт. х ${isFree ? '0' : Math.round(e.price)} грн`));
  (t.cables||[]).forEach(c=>{ const m=Number(c.meters)||0; if(m>0) lines.push(`🔌 ${c.label}: ${m}м х ${isFree ? '0' : c.pricePerMeter}грн = ${isFree ? '0' : Math.round(m*(Number(c.pricePerMeter)||0))}грн`); });
  (t.presetWorks||[]).filter(w=>w.checked!==false).forEach(w=> lines.push(`🔧 ${w.label}: ${w.qty||1} шт. х ${isFree ? '0' : Math.round(w.price)} грн = ${isFree ? '0' : Math.round((w.price||0)*(w.qty||1))}грн`));
  (t.additionalWork||[]).forEach(w=>{ if(w.desc || w.sum) lines.push(`✏️ ${w.desc||'Робота'}: ${isFree ? '0 грн' : fmtMoney(w.sum)}`); });
  if(t.payment) lines.push(`💳 Оплата: ${t.payment}`);
  if(t.payment === 'Змішана') buildMixedPaymentBreakdownLines(t).forEach(l=> lines.push(l));
  if(t.note) lines.push(`📝 ${t.note}`);
  if(t.otherNote) lines.push(t.otherNote);
  return lines;
}

function buildTicketContent(s, total){
  if(s.type === 'Інше'){
    const lines = [`📋 НОТАТКА`];
    if(s.date) lines.push(`📅 ${s.date}${s.time ? ' '+s.time : ''}`);
    if(s.otherNote) lines.push(s.otherNote);
    return lines.join('\n');
  }
  const lines = [];
  lines.push(`📋 ЗАЯВКА: ${(s.type||'').toUpperCase()}`);
  if(s.date) lines.push(`📅 ${s.date}${s.time ? ' '+s.time : ''}`);
  if((s.type === 'Підключення' || s.type === 'Ремонт') && s.contractNumber) lines.push(`📄 № дог.: ${s.contractNumber}`);
  if(s.city) lines.push(`🏙️ Місто: ${s.city}`);
  if(s.address) lines.push(`📍 Адреса: ${s.address}`);
  if(s.clientName) lines.push(`👤 Клієнт: ${s.clientName}`);
  if(s.phone) lines.push(`📞 Тел: ${s.phone}`);
  if(s.macAddress) lines.push(`🔧 MAC ONU: ${s.macAddress}`);
  lines.push('------------------');
  const isFree = s.payment === 'Безкоштовно';
  if(s.callFee>0) lines.push(`💎 ${callFeeLabelFor(s.type)}: ${isFree ? '0 грн' : fmtMoney(s.callFee)}`);
  if(s.tariff>0) lines.push(`💎 Тариф: ${isFree ? '0 грн' : fmtMoney(s.tariff)}`);
  s.equipment.filter(e=>e.checked).forEach(e=>{
    lines.push(`🛠️ ${e.label}: 1 шт. х ${isFree ? '0' : Math.round(e.price)} грн`);
  });
  (s.cables||[]).forEach(c=>{
    const meters = Number(c.meters)||0;
    if(meters>0) lines.push(`🔌 ${c.label}: ${meters}м х ${isFree ? '0' : c.pricePerMeter}грн = ${isFree ? '0' : Math.round(meters*(Number(c.pricePerMeter)||0))}грн`);
  });
  (s.presetWorks||[]).filter(w=>w.checked).forEach(w=>{
    lines.push(`🔧 ${w.label}: ${w.qty||1} шт. х ${isFree ? '0' : Math.round(w.price)} грн = ${isFree ? '0' : Math.round((w.price||0)*(w.qty||1))}грн`);
  });
  s.additionalWork.forEach(w=>{ if(w.desc || w.sum) lines.push(`✏️ ${w.desc||'Робота'}: ${isFree ? '0 грн' : fmtMoney(w.sum)}`); });
  lines.push('------------------');
  if(s.payment) lines.push(`💳 Оплата: ${s.payment}`);
  if(s.payment === 'Змішана') buildMixedPaymentBreakdownLines(s).forEach(l=> lines.push(l));
  lines.push(`💵 ІТОГО: ${fmtMoney(total)}`);
  if(s.note) lines.push(`📝 ${s.note}`);
  return lines.join('\n');
}
