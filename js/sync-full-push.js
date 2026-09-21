/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — ручна повна відправка локальної бази (пункт 11,
   аудит v91.27)

   Окрема РУЧНА дія в налаштуваннях синхронізації: надсилає ВСЮ поточну
   локальну базу (заявки + зміни) у Google Sheets — не лише невідправлені
   зміни. Ніколи не запускається автоматично.

   Чому не серверний syncAll/syncAllTickets/syncAllShifts: сервер навмисно
   відхиляє ці дії кодом ADMIN_RECOVERY_REQUIRED (GAS-CONTRACT.md) — повна
   заміна таблиць не зберігає revision/tombstone стану і могла б знищити
   свіжіші хмарні дані. Тому повна відправка йде тим самим безпечним
   шляхом, що й звичайна синхронізація: кожен запис окремою мутацією
   через журнал (MTSyncEngineCore/Engine) під захистом серверного CAS по
   revision. Наслідки:
   - хмарні таблиці НЕ замінюються цілком і не очищаються;
   - якщо хмарний запис свіжіший за локальний — сервер повертає STALE,
     хмарна версія лишається недоторканою (звіт покаже «хмара новіша»), а
     локальна версія паркується в журналі як конфлікт (⚠️ на картці) —
     користувач сам обирає, яку версію лишити;
   - CONFLICT/TOMBSTONED/REVISION_GAP потрапляють у журнал конфліктів,
     а не перезаписують хмару мовчки;
   - offline/мережеві помилки лишають мутації в журналі — вони
     надсилаються автоматично, коли з'явиться зв'язок.
   ===================================================================== */

let mtSyncFullPushRunning = false;

function mtSyncFullPushKey(engine, entity, id){
  if(engine && engine.core && typeof engine.core.key === 'function') return engine.core.key(entity, id);
  return entity + ':' + String(id);
}

/* Записи, які журнал уже вважає видаленими (tombstone) або які мають
   невирішений конфлікт, НЕ чіпаємо: enqueue tombstone-запису кидає
   TOMBSTONED, а перезапис конфлікту ламала б семантику його вирішення.
   Вони лишаються користувачу для явного розбору в черзі синхронізації. */
function mtSyncFullPushSelect(engine, entity, items){
  const chosen = [];
  const skipped = { tombstoned: 0, conflict: 0 };
  (Array.isArray(items) ? items : []).forEach(item => {
    if(!item || typeof item !== 'object') return;
    const record = engine.state && engine.state.records ? engine.state.records[mtSyncFullPushKey(engine, entity, item.id)] : null;
    if(record && record.tombstone){ skipped.tombstoned++; return; }
    if(record && record.conflict){ skipped.conflict++; return; }
    chosen.push(item);
  });
  return { chosen, skipped };
}

function mtSyncFullPushBlankStats(){
  return { total: 0, sent: 0, cloudNewer: 0, conflicts: 0, failed: 0, queued: 0 };
}

function mtSyncFullPushClassifyResult(entry){
  const result = entry && entry.result;
  if(result && result.ok){
    const outcome = String((result.result && result.result.outcome) || '');
    if(outcome === 'STALE') return 'cloudNewer';
    return 'sent'; // APPLIED / IDEMPOTENT_SUCCESS
  }
  const code = String((result && result.result && result.result.code) || '');
  if(code === 'CONFLICT' || code === 'TOMBSTONED' || code === 'REVISION_GAP') return 'conflicts';
  return 'failed';
}

function mtSyncFullPushReportHtml(report){
  const line = (label, s) =>
    `<p style="margin:0 0 6px;"><strong>${label}:</strong> надіслано ${s.sent} із ${s.total}` +
    (s.cloudNewer ? `; у хмарі новіше — не перезаписано: ${s.cloudNewer}` : '') +
    (s.conflicts ? `; конфлікти: ${s.conflicts}` : '') +
    (s.failed ? `; помилки відправки: ${s.failed}` : '') +
    (s.queued ? `; лишилось у черзі: ${s.queued}` : '') +
    '.</p>';
  let html = `<div style="font-size:13px; line-height:1.5;">` +
    line('Заявки', report.ticket) + line('Зміни', report.shift);
  if(report.skippedTombstoned || report.skippedConflict){
    html += `<p style="margin:0 0 6px; color:var(--text-dim);">Пропущено без відправки: видалені в хмарі — ${report.skippedTombstoned}, з невирішеним конфліктом — ${report.skippedConflict}. Їх можна розібрати в черзі синхронізації.</p>`;
  }
  const problems = report.ticket.conflicts + report.ticket.failed + report.shift.conflicts + report.shift.failed;
  const queued = report.ticket.queued + report.shift.queued;
  const cloudNewer = report.ticket.cloudNewer + report.shift.cloudNewer;
  if(queued && !report.wasOnline){
    html += `<p style="margin:0;">Немає з'єднання: усі мутації збережені в журналі й надішлються автоматично, коли інтернет з'явиться.</p>`;
  }else if(problems){
    html += `<p style="margin:0;">⚠️ Не все надіслано. Хмарні дані, які виявились свіжішими, НЕ перезаписані. Решта лишиться в черзі та повториться автоматично.</p>`;
  }else if(cloudNewer){
    html += `<p style="margin:0;">✅ Відправку завершено. Для ${cloudNewer} запис(ів) у хмарі виявилась свіжіша версія — вона НЕ перезаписана, локальна копія для них не застосовувалась. Ці записи позначені ⚠️ Конфлікт: відкрийте кожен і оберіть, яку версію лишити.</p>`;
  }else{
    html += `<p style="margin:0;">✅ Усю локальну базу надіслано.</p>`;
  }
  return html + '</div>';
}

async function mtSyncFullPushLocalDatabase(options = {}){
  const button = options.button || null;
  if(mtSyncFullPushRunning){ showToast('Повна відправка вже виконується'); return false; }
  if(typeof getScriptUrl !== 'function' || !getScriptUrl()){ showToast('Спочатку вкажіть URL Apps Script у налаштуваннях'); return false; }
  if(typeof syncEngine === 'undefined' || !syncEngine){ showToast('Синхронізація тимчасово недоступна — зміни збережено локально'); return false; }
  const localTickets = (typeof tickets !== 'undefined' && Array.isArray(tickets)) ? tickets : [];
  const localShifts = (typeof shifts !== 'undefined' && Array.isArray(shifts)) ? shifts : [];
  if(!localTickets.length && !localShifts.length){ showToast('Локальна база порожня — надсилати нічого'); return false; }

  const confirmed = await openConfirmModal({
    title: 'Повна відправка локальної бази в хмару?',
    message: `У Google Sheets буде надіслана ВСЯ локальна база: ${localTickets.length} заявок і ${localShifts.length} змін — не лише невідправлені зміни. ` +
      'Таблиці НЕ замінюються цілком: кожен запис іде окремо через безпечний журнал синхронізації. ' +
      'Якщо запис у хмарі свіжіший за локальний — він НЕ буде перезаписаний (хмарна версія збережеться, а застосунок повідомить про це у звіті). ' +
      'Операція може тривати кілька хвилин залежно від розміру бази.',
    confirmLabel: 'Надіслати всю базу',
    danger: true
  });
  if(!confirmed) return false;

  mtSyncFullPushRunning = true;
  if(button) button.disabled = true;
  showToast(`Надсилаю всю локальну базу: ${localTickets.length} заявок, ${localShifts.length} змін…`);

  // Тимчасова інструментація transport.send ЛИШЕ на час операції: журнал
  // мутацій і рушій не змінюються, це тільки збір результатів для звіту.
  const transport = syncEngine.transport;
  const originalSend = transport && typeof transport.send === 'function' ? transport.send : null;
  const tracked = [];
  if(originalSend){
    transport.send = function(item){
      const promise = originalSend.call(transport, item);
      return Promise.resolve(promise).then(result => {
        try{ tracked.push({ entity: item.entity, id: String(item.id), result }); }catch(_e){}
        return result;
      }, error => {
        try{ tracked.push({ entity: item.entity, id: String(item.id), result: { ok: false, result: { code: 'NETWORK', message: String(error && error.message || error) } } }); }catch(_e){}
        throw error;
      });
    };
  }

  try{
    const ticketSelection = mtSyncFullPushSelect(syncEngine, 'ticket', localTickets);
    const shiftSelection = mtSyncFullPushSelect(syncEngine, 'shift', localShifts);
    const report = {
      ticket: mtSyncFullPushBlankStats(),
      shift: mtSyncFullPushBlankStats(),
      skippedTombstoned: ticketSelection.skipped.tombstoned + shiftSelection.skipped.tombstoned,
      skippedConflict: ticketSelection.skipped.conflict + shiftSelection.skipped.conflict,
      wasOnline: typeof navigator === 'undefined' ? true : navigator.onLine !== false
    };
    if(ticketSelection.chosen.length) await syncEngine.recordDiff('ticket', [], ticketSelection.chosen);
    if(shiftSelection.chosen.length) await syncEngine.recordDiff('shift', [], shiftSelection.chosen);
    await syncEngine.flush();
    // Якщо перший flush завершився до постановки другої партії в журнал —
    // один повторний прохід забирає решту (offline/помилки лишаються в черзі).
    if(syncEngine.pendingCount && syncEngine.pendingCount() > 0 && (typeof navigator === 'undefined' || navigator.onLine !== false)){
      await syncEngine.flush();
    }

    // Локальні дублікати ID дають одну мутацію журналу, тож у звіті теж
    // рахуємо унікальні сутності (total збігається з сумами результатів).
    const seen = new Set();
    const expected = [];
    ticketSelection.chosen.forEach(item => expected.push({ entity: 'ticket', id: String(item.id) }));
    shiftSelection.chosen.forEach(item => expected.push({ entity: 'shift', id: String(item.id) }));
    expected.forEach(entry => {
      const key = entry.entity + ':' + entry.id;
      if(seen.has(key)) return;
      seen.add(key);
      const bucket = report[entry.entity];
      bucket.total++;
      const attempts = tracked.filter(t => t.entity === entry.entity && t.id === entry.id);
      if(!attempts.length){ bucket.queued++; return; }
      bucket[mtSyncFullPushClassifyResult(attempts[attempts.length - 1])]++;
    });

    if(typeof openModal === 'function'){
      openModal('Повна відправка локальної бази', mtSyncFullPushReportHtml(report), {});
    }else{
      showToast(`Надіслано заявок: ${report.ticket.sent}, змін: ${report.shift.sent}`);
    }
    if(typeof renderSyncQueueBanner === 'function') renderSyncQueueBanner();
    return true;
  }catch(error){
    globalThis.MTSafeError?.reportError?.(error, { scope: 'sync-full-push' });
    showToast('❌ Повна відправка не вдалася — дані збережено локально, черга продовжить автоматично');
    return false;
  }finally{
    if(originalSend) transport.send = originalSend;
    mtSyncFullPushRunning = false;
    if(button) button.disabled = false;
  }
}
