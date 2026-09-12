/* Diagnostic presentation and explicit result actions. Session state and network execution retain their existing owners. */
function toolsDiagnosticResultsHtml(){
  if(!toolsDiagnosticResult)return `<div class="card tools-status-card"><div class="tools-status-line"><span>Інтернет</span><strong>Перевірка не запускалась</strong></div><div class="tools-status-note" style="margin-top:6px;">Натисніть «Запустити діагностику».</div></div>`;
  const r=MTToolsCore.sanitizeDiagnosticResult(toolsDiagnosticResult);
  const internet=r.online&&r.internetStatus!=='offline'?'✅ Є':'❌ Немає';
  const speed=[[r.downloadMbps!==null?'Завантаження':null,r.downloadMbps!==null?`${r.downloadMbps} Мбіт/с`:null],[r.uploadMbps!==null?'Відвантаження':null,r.uploadMbps!==null?`${r.uploadMbps} Мбіт/с`:null]].filter(row=>row[0]);
  const actions=toolsDiagnosticContext?.ticketId||toolsDiagnosticContext?.editorContext
    ? `<button type="button" class="btn btn-accent" data-tools-action="save-diagnostics" style="flex:1;" ${toolsDiagnosticSaved?'disabled':''}>${toolsDiagnosticSaved?'✅ Збережено':'Зберегти в заявку'}</button>`
    : `<button type="button" class="btn" data-tools-action="attach-diagnostics" style="flex:1;">Прив'язати до адреси</button>`;
  return `<div class="card tools-status-card">
      <div class="tools-status-line"><span>Інтернет</span><strong>${internet}</strong></div>
      ${speed.map(row=>`<div class="tools-status-line"><span>${row[0]}</span><strong>${row[1]}</strong></div>`).join('')}
      ${speed.length?'':`<div class="tools-status-note" style="margin-top:6px;">Не вдалося виміряти швидкість</div>`}
      ${r.latencyMs!==null?`<div class="tools-status-note" style="margin-top:6px;">Відгук: ${r.latencyMs} мс</div>`:''}
    </div>
    <div class="row wrap"><button type="button" class="btn" data-tools-action="copy-diagnostics" style="flex:1;">📋 Скопіювати</button>${actions}</div>`;
}
function toolsSpeedTestHtml(){
  if(!toolsSpeedStatus&&!toolsSpeedController)return '';
  return `<div class="row wrap" style="margin-top:10px;align-items:center;gap:8px;"><span id="toolsSpeedStatus" class="tools-status-note">${escapeHtml(toolsSpeedStatus)}</span>${toolsSpeedController?'<button type="button" class="btn btn-sm" data-tools-action="cancel-speed-test">Скасувати</button>':''}</div>`;
}
function toolsDiagnosticsHtml(){
  return `${toolsBackButton()}${toolsContextHtml()}
    <button type="button" class="btn btn-accent btn-block" data-tools-action="run-diagnostics" id="toolsRunDiagnosticsBtn">▶ Запустити діагностику</button>
    <div id="toolsDiagnosticsResults" style="margin-top:12px;">${toolsDiagnosticResultsHtml()}</div>
    ${toolsSpeedTestHtml()}
    ${toolsReturnTab==='calculator'?'<button type="button" class="btn btn-accent btn-block" data-tools-action="return-to-ticket" style="margin-top:12px;">← Повернутися до заявки</button>':''}
    <div class="card" style="margin-top:12px;"><strong>Роутер</strong>
      <div class="tools-router-grid">${['192.168.0.1','192.168.1.1','192.168.100.1'].map(ip=>`<button type="button" class="btn" data-router-ip="${ip}">${ip}</button>`).join('')}</div>
      <div class="tools-status-note" style="margin-top:8px;">Натисніть адресу, щоб відкрити сторінку роутера.</div>
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
function toolsDiagnosticTicketResult(result){
  // У заявку йде лише короткий результат: інтернет, швидкість і відгук.
  // Ресурси перевірки, IP і службові деталі лишаються поза історією заявки.
  const r=MTToolsCore.sanitizeDiagnosticResult(result);
  return {online:r.online,internetStatus:r.internetStatus,summaryStatus:r.summaryStatus,latencyMs:r.latencyMs,downloadMbps:r.downloadMbps,uploadMbps:r.uploadMbps};
}
async function toolsSaveCurrentDiagnostic(){
  if(!toolsDiagnosticResult||toolsDiagnosticSaved)return;
  const ticketId=String(toolsDiagnosticContext?.ticketId||''),ticket=ticketId?tickets.find(item=>String(item.id)===ticketId):null;
  const draft=toolsDiagnosticContext?.editorContext?toolsCalculatorDraft:null;
  if(!ticket&&!draft?.state){showToast('Заявку для збереження не знайдено');return;}
  const record=MTToolsCore.makeDiagnosticRecord(toolsDiagnosticTicketResult(toolsDiagnosticResult),toolsDiagnosticContext,toolsDiagnosticRunAt||new Date());
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
