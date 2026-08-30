/* ---- Пасивний візуальний рендеринг заявок ----
   Читає готові дані та оновлює лише DOM. */
function renderDateNavVisibility(){
  const inSpecialMode = searchQuery.trim().length>0 || activeFilterTags.size>0;
  document.getElementById('dateNavBlock').classList.toggle('hidden', inSpecialMode);
  document.getElementById('modeSummaryBlock').classList.toggle('hidden', !inSpecialMode);
}

function renderDaySummary(){
  const dayTickets = ticketsForDate(currentTicketDate);
  const sum = dayTickets.reduce((s,t)=>s+(Number(t.sum)||0),0);
  document.getElementById('daySummary').textContent = dayTickets.length
    ? `${dayTickets.length} заявок · ${fmtMoney(sum)}`
    : 'заявок немає';
}

function renderEmptyTicketList(listEl){
  listEl.innerHTML = `<div class="empty-state"><div class="es-icon">🗂️</div>Заявок не знайдено</div>`;
}

function buildShowMoreTicketsButton(remaining){
  return `<button type="button" class="btn btn-block show-more-tickets-btn" style="margin:10px 0;">
      Показати ще ${Math.min(remaining, TICKET_LIST_PAGE_SIZE)} (залишилось ${remaining})
    </button>`;
}

function splitTicketContentForTechnicalDetails(content){
  const lines=String(content||'').split('\n').filter(line=>{
    return !/^\s*(?:🔧\s*)?MAC(?:\s+ONU)?\s*:/i.test(line)
      && !/^\s*📶\s*(?:Сигнал ONU\s*:)?\s*[-+]?\d+(?:[.,]\d+)?\s*dBm\s*$/i.test(line);
  });
  let anchor=-1;
  [/^\s*📞\s*Тел\s*:/i,/^\s*👤\s*Клієнт\s*:/i,/^\s*📍\s*Адреса\s*:/i,/^\s*🏙️\s*Місто\s*:/i].some(pattern=>{
    anchor=lines.findIndex(line=>pattern.test(line));
    return anchor>=0;
  });
  const splitAt=anchor>=0 ? anchor+1 : Math.min(lines.length,4);
  return {before:lines.slice(0,splitAt).join('\n'),after:lines.slice(splitAt).join('\n')};
}

// NEW: стислий опис виконаної роботи (обладнання/кабелі/роботи/нотатка) БЕЗ
// імені, телефону, адреси — для картки під "профілем абонента", де ці дані
// вже показані один раз вище, а не в кожній заявці окремо.
function renderTicketCard(t, opts={}){
  const tagsHtml = (t.tags||[]).map(tag=>`<span class="chip">${escapeHtml(tag)}</span>`).join('');
  const sub = [t.city, t.address].filter(Boolean).join(', '); // NEW: у шапці лишили тільки адресу — ім'я/телефон і так є в повному тексті нижче (Розгорнути)
  const signalText = formatOnuSignal(t.signal);
  const dayNum = getDailyTicketNumber(t); // NEW: № заявки за день
  const geoBtn = t.geoLink ? `<a href="${escapeHtml(t.geoLink)}" target="_blank" rel="noopener" class="btn btn-sm" style="text-decoration:none;">📍 Перейти</a>` : '';
  // NEW: opts.workOnly — режим для картки "профілю абонента" (навігатор адрес):
  // замість повного тексту заявки (де є ім'я/телефон/адреса) показуємо лише
  // короткий перелік виконаних робіт — решта вже видно один раз у шапці профілю.
  const displayContent = opts.workOnly ? buildWorkSummaryLines(t).join('\n') : String(t.content||'');
  const detailContent = opts.workOnly ? {before:displayContent,after:''} : splitTicketContentForTechnicalDetails(displayContent);
  const hasContent = !!(detailContent.before || detailContent.after);
  const isOther = t.type === 'Інше';
  // Індикатор синхронізації показується лише якщо синхронізація взагалі налаштована.
  // ✅ означає, що canonical sync engine отримав читабельне підтвердження
  // або відновив його через підписаний getEntityState після втраченої відповіді.
  let syncBadge = '';
  if(getScriptUrl()){
    const conflict = getEntityConflict('ticket',t.id);
    syncBadge = conflict
      ? `<button type="button" class="tc-sync-badge btn-danger resolve-sync-conflict-btn" data-id="${t.id}" title="Оберіть, яку версію зберегти" style="border:none; cursor:pointer;">⚠️ Конфлікт</button>`
      : isEntitySynced('ticket',t.id)
      ? `<span class="tc-sync-badge tc-sync-ok" title="Підтверджено сервером">✅ Таблиця</span>`
      : `<span class="tc-sync-badge tc-sync-pending retry-sync-btn" data-id="${t.id}" title="Натисніть, щоб повторити спробу">⏳ Таблиця</span>`;
  }
  // NEW: та сама логіка для бекапу в Telegram-групу, що й вище для Google
  // Таблиці — показуємо статус, і якщо ще не надіслано, даємо кнопку "повторити"
  // прямо на картці (а не мовчки ховаємо індикатор, як було раніше).
  let tgBadge = '';
  if((settings.tgBotToken||'').trim() && (settings.tgBackupChatId||'').trim() && t.content){
    tgBadge = t.tgBackedUp
      ? `<button type="button" class="tc-sync-badge tc-sync-ok tg-open-btn" data-id="${t.id}" title="Відкрити цю заявку в Telegram" style="border:none; cursor:pointer;">☁️✅ Telegram</button>`
      : `<button type="button" class="tc-sync-badge tc-sync-pending retry-tg-btn" data-id="${t.id}" title="Натисніть, щоб повторити спробу" style="border:none; cursor:pointer;">☁️⏳ Telegram</button>`;
  }
  // NEW: у шапці лишили тільки статус заявки + адресу; все інше (час, сума,
  // номер договору, логін/пароль, опис, нотатка майстра) сховано всередину
  // одного блоку tc-details, який розгортається кнопкою "▼ Розгорнути"
  return `
  <div class="ticket-card" data-id="${t.id}" data-workonly="${opts.workOnly ? '1' : '0'}">
    <div class="tc-head">
      <div style="flex:1; min-width:0;">
        <div class="tc-type">${dayNum ? `<span class="tc-num">${dayNum}</span>` : ''}${escapeHtml(t.type||'Заявка')}</div>
        ${sub ? `<div class="tc-sub">${escapeHtml(sub)}</div>` : ''}
      </div>
      <div style="text-align:right; flex-shrink:0;">
        <div class="tc-time">${escapeHtml(t.date)} ${escapeHtml(t.time||'')}</div>
        ${isOther ? '' : `<div class="tc-sum tabular">${fmtMoney(t.sum)}</div>`}
      </div>
    </div>
    ${(syncBadge || tgBadge) ? `<div class="tc-status-row">${syncBadge}${tgBadge}</div>` : ''}
    ${(opts.workOnly || hasContent || t.contractNumber || t.login || t.password || t.masterNote) ? `<button type="button" class="tc-expand-btn" data-id="${t.id}">▼ Розгорнути</button>` : ''}
    <div class="tc-details tc-collapsed" id="tcc-${t.id}">
      ${(t.contractNumber && !opts.workOnly) ? `<div class="tc-sub" style="color:var(--accent);">📄 № ${escapeHtml(t.contractNumber)}</div>` : ''}
      ${detailContent.before ? `<div class="tc-content">${escapeHtml(detailContent.before)}</div>` : ''}
      ${((t.macAddress || signalText) && !opts.workOnly) ? `<div class="tc-tech" style="margin-top:8px; font-size:13.5px; line-height:1.55; color:var(--text-dim);">
        ${t.macAddress ? `<div>MAC: <span style="font-family:var(--mono);">${escapeHtml(t.macAddress)}</span></div>` : ''}
        ${signalText ? `<div>📶 Сигнал ONU: ${escapeHtml(normalizeOnuSignal(t.signal))} dBm</div>` : ''}
      </div>` : ''}
      ${((t.login || t.password) && !opts.workOnly) ? `<div class="tc-creds" style="margin-top:8px; padding:8px 10px; border-radius:8px; background:var(--surface-2); border:1px solid var(--accent); font-size:14px; line-height:1.5;">
        ${t.login ? `👤 <strong>Логін:</strong> <span style="font-family:var(--mono);">${escapeHtml(t.login)}</span>` : ''}${t.login && t.password ? '<br>' : ''}${t.password ? `🔑 <strong>Пароль:</strong> <span style="font-family:var(--mono);">${escapeHtml(t.password)}</span>` : ''}
      </div>` : ''}
      ${detailContent.after ? `<div class="tc-content">${escapeHtml(detailContent.after)}</div>` : (!hasContent && opts.workOnly ? `<div style="font-size:12.5px; color:var(--text-faint);">Для цього візиту не відмічено жодного обладнання чи роботи</div>` : '')}
      ${t.masterNote ? `<div class="tc-master-note" style="margin-top:8px; padding:8px 10px; border-radius:8px; background:var(--surface-2); border:1px dashed var(--text-dim); font-size:13px; color:var(--text-dim);">🔒 <strong>Тільки для вас:</strong> ${escapeHtml(t.masterNote)}</div>` : ''}
      ${opts.workOnly ? `<button type="button" class="btn btn-sm view-full-ticket-btn" data-id="${t.id}" style="margin-top:8px;">🔍 Повна заявка</button>` : ''}
    </div>
    <div class="tc-tags" style="margin-top:8px;">${tagsHtml}${(t.photos&&t.photos.length)||t.photo ? `<button type="button" class="tc-photo-badge tc-photo-toggle-btn" data-id="${t.id}" data-photo-keys='${escapeHtml(JSON.stringify((t.photos&&t.photos.length)?t.photos:[t.photo]))}' data-tg-file-ids='${escapeHtml(JSON.stringify((t.tgPhotoFileIds&&t.tgPhotoFileIds.length)?t.tgPhotoFileIds:(t.tgPhotoFileId?[t.tgPhotoFileId]:[])))}'>📷 Фото${(t.photos&&t.photos.length>1) ? ` (${t.photos.length})` : ''}</button>` : ''}</div>
    ${(t.photos&&t.photos.length)||t.photo ? `<div class="tc-photo-wrap hidden row wrap" style="gap:8px;" id="tcp-${t.id}"></div>` : ''}
    <div class="tc-actions">
      <button type="button" class="btn btn-sm edit-ticket-btn" data-id="${t.id}">✏️ Редагувати</button>
      ${opts.workOnly
        ? `<button type="button" class="btn btn-sm jump-to-date-btn" data-id="${t.id}" title="Перейти на цю дату в списку заявок">🗓️ На дату</button>`
        : `<button type="button" class="btn btn-sm goto-profile-btn" data-id="${t.id}" title="Перейти до профілю абонента">👤 В профіль</button>`}
      ${opts.workOnly ? '' : geoBtn}
      <button type="button" class="btn btn-sm share-ticket-btn" data-id="${t.id}">📤 Переслати</button>
      ${opts.workOnly ? `<button type="button" class="btn btn-sm tg-dispatcher-btn" data-id="${t.id}" title="Надіслати диспетчеру через Telegram-бота">✈️ Диспетчеру</button>` : ''}
      ${opts.workOnly ? `<button type="button" class="btn btn-sm copy-ticket-btn" data-id="${t.id}">📄 Копіювати</button>` : ''}
      <button type="button" class="btn btn-sm btn-danger delete-ticket-btn" data-id="${t.id}">🗑️ Видалити</button>
    </div>
  </div>`;
}

/* ---- Фільтр за тегами ---- */
function renderTagFilterChips(){
  const counts = {};
  tickets.forEach(t=>(t.tags||[]).forEach(tag=>{ counts[tag]=(counts[tag]||0)+1; }));
  // NEW: показуємо лише офіційні теги з Налаштувань — а не будь-які, що
  // колись потрапили в t.tags (наприклад, лишились від видаленого тега).
  const allTags = settings.tags;
  const wrap = document.getElementById('tagFilterChips');
  wrap.innerHTML = allTags.map(tag=>{
    const active = activeFilterTags.has(tag);
    return `<span class="chip ${active?'active':''}" style="display:inline-flex; align-items:center; gap:6px; padding-right:6px;">
      <button type="button" data-tag="${escapeHtml(tag)}" style="background:none; border:none; color:inherit; font:inherit; padding:0;">${escapeHtml(tag)} ${counts[tag]?`· ${counts[tag]}`:''}</button>
      <button type="button" data-deltag="${escapeHtml(tag)}" title="Видалити цей тег зі всіх заявок" style="background:none; border:none; color:var(--text-dim); font-size:14px; padding:0 2px; line-height:1;">✕</button>
    </span>`;
  }).join('') || '<span style="color:var(--text-faint); font-size:13px;">Тегів ще немає</span>';
}
