'use strict';

// Local persistence and backup UI orchestration. Loaded after app.js.
function saveNaryadQueue(){ localStorage.setItem('naryadQueue', JSON.stringify(naryadQueue)); }

/* ---- Безпечний запис змін ----
   localStorage.setItem кидає QuotaExceededError (квота ~5 МБ спільна з
   налаштуваннями й чернетками) або SecurityError. Раніше такий виняток ішов
   «в нікуди»: проміс відхилявся без обробника, зміна жила лише в пам'яті й
   зникала після перезапуску — без жодного повідомлення користувачу.
   Тепер невдалий запис перехоплюється, дані дублюються в аварійний ключ
   pendingShiftsFallback, а користувач бачить тост. */
function mtShiftsPersistFailure(error){
  globalThis.MTSafeError?.reportError?.(error,{scope:'shifts-persist'});
  try{
    localStorage.setItem(PENDING_SHIFTS_FALLBACK_KEY, JSON.stringify(shifts));
    showToast('⚠️ Зміни не записались у сховище — збережено аварійну копію. Перезавантажте застосунок.');
    return true;
  }catch(_fallbackError){
    globalThis.MTSafeError?.reportError?.(_fallbackError,{scope:'shifts-persist-fallback'});
    showToast('⚠️ Не вдалося зберегти зміни. Не закривайте застосунок — перезавантажте його.');
    return false;
  }
}

function mtClearShiftsFallback(){
  try{ localStorage.removeItem(PENDING_SHIFTS_FALLBACK_KEY); }catch(_error){}
}

function saveShifts(){
  if(typeof MTSingleWriterLock!=='undefined'&&!MTSingleWriterLock.warn()) return Promise.resolve(false);
  shiftsRevision++;
  const before=syncShiftsSnapshot; const after=JSON.parse(JSON.stringify(shifts));
  const persist=syncEngine ? syncEngine.recordDiff('shift',before,after) : Promise.resolve();
  let journalFailed=false;
  return persist.catch(error=>{
    // Журнал не записався: локальні дані все одно зберігаємо, але знімок
    // синхронізації НЕ рухаємо — інакше різниця загубилась би назавжди.
    journalFailed=true;
    globalThis.MTSafeError?.reportError?.(error,{scope:'shifts-journal'});
  }).then(()=>{
    if(!journalFailed) syncShiftsSnapshot=after;
    try{
      localStorage.setItem('shifts',JSON.stringify(shifts));
    }catch(error){
      return mtShiftsPersistFailure(error);
    }
    mtClearShiftsFallback();
    return true;
  });
}

function saveShiftsLocalOnly(){
  if(typeof MTSingleWriterLock!=='undefined'&&!MTSingleWriterLock.warn()) return Promise.resolve(false);
  try{
    localStorage.setItem('shifts',JSON.stringify(shifts));
  }catch(error){
    return Promise.resolve(mtShiftsPersistFailure(error));
  }
  mtClearShiftsFallback();
  return Promise.resolve(true);
}

// Єдина точка виклику для UI: saveShifts ніколи не має лишати ні
// необроблений reject, ні тиху втрату зміни.
function saveShiftsSafely(){
  try{
    return Promise.resolve(saveShifts()).catch(error=>{
      globalThis.MTSafeError?.reportError?.(error,{scope:'shifts-save'});
      showToast('⚠️ Не вдалося зберегти зміни — перевірте вільне місце і спробуйте ще раз');
      return false;
    });
  }catch(error){
    globalThis.MTSafeError?.reportError?.(error,{scope:'shifts-save'});
    showToast('⚠️ Не вдалося зберегти зміни — перевірте вільне місце і спробуйте ще раз');
    return Promise.resolve(false);
  }
}

const DAILY_BACKUP_MAX = 10;
// NEW: викликається раз при старті застосунку — якщо сьогодні ще не було
// автобекапу, робить знімок і кладе його в IndexedDB, старший за 10-й видаляє
function renderDailyBackupList(){
  const wrap = document.getElementById('dailyBackupList');
  if(!wrap) return;
  const index = loadDailyBackupIndex();
  wrap.innerHTML = index.length ? index.map(entry=>{
    const d = new Date(entry.ts);
    return `<div class="settings-row" style="align-items:center;">
      <div><div class="sr-title">${formatDate(d)}</div><div style="font-size:12px; color:var(--text-dim);">Заявок: ${entry.ticketsCount}, змін: ${entry.shiftsCount}</div></div>
      <div class="row" style="gap:6px;">
        <button type="button" class="btn btn-sm daily-backup-download-btn" data-date="${entry.date}" title="Зберегти як файл">💾</button>
        <button type="button" class="btn btn-sm btn-ghost daily-backup-restore-btn" data-date="${entry.date}" title="Відновити з цього дня">♻️</button>
      </div>
    </div>`;
  }).join('') : '<span style="color:var(--text-faint); font-size:13px;">Бекапів ще немає — перший з\'явиться після сьогоднішнього відкриття застосунку</span>';
}
/* ---- Щомісячне нагадування почистити старі файли бекапів у "Завантаженнях" ----
   Застосунок не може сам видаляти файли з "Завантажень" (браузер це навмисно
   забороняє), тож 1-го числа кожного місяця показуємо на весь екран нагадування
   зробити це вручну. Показується один раз за місяць, поки не натиснуть кнопку. */
function maybeShowMonthlyCleanupReminder(){
  const now = new Date();
  if(now.getDate() !== 1) return; // тільки 1-го числа
  const monthKey = localMonthKey(now); // YYYY-MM, локальний час
  if(localStorage.getItem('cleanupReminderMonth') === monthKey) return; // цього місяця вже показували
  showCleanupReminderOverlay(monthKey);
}
function showCleanupReminderOverlay(monthKey){
  const root = document.getElementById('cleanupReminderRoot');
  if(!root) return;
  root.innerHTML = `
    <div id="cleanupReminderOverlay" style="position:fixed; inset:0; z-index:210; background:var(--bg); display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:30px 24px; gap:14px;">
      <div style="font-size:56px;">🧹</div>
      <div style="font-size:20px; font-weight:800;">Перше число — час почистити бекапи!</div>
      <div style="font-size:14.5px; color:var(--text-dim); max-width:380px; line-height:1.5;">
        Кожен день сюди в «Завантаження» на телефоні складається новий файл
        <span style="font-family:var(--mono); font-size:12.5px;">master-tracker-daily-YYYY-MM-DD-encrypted.json</span>.
        Відкрий Файли / Завантаження і видали зайві старі — досить лишити останні кілька.
      </div>
      <button type="button" class="btn btn-accent btn-block" id="cleanupReminderDoneBtn" style="max-width:320px; margin-top:10px;">✅ Гаразд, я почистив(-ла)</button>
      <button type="button" class="btn btn-ghost btn-sm" id="cleanupReminderLaterBtn">Нагадати пізніше сьогодні</button>
    </div>`;
  document.getElementById('cleanupReminderDoneBtn').addEventListener('click', ()=>{
    localStorage.setItem('cleanupReminderMonth', monthKey); // цього місяця більше не показувати
    root.innerHTML = '';
  });
  document.getElementById('cleanupReminderLaterBtn').addEventListener('click', ()=>{
    root.innerHTML = ''; // ховаємо лише на зараз — знову зʼявиться при наступному відкритті сьогодні
  });
}

function backupLocalData(){
  if(typeof maybeRunDailyBackup === 'function') void maybeRunDailyBackup();
}

function restoreFromBackup(){
  showToast('Відновлення доступне у списку щоденних бекапів нижче');
  document.getElementById('dailyBackupList')?.scrollIntoView({behavior:'smooth',block:'center'});
}
