/* ---- Адаптер збереження масиву заявок і legacy-міграція ---- */
const PENDING_TICKETS_FALLBACK_KEY = 'pendingTicketsFallback';
let pendingTicketsFallbackWarningShown = false;

function loadPendingTicketsFallback(){
  try{
    const fallback = JSON.parse(localStorage.getItem(PENDING_TICKETS_FALLBACK_KEY));
    return Array.isArray(fallback) ? fallback : null;
  }catch(e){ return null; }
}
function showPendingTicketsFallbackWarning(message){
  if(pendingTicketsFallbackWarningShown) return;
  pendingTicketsFallbackWarningShown = true;
  showToast(message);
}
function savePendingTicketsFallback(){
  try{
    localStorage.setItem(PENDING_TICKETS_FALLBACK_KEY, JSON.stringify(tickets));
    showPendingTicketsFallbackWarning('⚠️ Локальна база не записалася в IndexedDB. Дані тимчасово збережено в аварійній копії.');
  }catch(e){
    showPendingTicketsFallbackWarning('⚠️ Локальна база не записалася в IndexedDB, а аварійну копію теж не вдалося зберегти. Не закривайте застосунок.');
  }
}

async function loadTicketsFromIdb(){
  const stored = await ticketsDbGet();
  if(Array.isArray(stored)){
    tickets = stored;
    if(loadPendingTicketsFallback()) showPendingTicketsFallbackWarning('⚠️ Є аварійна копія заявок, але основна база також містить дані. Автоматичне відновлення не виконано, щоб не перезаписати новіші зміни.');
    return;
  }
  const pendingFallback = loadPendingTicketsFallback();
  const legacy = loadJSON('tickets', []);
  // Не порівнюємо legacy і fallback автоматично: заявки не мають надійної
  // позначки часу останнього редагування. Старий сценарій міграції лишається
  // пріоритетним, а аварійна копія зберігається для ручного розбору конфлікту.
  if(pendingFallback && Array.isArray(legacy) && legacy.length){
    tickets = legacy;
    if(await ticketsDbPut(tickets)) localStorage.removeItem('tickets');
    showPendingTicketsFallbackWarning('⚠️ Є аварійна копія і legacy-база заявок. Автоматичне об’єднання не виконано, щоб не втратити новіші зміни.');
    return;
  }
  if(pendingFallback){
    tickets = pendingFallback;
    if(await ticketsDbPut(tickets)){
      localStorage.removeItem(PENDING_TICKETS_FALLBACK_KEY);
      pendingTicketsFallbackWarningShown = false;
    }else{
      showPendingTicketsFallbackWarning('⚠️ Не вдалося відновити аварійну копію в IndexedDB. Дані лишаються в пам’яті — не закривайте застосунок.');
    }
    return;
  }
  tickets = Array.isArray(legacy) ? legacy : [];
  // Legacy-копію можна прибрати лише після підтвердженого запису в IndexedDB.
  // Якщо сховище недоступне або заповнене, вона лишається страховкою на
  // наступний запуск замість безповоротної втрати всієї старої бази.
  if(await ticketsDbPut(tickets)) localStorage.removeItem('tickets');
}
function saveTickets(){
  ticketsRevision++;
  return ticketsDbPut(tickets).then(ok=>{
    if(!ok) savePendingTicketsFallback();
    else pendingTicketsFallbackWarningShown = false;
    return ok;
  });
}
