/* Diagnostic presentation and explicit result actions. Session state and network execution retain their existing owners. */
function toolsDiagnosticResultsHtml(){
  if(!toolsDiagnosticResult)return `<div class="card" style="text-align:center;color:var(--text-dim);">Натисніть «Запустити». Перевірка не змінює заявки чи профілі.</div>`;
  const r=MTToolsCore.sanitizeDiagnosticResult(toolsDiagnosticResult);
  const summary=r.summaryStatus==='ok'?'✅ Основні перевірки успішні':r.summaryStatus==='offline'?'❌ Немає інтернет-з’єднання':'⚠ Є обмеження або часткова проблема';
  const resourceText=item=>item.ok?(item.status||item.httpMs!==null?`✅ HTTP ${item.status||'—'} · ${item.httpMs??'—'} мс`:`✅ ${item.detail||'Доступно'}`):item.state==='timeout'?'⏳ Таймаут':item.state==='http'?`⚠ HTTP ${item.status||'помилка'}`:'⚠ Обмеження мережі/браузера';
  const rows=[
    ['Інтернет',r.online?'✅ Доступний':r.internetStatus==='offline'?'❌ Немає з’єднання':'⚠ Не підтверджено'],
    ['Публічна IP',r.publicIp?escapeHtml(r.publicIp.split(' / ')[0]):'Недоступно'],
    ['DNS',r.dnsStatus==='indirect'?'✅ Працює для HTTPS':'Недоступно / не підтверджено']
  ];
  rows.push(['Відгук інтернету',r.latencyMs!==null?`${r.latencyMs} мс`:'Недоступно в браузері']);
  rows.push(['Стабільність відгуку',r.jitterMs!==null?`${r.jitterMs} мс`:'Недоступно в браузері']);
  if(r.downloadMbps!==null)rows.push(['Завантаження',`${r.downloadMbps} Мбіт/с`]);
  if(r.uploadMbps!==null)rows.push(['Відвантаження',`${r.uploadMbps} Мбіт/с`]);
  const resourcesHtml=r.resources.map(item=>`<div class="tools-result-row"><span>${escapeHtml(item.label)}</span><strong style="text-align:right;">${resourceText(item)}</strong></div>`).join('');
  const actions=toolsDiagnosticContext?.ticketId||toolsDiagnosticContext?.editorContext
    ? `<button type="button" class="btn btn-accent" data-tools-action="save-diagnostics" style="flex:1;" ${toolsDiagnosticSaved?'disabled':''}>${toolsDiagnosticSaved?'✅ Збережено':'Зберегти в заявку'}</button>`
    : `<button type="button" class="btn" data-tools-action="attach-diagnostics" style="flex:1;">Прив'язати до адреси</button>`;
  return `<div class="card"><strong>${summary}</strong><div style="font-size:11.5px;color:var(--text-dim);margin-top:5px;">DNS перевіряється непрямо через HTTPS: браузер не надає прямий DNS lookup.</div>${rows.map(row=>`<div class="tools-result-row"><span>${escapeHtml(row[0])}</span><strong style="text-align:right;">${row[1]}</strong></div>`).join('')}<div style="font-size:12px;font-weight:700;margin-top:9px;">Контрольні ресурси</div>${resourcesHtml}</div>
    <details class="tools-map-info" style="margin-top:10px;"><summary>Що означають ці показники?</summary><div><strong>Відгук інтернету</strong> — час відповіді на браузерний HTTPS-запит. <strong>Стабільність відгуку</strong> — наскільки змінюється цей час між перевірками. Менше — краще. Це не звичайний ICMP Ping.</div></details>
    <div class="row wrap"><button type="button" class="btn" data-tools-action="copy-diagnostics" style="flex:1;">📋 Скопіювати</button>${actions}</div>`;
}
function toolsSpeedTestHtml(){return `<div class="card" style="margin-top:12px;"><strong>Браузерна оцінка швидкості</strong><div id="toolsSpeedStatus" style="font-size:12px;color:var(--text-dim);margin:6px 0 0;">${escapeHtml(toolsSpeedStatus||'Входить до повної діагностики. Це приблизна браузерна оцінка, а не системний тест швидкості.')}</div>${toolsSpeedController?'<button type="button" class="btn btn-block" data-tools-action="cancel-speed-test" style="margin-top:9px;">Скасувати діагностику</button>':''}</div>`;}
function toolsDiagnosticsHtml(){
  return `${toolsBackButton()}${toolsContextHtml()}
    <button type="button" class="btn btn-accent btn-block" data-tools-action="run-diagnostics" id="toolsRunDiagnosticsBtn">▶ Запустити діагностику</button>
    <div id="toolsDiagnosticsResults" style="margin-top:12px;">${toolsDiagnosticResultsHtml()}</div>
    ${toolsSpeedTestHtml()}
    ${toolsReturnTab==='calculator'?'<button type="button" class="btn btn-accent btn-block" data-tools-action="return-to-ticket" style="margin-top:12px;">← Повернутися до заявки</button>':''}
    <div class="card" style="margin-top:12px;"><strong>Роутер</strong><div style="font-size:12px;color:var(--text-dim);margin:5px 0 9px;">Автоперевірка локальних адресів ненадійна через HTTPS, CORS і Private Network Access. Відкриття — тільки вручну.</div>
      <div class="row wrap">${['192.168.0.1','192.168.1.1','192.168.100.1'].map(ip=>`<button type="button" class="btn btn-sm" data-router-ip="${ip}">${ip}</button>`).join('')}</div></div>
    <div class="card" id="toolsConnectionCheckRoot" style="margin-top:12px;"><strong>Безперервна перевірка доступності</strong><div style="font-size:12px;color:var(--text-dim);margin:5px 0 9px;">Це браузерні HTTPS-запити, не ICMP ping. CORS/браузерне блокування рахується окремо й не видається за втрату пакетів.</div>
      <div class="field"><label>HTTPS URL або хост</label><input id="toolsConnectionTarget" name="mt-internal-diagnostic-host" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" value="${escapeHtml(toolsConnectionCheck?.target||'')}" placeholder="https://api.ipify.org"></div>
      <div class="row wrap"><button type="button" class="btn btn-accent" data-tools-action="start-connection-check" style="flex:1;">▶ Запустити</button><button type="button" class="btn" data-tools-action="stop-connection-check" style="flex:1;">■ Зупинити</button></div>
      <div id="toolsConnectionCheckStats" class="tools-connection-stats">${toolsConnectionStatsHtml()}</div>
      <div id="toolsConnectionCheckLog" class="tools-connection-log">${toolsConnectionLogHtml()}</div>
    </div>`;
}

function toolsProfileDiagnosticsHtml(list=[]){
  const profile=MTToolsCore.profileFromTickets(list),combined=[...toolsDiagnostics.filter(item=>item.profileId===profile.id),...list.flatMap(ticket=>MTToolsCore.sanitizeDiagnostics(ticket.diagnosticHistory||[]))],history=[...new Map(combined.map(item=>[item.id,item])).values()].sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp)));
  const latest=history[0],previous=history[1],comparison=latest&&previous?MTToolsCore.diagnosticComparison(latest,previous):[];
  const historyHtml=history.slice(0,5).map(item=>{
    const result=item.result||{},metrics=[result.latencyMs!==null&&result.latencyMs!==undefined?`Відгук ${result.latencyMs} мс`:'',result.downloadMbps!==null&&result.downloadMbps!==undefined?`${result.downloadMbps} Mbps`:''].filter(Boolean).join(' · ');
    return `<div style="font-size:11.5px;color:var(--text-dim);margin-top:4px;">${escapeHtml(new Date(item.timestamp).toLocaleString('uk-UA'))}${metrics?` — ${escapeHtml(metrics)}`:''}</div>`;
  }).join('');
  const ids=escapeHtml(JSON.stringify(list.map(ticket=>ticket.id)));
  return `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
    <div class="row between"><strong style="font-size:13px;">🛠 Діагностика</strong><button type="button" class="btn btn-sm abonent-diagnostics-btn" data-ids="${ids}">Запустити</button></div>
    ${latest?`<div style="font-size:12px;color:var(--text-dim);margin-top:7px;">Історія:</div>${historyHtml}${comparison.map(item=>`<div style="font-size:12px;margin-top:3px;">${escapeHtml(item.label)}: ${item.from} → ${item.to} ${item.unit}</div>`).join('')}`:'<div style="font-size:12px;color:var(--text-faint);margin-top:7px;">Збережених результатів немає</div>'}
  </div>`;
}
function toolsAttachDiagnostics(){
  const profiles=MTToolsCore.listProfiles(tickets);
  if(!profiles.length){showToast('Немає існуючих адрес для прив’язки');return;}
  openModal('Прив’язати діагностику',`<div class="field"><label>Пошук існуючої адреси</label><input type="search" id="toolsDiagnosticsProfileSearch" name="mt-internal-profile-search" role="searchbox" inputmode="search" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Місто, вулиця, будинок, квартира або адреса"></div><div id="toolsDiagnosticsProfileChoices" style="max-height:52vh;overflow:auto;"></div>`,{onOpen:root=>{
    const input=document.getElementById('toolsDiagnosticsProfileSearch'),choices=document.getElementById('toolsDiagnosticsProfileChoices');
    const render=query=>{const needle=String(query||'').trim().toLocaleLowerCase('uk'),matches=profiles.filter(profile=>!needle||[profile.city,profile.street,profile.house,profile.apartment,profile.address].some(value=>String(value||'').toLocaleLowerCase('uk').includes(needle))).slice(0,100);choices.innerHTML=matches.map(profile=>`<button type="button" class="btn btn-block tools-profile-choice" data-profile-id="${escapeHtml(profile.id)}" style="margin-bottom:8px;text-align:left;justify-content:flex-start;">📍 ${escapeHtml(profile.address)}</button>`).join('')||'<div class="card">Нічого не знайдено.</div>';};
    render('');input.addEventListener('input',()=>render(input.value));root.addEventListener('click',event=>{const button=event.target.closest('.tools-profile-choice');if(!button)return;const profile=profiles.find(item=>item.id===button.dataset.profileId);toolsDiagnosticContext=profile?{...profile,ticketId:String(profile.tickets?.[0]?.id||'')}:null;closeModal();renderToolsScreen('diagnostics');});
  }});
}
async function toolsSaveCurrentDiagnostic(){
  if(!toolsDiagnosticResult||toolsDiagnosticSaved)return;
  const ticketId=String(toolsDiagnosticContext?.ticketId||''),ticket=ticketId?tickets.find(item=>String(item.id)===ticketId):null;
  const draft=toolsDiagnosticContext?.editorContext?toolsCalculatorDraft:null;
  if(!ticket&&!draft?.state){showToast('Заявку для збереження не знайдено');return;}
  const record=MTToolsCore.makeDiagnosticRecord(toolsDiagnosticResult,toolsDiagnosticContext,toolsDiagnosticRunAt||new Date());
  const previousTicket=ticket&&Array.isArray(ticket.diagnosticHistory)?ticket.diagnosticHistory.slice():[];
  const previousDraft=draft?.state&&Array.isArray(draft.state.diagnosticHistory)?draft.state.diagnosticHistory.slice():[];
  if(ticket)ticket.diagnosticHistory=MTToolsCore.appendDiagnosticHistory(previousTicket,record);
  if(draft?.state){draft.state.diagnosticHistory=MTToolsCore.appendDiagnosticHistory(previousDraft,record);try{localStorage.setItem(MT_TOOLS_DRAFT_KEY,JSON.stringify(draft));}catch(_e){if(ticket)ticket.diagnosticHistory=previousTicket;draft.state.diagnosticHistory=previousDraft;showToast('Не вдалося зберегти діагностику в чернетку');return;}}
  if(!ticket||await saveTickets()){toolsDiagnosticSaved=true;showToast('Діагностику збережено в заявку');renderToolsScreen('diagnostics');}
  else{ticket.diagnosticHistory=previousTicket;if(draft?.state){draft.state.diagnosticHistory=previousDraft;try{localStorage.setItem(MT_TOOLS_DRAFT_KEY,JSON.stringify(draft));}catch(_e){}}}
}
async function toolsCopyDiagnostic(){
  if(!toolsDiagnosticResult)return;
  const report=MTToolsCore.diagnosticReport(toolsDiagnosticResult,toolsDiagnosticContext,toolsDiagnosticRunAt||new Date());
  try{await navigator.clipboard.writeText(report);showToast('Діагностику скопійовано');}catch(_e){showToast('Не вдалося скопіювати');}
}
