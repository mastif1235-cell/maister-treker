/* Canonical shift workflows, reports and bindings. */

function renderShiftCalendar(){
  document.getElementById('shiftCalMonthLabel').textContent = `${MONTH_NAMES[shiftCalendarViewDate.getMonth()]} ${shiftCalendarViewDate.getFullYear()}`;
  const grid = document.getElementById('shiftCalGrid');
  const year = shiftCalendarViewDate.getFullYear(), month = shiftCalendarViewDate.getMonth();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // понеділок=0
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const todayStr = formatDate(new Date());

  const hoursByDate = {};
  shifts.forEach(s=>{ hoursByDate[s.date] = (hoursByDate[s.date]||0) + (Number(s.hours)||0); });

  let html = DOW_NAMES.map(d=>`<div class="cal-dow">${d}</div>`).join('');
  for(let i=0;i<firstDow;i++) html += `<div class="cal-day empty"></div>`;
  for(let day=1; day<=daysInMonth; day++){
    const dateStr = formatDate(new Date(year, month, day));
    const isToday = dateStr===todayStr;
    const isSelected = dateStr===currentShiftDate;
    const hasShift = hoursByDate[dateStr] > 0;
    html += `<div class="cal-day ${isToday?'today':''} ${isSelected?'selected':''}" data-date="${dateStr}">${day}${hasShift?'<span class="dot"></span>':''}</div>`;
  }
  grid.innerHTML = html;
}

function renderShiftsScreen(){
  document.getElementById('currentShiftDateDisplay').textContent = currentShiftDate;
  renderCoworkerGrid();
  renderStatsMonthLabel();
  renderYearChart();
  renderShiftStats();
  renderShiftHistory();
}



/* Графік годин по місяцях обраного року — щоб одразу бачити, в якому місяці скільки відпрацьовано */



function addShift(){
  const enteredHours = Number(document.getElementById('shiftHours').value);
  const hours = roundWorkedHours(enteredHours);
  if(!hours || hours<=0){ showToast('Вкажіть кількість годин'); return; }
  const coworker = coworkerSelection.size ? [...coworkerSelection].join(', ') : 'Сам';
  const shift = {id: MTSyncEngineRuntime.uuid(), date: currentShiftDate, hours, coworker};
  shifts.push(shift);
  saveShifts();
  syncShiftsMonthlyTelegramMessage(); // NEW: оновлюємо/надсилаємо місячне повідомлення в Telegram (у фоні, не блокує UI)
  document.getElementById('shiftHours').value = '';
  coworkerSelection = new Set();
  statsViewDate = parseDate(currentShiftDate);
  renderShiftsScreen();
  showToast(hours !== enteredHours ? `Зміну додано · округлено до ${hours} год` : 'Зміну додано');
}

function deleteShift(id){
  if(!confirm('Видалити цю зміну?')) return;
  shifts = shifts.filter(s=>String(s.id)!==String(id)); // NEW: id зміни — рядок (UUID), Number() ламав порівняння
  saveShifts();
  syncShiftsMonthlyTelegramMessage(); // NEW: те саме — місячне повідомлення в Telegram лишається актуальним і після видалення
  renderShiftsScreen();
  showToast('Зміну видалено');
}

/* Текстовий звіт за обраний місяць — для копіювання/відправки у Viber, Telegram тощо */
function buildShiftMonthReport(){
  const monthShifts = shifts.filter(s=>isSameMonth(s.date, statsViewDate))
    .sort((a,b)=> parseDate(a.date)-parseDate(b.date));
  return formatShiftMonthText(monthShifts, statsViewDate, MONTH_NAMES);
}

// NEW: одне повідомлення в Telegram на весь поточний місяць — щодня (при
// кожній зміні, доданій чи видаленій) редагується, а не дублюється новим.
// 1-го числа нового місяця автоматично починається НОВЕ повідомлення. По
// суті це живий бекап "Змін" прямо в переписці з ботом — на випадок втрати
// телефону видно все за місяць одним поглядом, без імпорту файлів.
function buildCurrentMonthShiftsTelegramText(){
  const now = new Date();
  const monthShifts = shifts.filter(s=>isSameMonth(s.date, now))
    .sort((a,b)=> parseDate(a.date)-parseDate(b.date));
  return formatShiftMonthText(monthShifts, now, MONTH_NAMES, `оновлено: ${formatDate(new Date())} ${formatTime(new Date())}`); // NEW: видно, що повідомлення живе й актуальне, а не застигле
}
let shiftsTelegramSyncBusy = false;
let shiftsTelegramSyncQueued = false;
async function syncShiftsMonthlyTelegramMessage(){
  const token = (settings.tgBotToken||'').trim();
  const chatId = (settings.tgMyChatId||'').trim();
  if(!token || !chatId) return; // не налаштовано — тихо виходимо, це не обов'язкова функція
  // NEW: якщо додати дві зміни поспіль дуже швидко (наприклад, два різних
  // напарники за один день), обидва виклики цієї функції могли стартувати
  // майже одночасно — обидва бачили, що tgShiftsMsgId ще не встановлено для
  // цього місяця, і ОБИДВА надсилали НОВЕ повідомлення в Telegram замість
  // одного. Якщо синк уже йде, не запускаємо другий паралельно: позначаємо
  // один повтор після завершення поточного. Так останній текст включить усі
  // швидкі зміни, незалежно від фактичної затримки Telegram.
  if(shiftsTelegramSyncBusy){
    shiftsTelegramSyncQueued = true;
    return;
  }
  shiftsTelegramSyncBusy = true;
  try{
    const monthKey = localMonthKey(new Date());
    const text = buildCurrentMonthShiftsTelegramText();
    if(settings.tgShiftsMsgId && settings.tgShiftsMsgMonth === monthKey){
      // той самий місяць — редагуємо вже надіслане повідомлення
      const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({chat_id: chatId, message_id: settings.tgShiftsMsgId, text: text.slice(0,4000)})
      });
      const data = await res.json();
      if(data.ok) return;
      // NEW: якщо редагування не вдалось (наприклад, повідомлення видалили
      // вручну з чату) — не мовчимо, а надсилаємо нове замість втраченого
    }
    // новий місяць або ще не надсилали цього місяця — нове повідомлення
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({chat_id: chatId, text: text.slice(0,4000)})
    });
    const data = await res.json();
    if(data.ok){
      settings.tgShiftsMsgId = data.result.message_id;
      settings.tgShiftsMsgMonth = monthKey;
      saveSettings();
    }
  }catch(e){ /* немає інтернету чи Telegram недоступний — не критично, спробуємо при наступній зміні */ }
  finally{
    shiftsTelegramSyncBusy = false;
    if(shiftsTelegramSyncQueued){
      shiftsTelegramSyncQueued = false;
      syncShiftsMonthlyTelegramMessage();
    }
  }
}

async function shareMonthShifts(){
  const text = buildShiftMonthReport();
  try{
    if(navigator.share){ await navigator.share({title:'Зміни за місяць', text}); return; }
    throw new Error('share-unsupported');
  }catch(e){
    if(e.name==='AbortError') return;
    try{ await navigator.clipboard.writeText(text); showToast('Звіт за місяць скопійовано в буфер обміну'); }
    catch(e2){ showToast('Не вдалося скопіювати звіт'); }
  }
}
// NEW: надіслати звіт по змінах у Telegram собі особисто — за будь-який місяць,
// який зараз обрано на екрані "Зміни" (гортаєте стрілками ‹ › і тиснете, коли треба)
async function sendShiftsReportToTelegram(){
  const chatId = (settings.tgMyChatId||'').trim();
  if(!settings.tgBotToken || !chatId){ showToast('Спочатку заповніть токен і ваш особистий Chat ID в Налаштуваннях'); return; }
  const text = buildShiftMonthReport();
  showToast('Надсилаю звіт по змінах…');
  const res = await sendToTelegramChat(chatId, text, null, null);
  showToast(res.ok ? '✅ Звіт надіслано!' : `Не вдалося надіслати: ${res.reason}`);
}

function bindShiftsScreen(){
  document.getElementById('prevShiftDayBtn').addEventListener('click', ()=>{ currentShiftDate = shiftDate(currentShiftDate,-1); renderShiftsScreen(); });
  document.getElementById('nextShiftDayBtn').addEventListener('click', ()=>{ currentShiftDate = shiftDate(currentShiftDate,1); renderShiftsScreen(); });

  document.getElementById('shiftCalendarToggleBtn').addEventListener('click', ()=>{
    const panel = document.getElementById('shiftCalendarPanel');
    panel.classList.toggle('hidden');
    if(!panel.classList.contains('hidden')){ shiftCalendarViewDate = parseDate(currentShiftDate); renderShiftCalendar(); }
  });
  document.getElementById('shiftCalPrevMonth').addEventListener('click', ()=>{
    shiftCalendarViewDate.setMonth(shiftCalendarViewDate.getMonth()-1); renderShiftCalendar();
  });
  document.getElementById('shiftCalNextMonth').addEventListener('click', ()=>{
    shiftCalendarViewDate.setMonth(shiftCalendarViewDate.getMonth()+1); renderShiftCalendar();
  });
  document.getElementById('shiftCalGrid').addEventListener('click', e=>{
    const day = e.target.closest('[data-date]'); if(!day) return;
    currentShiftDate = day.dataset.date;
    document.getElementById('shiftCalendarPanel').classList.add('hidden');
    renderShiftsScreen();
  });

  // Навігація по місяцях у блоці статистики/графіку — незалежна від дня додавання зміни
  document.getElementById('statsPrevMonth').addEventListener('click', ()=>{
    statsViewDate.setMonth(statsViewDate.getMonth()-1);
    renderStatsMonthLabel(); renderYearChart(); renderShiftStats(); renderShiftHistory();
  });
  document.getElementById('statsNextMonth').addEventListener('click', ()=>{
    statsViewDate.setMonth(statsViewDate.getMonth()+1);
    renderStatsMonthLabel(); renderYearChart(); renderShiftStats(); renderShiftHistory();
  });

  // Клік по стовпцю графіку — переключає обраний місяць
  document.getElementById('yearChart').addEventListener('click', e=>{
    const bar = e.target.closest('[data-month]'); if(!bar) return;
    statsViewDate.setMonth(Number(bar.dataset.month));
    renderYearChart(); renderShiftStats(); renderShiftHistory();
  });

  document.getElementById('shareMonthBtn').addEventListener('click', shareMonthShifts);
  document.getElementById('tgShiftsReportBtn').addEventListener('click', sendShiftsReportToTelegram);

  document.querySelectorAll('.hq-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{ document.getElementById('shiftHours').value = btn.dataset.h; });
  });
  document.getElementById('coworkerGrid').addEventListener('click', e=>{
    const chip = e.target.closest('[data-cw]'); if(!chip) return;
    const cw = chip.dataset.cw;
    if(coworkerSelection.has(cw)) coworkerSelection.delete(cw); else coworkerSelection.add(cw);
    renderCoworkerGrid();
  });
  document.getElementById('addShiftBtn').addEventListener('click', addShift);
  document.getElementById('shiftHistoryCard').addEventListener('click', e=>{
    const btn = e.target.closest('.delete-shift-btn'); if(!btn) return;
    deleteShift(btn.dataset.id);
  });
}

