/*
 * Чисті агрегації фінансових показників звіту за заявками.
 *
 * Це класичний script, а не ES-модуль: глобальні імена збережені для
 * зворотної сумісності з app.js. Тут немає DOM, storage, мережі або
 * змінюваного стану застосунку.
 */

function calculateTicketReportTotals(tickets){
  const list = tickets||[];
  const total = list.reduce((s,t)=>s+(Number(t.sum)||0),0);
  const cashTotal = list.reduce((s,t)=> s + (t.payment==='Готівка' ? (Number(t.sum)||0) : t.payment==='Змішана' ? (Number(t.cashAmount)||0) : 0), 0);
  const cardTotal = list.reduce((s,t)=> s + (t.payment==='Безготівка' ? (Number(t.sum)||0) : t.payment==='Змішана' ? (Number(t.cardAmount)||0) : 0), 0);
  return {count:list.length, total, cashTotal, cardTotal};
}
