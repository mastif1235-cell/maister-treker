/* ---- Пасивний рендеринг екрана змін ---- */
function renderCoworkerGrid(){
  const wrap = document.getElementById('coworkerGrid');
  wrap.innerHTML = settings.coworkers.map(cw=>{
    const active = coworkerSelection.has(cw);
    return `<button type="button" class="chip ${active?'active':''}" data-cw="${escapeHtml(cw)}">${escapeHtml(cw)}</button>`;
  }).join('');
}
function renderStatsMonthLabel(){ document.getElementById('statsMonthLabel').textContent = `${MONTH_NAMES[statsViewDate.getMonth()]} ${statsViewDate.getFullYear()}`; }
function renderYearChart(){
  const year = statsViewDate.getFullYear(); const hoursByMonth = calculateYearlyShiftHours(shifts, year); const max = Math.max(1, ...hoursByMonth);
  document.getElementById('yearChart').innerHTML = hoursByMonth.map((h,i)=>{ const pct=Math.max(2,Math.round((h/max)*100)), active=i===statsViewDate.getMonth(); return `<button type="button" class="ychart-bar-wrap" data-month="${i}" title="${MONTH_NAMES[i]}: ${h.toFixed(1)} год"><span class="ychart-val">${h>0?h.toFixed(0):''}</span><span class="ychart-bar ${active?'active':''}" style="height:${pct}%"></span><span class="ychart-lbl">${MONTH_NAMES[i].slice(0,3)}</span></button>`; }).join('');
}
function renderShiftStats(){ const {count,totalHours,averageHours,salary}=calculateShiftMonthStats(shifts,statsViewDate,settings.hourlyRate); document.getElementById('shiftStatGrid').innerHTML=`<div class="stat-box"><div class="s-val tabular">${count}</div><div class="s-lbl">Змін</div></div><div class="stat-box"><div class="s-val tabular">${totalHours.toFixed(1)}</div><div class="s-lbl">Годин</div></div><div class="stat-box"><div class="s-val tabular">${averageHours.toFixed(1)}</div><div class="s-lbl">Середнє/зміну</div></div><div class="stat-box"><div class="s-val tabular">${fmtMoney(salary)}</div><div class="s-lbl">Зарплата</div></div>`; }
function renderShiftHistory(){ const monthShifts=sortShiftsByDateDesc(getShiftsForMonth(shifts,statsViewDate)),card=document.getElementById('shiftHistoryCard'); if(!monthShifts.length){card.innerHTML=`<div class="empty-state"><div class="es-icon">🕒</div>Змін у цьому місяці ще немає</div>`;return;} card.innerHTML=monthShifts.map(s=>{const earned=calculateShiftEarnings(s.hours,settings.hourlyRate);return `<div class="shift-row" data-id="${s.id}"><div><div class="sr-main">${escapeHtml(s.date)} · ${s.hours} год</div><div class="sr-sub">${escapeHtml(s.coworker)}${earned>0?` · ${fmtMoney(earned)}`:''}</div></div><button type="button" class="delete-shift-btn" data-id="${s.id}">✕</button></div>`;}).join(''); }

function formatShiftMonthText(monthShifts, refDate, monthNames, updatedText){
  const totalHours = monthShifts.reduce((s,x)=>s+(Number(x.hours)||0),0);
  const lines = [];
  lines.push(`🕒 ЗМІНИ — ${monthNames[refDate.getMonth()].toUpperCase()} ${refDate.getFullYear()}`);
  lines.push('------------------');
  if(monthShifts.length===0){
    lines.push('Змін немає');
  } else {
    monthShifts.forEach(s=> lines.push(`${s.date} — ${s.hours} год — ${s.coworker}`));
  }
  lines.push('------------------');
  lines.push(`📅 Змін: ${monthShifts.length}`);
  lines.push(`⏱️ Годин: ${totalHours.toFixed(1)}`);
  if(updatedText){
    lines.push('');
    lines.push(updatedText);
  }
  return lines.join('\n');
}
