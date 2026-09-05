/*
 * Чисті функції фінансового представлення заявки.
 *
 * Це класичний script, а не ES-модуль: глобальні імена збережені для
 * зворотної сумісності з app.js. Тут немає DOM, storage, мережі або
 * змінюваного стану застосунку.
 */

function safeNonNegativeNumber(value,fallback=0){const number=Number(value);return Number.isFinite(number)&&number>=0?number:fallback;}
function safeWorkQuantity(value){const number=Number(value);if(!Number.isFinite(number))return 1;if(number<0)return 0;return number||1;}

function effectiveTicketCallFee(state,equipmentSum){
  const selectedEquipmentSum = equipmentSum === undefined
    ? (state.equipment||[]).reduce((sum,item)=>sum+(item.checked!==false?safeNonNegativeNumber(item.price):0),0)
    : safeNonNegativeNumber(equipmentSum);
  const threshold=safeNonNegativeNumber(state.freeRepairCallThreshold);
  return state.type==='Ремонт'&&threshold>0&&selectedEquipmentSum>=threshold
    ? 0
    : safeNonNegativeNumber(state.callFee);
}

function calculateTicketTotal(state){
  const emptyResult = {total:0, callFee:0, tariff:0, equipmentSum:0, cablesSum:0, additionalWorkSum:0, presetWorkSum:0};
  if(state.cloudImported) return {...emptyResult, total:safeNonNegativeNumber(state.rawSum)};
  if(state.payment === 'Безкоштовно') return emptyResult;
  const tariff = safeNonNegativeNumber(state.tariff);
  const equipmentSum = (state.equipment||[]).reduce((s,e)=> s + (e.checked!==false ? safeNonNegativeNumber(e.price) : 0), 0);
  const callFee=effectiveTicketCallFee(state,equipmentSum);
  const cablesSum = (state.cables||[]).reduce((s,c)=> s + safeNonNegativeNumber(c.meters)*safeNonNegativeNumber(c.pricePerMeter), 0);
  const additionalWorkSum = (state.additionalWork||[]).reduce((s,w)=> s + safeNonNegativeNumber(w.sum), 0);
  const presetWorkSum = (state.presetWorks||[]).reduce((s,w)=> s + (w.checked!==false ? safeNonNegativeNumber(w.price)*safeWorkQuantity(w.qty) : 0), 0);
  return {total:callFee + tariff + equipmentSum + cablesSum + additionalWorkSum + presetWorkSum, callFee, tariff, equipmentSum, cablesSum, additionalWorkSum, presetWorkSum};
}

function callFeeLabelFor(type){
  return type === 'Ремонт' ? 'Виклик' : (type || 'Виклик');
}

function buildMixedPaymentItemsFromTicket(t){
  const items = [];
  const callFee=effectiveTicketCallFee(t);
  if(callFee>0) items.push({key:'callFee', label: callFeeLabelFor(t.type), amount:callFee});
  if(Number(t.tariff)>0) items.push({key:'tariff', label:'Тариф', amount: Number(t.tariff)});
  (t.equipment||[]).filter(e=>e.checked!==false).forEach(e=> items.push({key:'eq_'+e.id, label:e.label, amount:safeNonNegativeNumber(e.price)}));
  (t.cables||[]).forEach(c=>{ const m=safeNonNegativeNumber(c.meters); if(m>0) items.push({key:'cab_'+c.id, label:`${c.label} (${m}м)`, amount:m*safeNonNegativeNumber(c.pricePerMeter)}); });
  (t.presetWorks||[]).filter(w=>w.checked!==false).forEach(w=> items.push({key:'pw_'+w.id, label:w.label, amount:safeNonNegativeNumber(w.price)*safeWorkQuantity(w.qty)}));
  (t.additionalWork||[]).forEach((w,i)=>{ if(w.desc || w.sum) items.push({key:'aw_'+i, label:w.desc||'Робота', amount:safeNonNegativeNumber(w.sum)}); });
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
  const callFee=effectiveTicketCallFee(t);
  if(t.macAddress) lines.push(`🔧 MAC ONU: ${t.macAddress}`);
  if(callFee>0) lines.push(`💎 ${callFeeLabelFor(t.type)}: ${isFree ? '0 грн' : fmtMoney(callFee)}`);
  if(Number(t.tariff)>0) lines.push(`💎 Тариф: ${isFree ? '0 грн' : fmtMoney(t.tariff)}`);
  (t.equipment||[]).filter(e=>e.checked!==false).forEach(e=> lines.push(`🛠️ ${e.label}: 1 шт. х ${isFree ? '0' : Math.round(e.price)} грн`));
  (t.cables||[]).forEach(c=>{ const m=safeNonNegativeNumber(c.meters),price=safeNonNegativeNumber(c.pricePerMeter); if(m>0) lines.push(`🔌 ${c.label}: ${m}м х ${isFree ? '0' : price}грн = ${isFree ? '0' : Math.round(m*price)}грн`); });
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
  const onuSignal=normalizeOnuSignal(s.signal);
  if(onuSignal) lines.push(`📶 Сигнал ONU: ${onuSignal} dBm`);
  lines.push('------------------');
  const isFree = s.payment === 'Безкоштовно';
  const callFee=effectiveTicketCallFee(s);
  if(callFee>0) lines.push(`💎 ${callFeeLabelFor(s.type)}: ${isFree ? '0 грн' : fmtMoney(callFee)}`);
  if(s.tariff>0) lines.push(`💎 Тариф: ${isFree ? '0 грн' : fmtMoney(s.tariff)}`);
  (s.equipment||[]).filter(e=>e.checked!==false).forEach(e=>{
    lines.push(`🛠️ ${e.label}: 1 шт. х ${isFree ? '0' : Math.round(e.price)} грн`);
  });
  (s.cables||[]).forEach(c=>{
    const meters=safeNonNegativeNumber(c.meters),price=safeNonNegativeNumber(c.pricePerMeter);
    if(meters>0) lines.push(`🔌 ${c.label}: ${meters}м х ${isFree ? '0' : price}грн = ${isFree ? '0' : Math.round(meters*price)}грн`);
  });
  (s.presetWorks||[]).filter(w=>w.checked!==false).forEach(w=>{
    lines.push(`🔧 ${w.label}: ${w.qty||1} шт. х ${isFree ? '0' : Math.round(w.price)} грн = ${isFree ? '0' : Math.round((w.price||0)*(w.qty||1))}грн`);
  });
  (s.additionalWork||[]).forEach(w=>{ if(w.desc || w.sum) lines.push(`✏️ ${w.desc||'Робота'}: ${isFree ? '0 грн' : fmtMoney(w.sum)}`); });
  lines.push('------------------');
  if(s.payment) lines.push(`💳 Оплата: ${s.payment}`);
  if(s.payment === 'Змішана') buildMixedPaymentBreakdownLines(s).forEach(l=> lines.push(l));
  lines.push(`💵 ІТОГО: ${fmtMoney(total)}`);
  if(s.note) lines.push(`📝 ${s.note}`);
  return lines.join('\n');
}
