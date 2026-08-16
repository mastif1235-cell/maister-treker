/* ---- Адаптер збереження масиву заявок і legacy-міграція ---- */
async function loadTicketsFromIdb(){
  const stored = await ticketsDbGet();
  if(Array.isArray(stored)){
    tickets = stored;
    return;
  }
  const legacy = loadJSON('tickets', []);
  tickets = Array.isArray(legacy) ? legacy : [];
  // Legacy-копію можна прибрати лише після підтвердженого запису в IndexedDB.
  // Якщо сховище недоступне або заповнене, вона лишається страховкою на
  // наступний запуск замість безповоротної втрати всієї старої бази.
  if(await ticketsDbPut(tickets)) localStorage.removeItem('tickets');
}
function saveTickets(){ ticketsRevision++; return ticketsDbPut(tickets); }
