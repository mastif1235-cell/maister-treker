/* ---- Чистое построение календаря и текста отчёта по заявкам ---- */
function buildCalendarGridHtml({year, month, tickets, selectedDate, todayStr, formatDateValue}){
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const counts = {};
  tickets.forEach(t=>{ counts[t.date] = (counts[t.date]||0)+1; });
  let html = DOW_NAMES.map(d=>`<div class="cal-dow">${d}</div>`).join('');
  for(let i=0;i<firstDow;i++) html += `<div class="cal-day empty"></div>`;
  for(let day=1; day<=daysInMonth; day++){
    const dateStr = formatDateValue(new Date(year, month, day));
    const isToday = dateStr===todayStr;
    const isSelected = dateStr===selectedDate;
    const hasTickets = counts[dateStr] > 0;
    html += `<div class="cal-day ${isToday?'today':''} ${isSelected?'selected':''}" data-date="${dateStr}">${day}${hasTickets?'<span class="dot"></span>':''}</div>`;
  }
  return html;
}

function buildMonthlyEquipmentLines(list){
  const eqCounts = {}, cableMeters = {}, workCounts = {};
  list.forEach(t=>{
    (t.equipment||[]).forEach(e=>{ if(e.checked!==false) eqCounts[e.label] = (eqCounts[e.label]||0) + 1; });
    (t.cables||[]).forEach(c=>{ const m = Number(c.meters)||0; if(m>0) cableMeters[c.label] = (cableMeters[c.label]||0) + m; });
    (t.presetWorks||[]).forEach(w=>{ if(w.checked!==false) workCounts[w.label] = (workCounts[w.label]||0) + (Number(w.qty)||1); });
  });
  const lines = [];
  Object.entries(eqCounts).sort((a,b)=>b[1]-a[1]).forEach(([label,c])=> lines.push(`${label} — ${c} шт.`));
  Object.entries(cableMeters).sort((a,b)=>b[1]-a[1]).forEach(([label,m])=> lines.push(`${label} — ${m} м`));
  Object.entries(workCounts).sort((a,b)=>b[1]-a[1]).forEach(([label,q])=> lines.push(`${label} — ${q} шт.`));
  return lines;
}

function buildTicketReportText({list, title, full, totals, formatMoney}){
  const {count, total, cashTotal, cardTotal} = totals;
  let text = `ЗВІТ ${title.toUpperCase()}\nЗаявок: ${count}\n💵 Готівка: ${formatMoney(cashTotal)}\n💳 Безготівка: ${formatMoney(cardTotal)}\n💰 Загалом: ${formatMoney(total)}\n`;
  const materialLines = buildMonthlyEquipmentLines(list);
  if(materialLines.length){
    text += `\n📦 Використано:\n`;
    materialLines.forEach(l=> text += `   • ${l}\n`);
  }
  text += `\n`;
  if(full){
    list.forEach((t,i)=> text += `━━━━━━━━━━━━━━━ ${i+1} ━━━━━━━━━━━━━━━\n${t.date} ${t.time}\n${t.content || (t.type+' — '+formatMoney(t.sum))}\n\n`);
  } else {
    list.forEach(t=> text += `${t.date} ${t.time} — ${t.type} — ${formatMoney(t.sum)}\n`);
  }
  return text;
}
