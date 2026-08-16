/*
 * Низькоризикові чисті утиліти.
 *
 * Це класичний script, а не ES-модуль: функції навмисно залишаються
 * доступними глобально, щоб app.js продовжував працювати без зміни його
 * існуючих викликів. Тут немає DOM, localStorage, IndexedDB або мережі.
 */

function pad2(n){ return String(n).padStart(2,'0'); }

// toISOString() завжди повертає UTC, а не локальний час. Ці ключі дати
// використовують локальний час пристрою.
function localDateKey(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function localMonthKey(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`; }

function normalizeMac(raw){
  if(!raw) return '';
  return String(raw).toUpperCase().replace(/[^0-9A-F]/g,'');
}

function formatDate(d){ return `${pad2(d.getDate())}.${pad2(d.getMonth()+1)}.${d.getFullYear()}`; }
function formatTime(d){ return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

function parseDate(str){
  if(!str) return new Date();
  const [dd,mm,yyyy] = str.split('.').map(Number);
  return new Date(yyyy, (mm||1)-1, dd||1);
}

function shiftDate(str, days){
  const d = parseDate(str);
  d.setDate(d.getDate()+days);
  return formatDate(d);
}

function ddmmyyyyToIso(s){
  const m = String(s||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

function isSameMonth(dateStr, refDate){
  const d = parseDate(dateStr);
  return d.getMonth()===refDate.getMonth() && d.getFullYear()===refDate.getFullYear();
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function fmtMoney(n){ return `${Math.round(n||0)} грн`; }
