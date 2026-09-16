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

function appendTicketReportComment(reportText,comment){
  const text=String(reportText||'');
  const cleanComment=String(comment||'').trim();
  return cleanComment ? `${text}\n\nКоментар:\n${cleanComment}` : text;
}

/* ---- Навігація періодами звіту (v91.32) ----
   Чисті функції без DOM/storage/мережі: зсув якоря звіта на ±1 період
   обраного типу, вікно періоду й людська українська підпись періоду.
   Розрахунки грошей/годин/заявок ці функції не торкають. */
const MT_REPORT_MONTHS_GEN=['січня','лютого','березня','квітня','травня','черпня','липня','серпня','вересня','жовтня','листопада','грудня'];
const MT_REPORT_MONTHS_NOM=['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
function reportParseDate(value){
  const m=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(value||''));
  if(!m)return null;
  const d=new Date(Number(m[3]),Number(m[2])-1,Number(m[1]));
  return isNaN(d.getTime())?null:d;
}
function reportFormatDate(d){
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}
/* ←/→: зсув якоря рівно на один обраний період. «all» навігації не має. */
function shiftReportAnchor(range,dateStr,dir){
  const ref=reportParseDate(dateStr);
  if(!ref)return dateStr;
  const step=Number(dir)>=0?1:-1;
  if(range==='week')ref.setDate(ref.getDate()+7*step);
  else if(range==='month'){ref.setDate(1);ref.setMonth(ref.getMonth()+step);}
  else if(range==='day')ref.setDate(ref.getDate()+step);
  else return dateStr;
  return reportFormatDate(ref);
}
/* Вікно періоду [початок, кінець] (оба — північ Date локального дня). */
function reportPeriodWindow(range,dateStr){
  const ref=reportParseDate(dateStr);
  if(!ref)return null;
  if(range==='week'){const start=new Date(ref);start.setDate(start.getDate()-6);return{start,end:new Date(ref)};}
  if(range==='month')return{start:new Date(ref.getFullYear(),ref.getMonth(),1),end:new Date(ref.getFullYear(),ref.getMonth()+1,0)};
  return null;
}
/* Підпис періоду для навігації: «16 вересня 2026», «01–07 вересня 2026»,
   «29 серпня – 04 вересня 2026», «Вересень 2026». */
function reportPeriodLabel(range,dateStr){
  const ref=reportParseDate(dateStr);
  if(!ref)return '';
  const gen=d=>MT_REPORT_MONTHS_GEN[d.getMonth()];
  const full=d=>`${String(d.getDate()).padStart(2,'0')} ${gen(d)} ${d.getFullYear()}`;
  if(range==='day')return full(ref);
  if(range==='week'){
    const w=reportPeriodWindow('week',dateStr);
    if(!w)return '';
    const s=w.start,e=w.end;
    if(s.getFullYear()!==e.getFullYear())return `${full(s)} – ${full(e)}`;
    if(s.getMonth()!==e.getMonth())return `${String(s.getDate()).padStart(2,'0')} ${gen(s)} – ${String(e.getDate()).padStart(2,'0')} ${gen(e)} ${e.getFullYear()}`;
    return `${String(s.getDate()).padStart(2,'0')}–${String(e.getDate()).padStart(2,'0')} ${gen(e)} ${e.getFullYear()}`;
  }
  if(range==='month')return `${MT_REPORT_MONTHS_NOM[ref.getMonth()]} ${ref.getFullYear()}`;
  return 'за весь час';
}
