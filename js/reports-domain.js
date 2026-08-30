/* Canonical report/export/import maintenance workflows. */

function openExportModal(){
  openModal('Експорт для NotebookLM', `
    <div class="field">
      <label>Формат файлу</label>
      <select id="exportFormat"><option value="txt">TXT</option><option value="md">Markdown (.md)</option></select>
    </div>
    <div class="settings-row"><span class="sr-title">Включити статистику</span>
      <input type="checkbox" id="exportStats" checked style="width:20px;height:20px;"></div>
    <div class="settings-row"><span class="sr-title">Приховати телефони</span>
      <input type="checkbox" id="exportHidePhones" style="width:20px;height:20px;"></div>
    <button class="btn btn-accent btn-block" id="exportDownloadBtn" style="margin-top:14px;">Завантажити файл</button>
  `, {onOpen:(body)=>{
    document.getElementById('exportDownloadBtn').onclick = ()=>{
      const format = document.getElementById('exportFormat').value;
      const includeStats = document.getElementById('exportStats').checked;
      const hidePhones = document.getElementById('exportHidePhones').checked;
      downloadExport(format, includeStats, hidePhones);
      closeModal();
    };
  }});
}

function downloadExport(format, includeStats, hidePhones){
  const md = format==='md';
  let out = md ? `# Реєстр заявок — Майстер-Трекер\n\n` : `РЕЄСТР ЗАЯВОК — МАЙСТЕР-ТРЕКЕР\n\n`;
  const sorted = [...tickets].sort((a,b)=> parseDate(a.date)-parseDate(b.date) || (a.time||'').localeCompare(b.time||''));
  sorted.forEach(t=>{
    let content = t.content || '';
    if(hidePhones) content = content.replace(/(\+?\d[\d\s\-\(\)]{6,}\d)/g, '[прихований номер]');
    out += md ? `## ${t.date} ${t.time} — ${t.type}\n\n${content}\n\n` : `=== ${t.date} ${t.time} — ${t.type} ===\n${content}\n\n`;
  });
  if(includeStats){
    const totalSum = tickets.reduce((s,t)=>s+(Number(t.sum)||0),0);
    const statsText = `Усього заявок: ${tickets.length}\nЗагальна сума: ${fmtMoney(totalSum)}\nУсього змін: ${shifts.length}\n`;
    out += md ? `## Статистика\n\n${statsText}` : `=== СТАТИСТИКА ===\n${statsText}`;
  }
  const blob = new Blob([out], {type:'text/plain;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `master-tracker-export.${md?'md':'txt'}`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Файл експорту завантажено');
}

/* ---- Масовий імпорт ---- */
function openImportModal(){
  openModal('Масовий імпорт заявок', `
    <div class="field">
      <label>Вставте текст заявок (кожна заявка починається з рядка дати ДД.ММ.РРРР)</label>
      <textarea id="importTextarea" style="min-height:160px;"></textarea>
    </div>
    <button class="btn btn-accent btn-block" id="importRunBtn">Імпортувати</button>
  `, {onOpen:()=>{
    document.getElementById('importRunBtn').onclick = async ()=>{
      const text = document.getElementById('importTextarea').value;
      const count = await runBulkImport(text);
      closeModal();
      showToast(`Імпортовано заявок: ${count}`);
      renderTicketsScreen();
    };
  }});
}


async function dedupTickets(){
  if(!confirm('Знайти заявки з однаковою датою, часом і текстом та залишити тільки одну копію кожної?')) return;
  backupLocalData();
  const seen = new Map();
  const toRemove = new Set();
  tickets.forEach(t=>{
    const key = `${t.date}|${t.time}|${t.content}`;
    if(seen.has(key)){
      // залишаємо запис з меншим id (він, як правило, старіший/оригінальний),
      // а новіший дублікат прибираємо
      const existing = seen.get(key);
      const existingIdNum = Number(existing.id) || 0;
      const currentIdNum = Number(t.id) || 0;
      if(currentIdNum < existingIdNum){
        toRemove.add(existing.id);
        seen.set(key, t);
      } else {
        toRemove.add(t.id);
      }
    } else {
      seen.set(key, t);
    }
  });
  if(toRemove.size === 0){ showToast('Дублікатів не знайдено'); return; }
  tickets = tickets.filter(t=>!toRemove.has(t.id));
  saveTickets();
  renderTicketsScreen();
  showToast(`Видалено дублікатів: ${toRemove.size}. Синхронізація з хмарою...`);
  if(getScriptUrl()){
    const ok = await syncEngine.flush();
    renderTicketsScreen();
    showToast(ok ? 'Синхронізацію завершено' : 'Синхронізація не вдалась — перевірте інтернет');
  }
}

async function repairCorruptedTickets(){
  if(!confirm('Знайти та полагодити заявки з битими id/датою (залишились від старих тестів синхронізації)? Текст заявок не зміниться.')) return;
  backupLocalData();
  // Розпізнаємо зіпсовані записи: id виглядає як рядок з toString() дати
  // JS (напр. "Fri Jul 10 2026 00:00:00 GMT+0300 (...)"). Такий рядок
  // МОЖНА розпарсити назад через new Date(...) — і саме так ми
  // відновлюємо справжню дату заявки. Якщо в полі date лежить схожий
  // «зіпсований» рядок з роком 1899 — це залишок часу (HH:MM), який
  // теж можна витягнути.
  const looksLikeDateToString = (v) => typeof v === 'string' && /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{4}/.test(v);
  let repaired = 0, unfixable = 0;
  let counter = 0;
  tickets.forEach(t=>{
    const idBroken = looksLikeDateToString(t.id);
    const dateBroken = looksLikeDateToString(t.date) || !/^\d{2}\.\d{2}\.\d{4}$/.test(t.date||'');
    const timeBroken = !/^\d{2}:\d{2}$/.test(t.time||'');
    if(!idBroken && !dateBroken && !timeBroken) return; // запис в нормі

    let newDate = null, newTime = null;
    if(idBroken){
      const d = new Date(t.id);
      if(!isNaN(d.getTime())) newDate = formatDate(d);
    }
    if(looksLikeDateToString(t.date)){
      const d = new Date(t.date);
      if(!isNaN(d.getTime())) newTime = formatTime(d);
    }
    if(newDate || newTime || idBroken){
      counter++;
      t.id = Date.now() + counter; // новий унікальний числовий id
      if(newDate) t.date = newDate;
      else if(dateBroken) t.date = formatDate(new Date()); // не змогли відновити — ставимо сьогодні
      if(newTime) t.time = newTime;
      else if(timeBroken) t.time = formatTime(new Date());
      repaired++;
    } else {
      unfixable++;
    }
  });
  saveTickets();
  renderTicketsScreen();
  showToast(`Полагоджено: ${repaired}${unfixable ? `, не вдалось: ${unfixable}` : ''}. Синхронізація з хмарою...`);
  if(getScriptUrl()){
    const ok = await syncEngine.flush();
    renderTicketsScreen();
    showToast(ok ? 'Синхронізацію завершено' : 'Синхронізація не вдалась — перевірте інтернет');
  }
}

async function runBulkImport(text){
  if(!text.trim()) return 0;
  const dateRe = /^(\d{2}\.\d{2}\.\d{4})/;
  const lines = text.split('\n');
  const blocks = [];
  let current = null;
  lines.forEach(line=>{
    if(dateRe.test(line.trim())){
      if(current) blocks.push(current);
      current = {date: line.trim().match(dateRe)[1], lines:[line.trim()]};
    } else if(current){
      current.lines.push(line);
    }
  });
  if(current) blocks.push(current);
  let imported = 0;
  blocks.forEach(b=>{
    const content = b.lines.join('\n').trim();
    if(!content) return;
    const sumMatch = content.match(/ВСЬОГО:\s*([\d\s]+)/i) || content.match(/Сума:\s*([\d\s]+)/i);
    const sum = sumMatch ? Number(sumMatch[1].replace(/\s/g,'')) : 0;
    const timeMatch = content.match(/(\d{2}:\d{2})/);
    const t = blankTicketObject();
    t.id = Date.now() + imported;
    t.date = b.date;
    t.time = timeMatch ? timeMatch[1] : '';
    t.content = content;
    t.sum = sum;
    t.type = 'Імпорт';
    tickets.push(t);
    imported++;
  });
  saveTickets();
  // NEW: раніше кожна імпортована заявка відправлялась окремим addTicket без
  // очікування відповіді й БЕЗ оновлення t.synced — вони назавжди лишались
  // "не синхронізовано" локально, хоча текст (наприклад) уже міг піти в
  // таблицю. Тепер після імпорту робимо один спільний синк і чесно
  // проставляємо реальний статус усім щойно доданим заявкам.
  if(imported && getScriptUrl()){
    const ok = await syncEngine.flush();
  }
  return imported;
}

/* ---- Звіти ---- */
function openReportModal(){
  openModal('Звіти', `
    <div class="row wrap" style="margin-bottom:12px;">
      <button class="btn btn-sm" data-rep="day">За день</button>
      <button class="btn btn-sm" data-rep="week">За тиждень</button>
      <button class="btn btn-sm" data-rep="month">За місяць</button>
      <button class="btn btn-sm" data-rep="all">Всі</button>
    </div>
    <label class="row" style="align-items:center; gap:8px; margin-bottom:10px; font-size:13px; color:var(--text-dim);">
      <input type="checkbox" id="reportFullToggle"> Повний текст кожної заявки (а не короткий рядок)
    </label>
    <div id="reportOutput"></div>
    <div class="field" style="margin-top:12px;">
      <label for="reportCommentInput">Комментарий к отчёту</label>
      <textarea id="reportCommentInput" rows="4" placeholder="Необов’язковий коментар"></textarea>
    </div>
  `, {onOpen:(body)=>{
    let currentRange = 'day';
    body.querySelectorAll('[data-rep]').forEach(btn=>{
      btn.onclick = ()=>{ currentRange = btn.dataset.rep; renderReport(currentRange); };
    });
    document.getElementById('reportFullToggle').addEventListener('change', ()=> renderReport(currentRange));
    document.getElementById('reportCommentInput').addEventListener('input', ()=> renderReport(currentRange));
    renderReport('day');
  }});
}

function renderReport(range){
  const ref = parseDate(currentTicketDate);
  let list;
  let title;
  if(range==='day'){
    list = ticketsForDate(currentTicketDate); title = `за ${currentTicketDate}`;
  } else if(range==='week'){
    const start = new Date(ref); start.setDate(start.getDate() - 6);
    list = tickets.filter(t=>{ const d=parseDate(t.date); return d>=start && d<=ref; }); title = 'за останні 7 днів';
  } else if(range==='month'){
    list = tickets.filter(t=>isSameMonth(t.date, ref)); title = 'за поточний місяць';
  } else {
    list = [...tickets]; title = 'за весь час';
  }
  list = list.sort((a,b)=> parseDate(a.date)-parseDate(b.date) || (a.time||'').localeCompare(b.time||''));
  const {count, total, cashTotal, cardTotal} = calculateTicketReportTotals(list);
  // NEW: суми окремо готівкою й безготівкою — щоб не рахувати вручну, скільки
  // саме готівки на руках, а скільки має прийти на карту/рахунок.
  // "Безкоштовно" в жодну з двох сум не потрапляє (там і так 0 грн).
  // NEW: "Змішана" додає СВОЮ частину суми в обидва підсумки окремо
  // (t.cashAmount у готівку, t.cardAmount у безготівку) — інакше вся сума
  // такої заявки випадала б із обох підсумків і "загальна" сума не
  // збігалася б із сумою готівки та безготівки.
  const full = document.getElementById('reportFullToggle')?.checked;
  let text = buildTicketReportText({list, title, full, totals:{count, total, cashTotal, cardTotal}, formatMoney:fmtMoney});
  text = appendTicketReportComment(text,document.getElementById('reportCommentInput')?.value);
  // NEW: матеріали за період одразу зверху звіту — щоб бачити, скільки саме
  // обладнання/кабелю пішло за день/тиждень/місяць, не гортаючи кожну заявку.
  const out = document.getElementById('reportOutput');
  out.innerHTML = `<div class="report-text">${escapeHtml(text)}</div>
    <div class="row wrap" style="margin-top:10px;">
      <button class="btn btn-accent" id="copyReportBtn" style="flex:1 1 45%;">📄 Копіювати</button>
      <button class="btn" id="shareReportBtn" style="flex:1 1 45%;">📤 Надіслати</button>
    </div>`;
  document.getElementById('copyReportBtn').onclick = async ()=>{
    try{ await navigator.clipboard.writeText(text); showToast('Звіт скопійовано'); }
    catch(e){ showToast('Не вдалося скопіювати'); }
  };
  document.getElementById('shareReportBtn').onclick = async ()=>{
    try{
      if(navigator.share){ await navigator.share({title:'Звіт', text}); }
      else { await navigator.clipboard.writeText(text); showToast('Поділитися недоступне — текст скопійовано'); }
    }catch(e){ if(e.name!=='AbortError') showToast('Не вдалося надіслати'); }
  };
}
