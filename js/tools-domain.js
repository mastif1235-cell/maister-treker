/* Field tools. Data stays local except explicit address-coordinate sync and explicit Telegram sharing. */
const MT_TOOLS_DIAGNOSTICS_KEY='mtSavedDiagnosticsV1';
const MT_TOOLS_NETWORK_POINTS_KEY='mtNetworkPointsV1';
const MT_TOOLS_DRAFT_KEY='mtToolsCalculatorDraftV1';
const MT_TOOLS_OFFLINE_BOUNDS_KEY='mtOfflineAreaBoundsV1';
const MT_TOOLS_OFFLINE_AREAS_KEY='mtOfflineAreasV1';
let toolsView='home';
let toolsDiagnosticContext=null;
let toolsDiagnosticResult=null;
let toolsDiagnosticRunAt=null;
let toolsDiagnosticSaved=false;
let toolsReturnTab='tools';
let toolsCalculatorDraft=null;
let toolsOfflinePendingBounds=null;
let toolsOfflineEditingAreaId='';
let toolsOfflineImportAreaId='';
let toolsLastUserLocation=null;
let toolsMapReturnContext=null;
let toolsSelectedNetworkPointId='';
let toolsConnectionCheck=null;
let toolsSpeedController=null;
let toolsSpeedStatus='';
let toolsOfflineReturnSettings=false;
let toolsMapFullscreen=false;
let toolsTicketLinkContext=null;
let toolsLinkCreationContext=null;
const toolsNetworkOpenCities=new Set();
const toolsNetworkOpenStreets=new Set();
const toolsNetworkTelegramSending=new Set();
let toolsDiagnostics=MTToolsCore.sanitizeDiagnostics(loadJSON(MT_TOOLS_DIAGNOSTICS_KEY,[]));
let toolsNetworkPoints=MTToolsCore.sanitizeNetworkPoints(loadJSON(MT_TOOLS_NETWORK_POINTS_KEY,[]));
function toolsLoadOfflineAreas(){
  let areas=MTToolsCore.sanitizeOfflineAreas(loadJSON(MT_TOOLS_OFFLINE_AREAS_KEY,[]));
  if(!areas.length){const legacy=loadJSON(MT_TOOLS_OFFLINE_BOUNDS_KEY,null),migrated=legacy&&MTToolsCore.normalizeOfflineArea({...legacy,name:'Робоча область'});if(migrated){areas=[migrated];toolsSaveLocal(MT_TOOLS_OFFLINE_AREAS_KEY,areas);}}
  return areas;
}
function toolsSaveOfflineAreas(value){return toolsSaveLocal(MT_TOOLS_OFFLINE_AREAS_KEY,MTToolsCore.sanitizeOfflineAreas(value));}

function toolsSaveLocal(key,value){
  try{localStorage.setItem(key,JSON.stringify(value));return true;}catch(_e){showToast('Не вдалося зберегти локальні дані');return false;}
}
function toolsSaveDiagnostics(){return toolsSaveLocal(MT_TOOLS_DIAGNOSTICS_KEY,toolsDiagnostics);}
function toolsSaveNetworkPoints(){return toolsSaveLocal(MT_TOOLS_NETWORK_POINTS_KEY,toolsNetworkPoints);}
function toolsExportData(){return{diagnostics:MTToolsCore.sanitizeDiagnostics(toolsDiagnostics),networkPoints:MTToolsCore.sanitizeNetworkPoints(toolsNetworkPoints)};}
function toolsRestoreData(data={}){
  if(Array.isArray(data.diagnostics)){
    toolsDiagnostics=MTToolsCore.sanitizeDiagnostics(data.diagnostics);
    if(!toolsSaveDiagnostics())throw new Error('TOOLS_DIAGNOSTICS_WRITE_FAILED');
  }
  if(Array.isArray(data.networkPoints)){
    toolsNetworkPoints=MTToolsCore.sanitizeNetworkPoints(data.networkPoints);
    if(!toolsSaveNetworkPoints())throw new Error('TOOLS_POINTS_WRITE_FAILED');
  }
  renderToolsScreen();
  return true;
}
function toolsPhotoOwnerRecords(){return toolsNetworkPoints.filter(point=>(point.photoKeys||[]).length||point.photoKey).map(point=>({photos:(point.photoKeys||[point.photoKey]).filter(Boolean)}));}

function toolsHomeHtml(){
  return `<div class="tools-grid">
    <button type="button" class="btn" data-tools-view="map"><span class="tools-icon">🗺️</span>Карта</button>
    <button type="button" class="btn" data-tools-action="quick-diagnostics"><span class="tools-icon">🛠</span>Діагностика</button>
  </div>
  <div class="card" style="margin-top:12px;font-size:12px;color:var(--text-dim);">Інструменти зберігають дані лише на цьому пристрої. Діагностика не створює записів без явного натискання «Зберегти».</div>`;
}
function toolsBackButton(){return appNavigationCanGoBack()?appBackButtonHtml(toolsView==='offline'&&toolsOfflineReturnSettings?'Налаштування':'Назад'):'';}
function toolsNavigate(view){
  const from=toolsView;if(from===view)return renderToolsScreen(view);
  appNavigationPush(`tools-${view}`,()=>{toolsView=from;switchTab('tools');renderToolsScreen(from);});toolsView=view;renderToolsScreen(view);
}
function toolsLeaveOfflineSettings(dropNavigation=true){if(toolsView!=='offline'&&!toolsOfflineReturnSettings)return;MTToolsMap?.destroyMap?.();toolsOfflineReturnSettings=false;toolsOfflinePendingBounds=null;toolsOfflineEditingAreaId='';toolsOfflineImportAreaId='';toolsView='home';if(dropNavigation)appNavigationDrop('tools-offline-settings');}
function openOfflineMapSettings(){toolsOfflineReturnSettings=true;appNavigationPush('tools-offline-settings',()=>{toolsLeaveOfflineSettings(false);switchTab('settings');});toolsView='offline';switchTab('tools');renderToolsScreen('offline');}
function toolsContextHtml(){
  return toolsDiagnosticContext?.address
    ? `<div class="card" style="font-size:13px;"><div class="row wrap" style="justify-content:space-between;align-items:center;"><strong>📍 ${escapeHtml(toolsDiagnosticContext.address)}</strong><button type="button" class="btn btn-sm" data-tools-action="reset-diagnostic-address">✕ Скинути адресу</button></div><div style="color:var(--text-dim);margin-top:3px;">Результат збережеться лише після вашого підтвердження.</div></div>`
    : `<div class="card" style="font-size:13px;color:var(--text-dim);">Швидка діагностика без адреси. За замовчуванням результат ніде не зберігається.</div>`;
}
function toolsDiagnosticResultsHtml(){
  if(!toolsDiagnosticResult)return `<div class="card" style="text-align:center;color:var(--text-dim);">Натисніть «Запустити». Перевірка не змінює заявки чи профілі.</div>`;
  const r=MTToolsCore.sanitizeDiagnosticResult(toolsDiagnosticResult);
  const summary=r.summaryStatus==='ok'?'✅ Основні перевірки успішні':r.summaryStatus==='offline'?'❌ Немає інтернет-з’єднання':'⚠ Є обмеження або часткова проблема';
  const resourceText=item=>item.ok?`✅ HTTP ${item.status||'—'} · ${item.httpMs??'—'} мс`:item.state==='timeout'?'⏳ Таймаут':item.state==='http'?`⚠ HTTP ${item.status||'помилка'}`:'⚠ Обмеження мережі/браузера';
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
function toolsSpeedTestHtml(){return `<div class="card" style="margin-top:12px;"><strong>Перевірка швидкості</strong><div id="toolsSpeedStatus" style="font-size:12px;color:var(--text-dim);margin:6px 0 9px;">${escapeHtml(toolsSpeedStatus||'Адаптивний HTTPS-тест, приблизно 8–15 с. Трафік залежить від швидкості, максимум близько 240 МБ.')}</div><div class="row wrap"><button type="button" class="btn btn-accent" data-tools-action="run-speed-test" ${toolsSpeedController?'disabled':''} style="flex:1;">⚡ ${toolsSpeedController?'Тест виконується…':'Запустити'}</button>${toolsSpeedController?'<button type="button" class="btn" data-tools-action="cancel-speed-test">Скасувати</button>':''}</div></div>`;}
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

function toolsConnectionStatsHtml(){
  const s=toolsConnectionCheck?.stats||{checked:0,ok:0,errors:0,blocked:0,current:null,total:0,min:null,max:null},avg=s.ok?Math.round(s.total/s.ok):null;
  return `<div class="tools-result-row"><span>Перевірено</span><strong>${s.checked}</strong></div><div class="tools-result-row"><span>Успішно / помилки / блоковано</span><strong>${s.ok} / ${s.errors} / ${s.blocked}</strong></div><div class="tools-result-row"><span>Затримка зараз / сер. / min / max</span><strong>${[s.current,avg,s.min,s.max].map(value=>value===null?'—':`${value} мс`).join(' / ')}</strong></div>`;
}
function toolsConnectionLogHtml(){return (toolsConnectionCheck?.log||[]).map(item=>`<div>${escapeHtml(item)}</div>`).join('')||'<div style="color:var(--text-faint);">Перевірка ще не запускалась.</div>';}
function toolsNormalizeConnectionTarget(value){
  const raw=String(value||'').trim();if(!raw)return{error:'Вкажіть хост або HTTPS URL'};
  const ipv4=/^(?:\d{1,3}\.){3}\d{1,3}$/.test(raw)&&raw.split('.').every(part=>Number(part)<=255),ipv6=raw.includes(':')&&/^[0-9a-f:[\].]+$/i.test(raw);if(ipv4||ipv6)return{kind:'ip',error:'Справжній ICMP ping до IP-адреси недоступний у браузерній PWA.'};
  try{const url=new URL(/^https:\/\//i.test(raw)?raw:`https://${raw}`);if(url.protocol!=='https:'||url.username||url.password)return{error:'Дозволено лише безпечний HTTPS URL без облікових даних'};return{kind:'https',url:url.href};}catch(_e){return{error:'Некоректний хост або HTTPS URL'};}
}
function toolsRenderConnectionCheck(){const stats=document.getElementById('toolsConnectionCheckStats'),log=document.getElementById('toolsConnectionCheckLog');if(stats)stats.innerHTML=toolsConnectionStatsHtml();if(log)log.innerHTML=toolsConnectionLogHtml();}
function toolsStopConnectionCheck(render=true){
  const state=toolsConnectionCheck;if(!state)return;if(state.timer)clearTimeout(state.timer);state.timer=null;state.controller?.abort();state.controller=null;state.active=false;if(render)toolsRenderConnectionCheck();
}
async function toolsConnectionCheckTick(){
  const state=toolsConnectionCheck;if(!state?.active)return;if(!document.getElementById('toolsConnectionCheckRoot')){toolsStopConnectionCheck(false);return;}
  if(navigator.onLine===false){state.stats.checked++;state.stats.errors++;state.log.unshift(`${new Date().toLocaleTimeString('uk-UA')} · OFFLINE`);state.log=state.log.slice(0,20);toolsRenderConnectionCheck();state.timer=setTimeout(toolsConnectionCheckTick,1000);return;}
  const started=performance.now(),controller=new AbortController();state.controller=controller;const timeout=setTimeout(()=>controller.abort(),5000);
  try{const response=await fetch(state.url,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});const ms=Math.max(0,Math.round(performance.now()-started));state.stats.checked++;state.stats.ok++;state.stats.current=ms;state.stats.total+=ms;state.stats.min=state.stats.min===null?ms:Math.min(state.stats.min,ms);state.stats.max=state.stats.max===null?ms:Math.max(state.stats.max,ms);state.log.unshift(`${new Date().toLocaleTimeString('uk-UA')} · HTTP ${response.status} · ${ms} мс`);}
  catch(error){state.stats.checked++;if(error?.name==='AbortError'){state.stats.errors++;state.log.unshift(`${new Date().toLocaleTimeString('uk-UA')} · TIMEOUT`);}else{state.stats.blocked++;state.log.unshift(`${new Date().toLocaleTimeString('uk-UA')} · Браузер не дозволяє перевірити цей хост напряму`);}}
  finally{clearTimeout(timeout);state.controller=null;state.log=state.log.slice(0,20);toolsRenderConnectionCheck();if(state.active)state.timer=setTimeout(toolsConnectionCheckTick,1000);}
}
function toolsStartConnectionCheck(){
  const parsed=toolsNormalizeConnectionTarget(document.getElementById('toolsConnectionTarget')?.value);if(parsed.error){showToast(parsed.error);return;}toolsStopConnectionCheck(false);toolsConnectionCheck={active:true,target:document.getElementById('toolsConnectionTarget').value.trim(),url:parsed.url,timer:null,controller:null,stats:{checked:0,ok:0,errors:0,blocked:0,current:null,total:0,min:null,max:null},log:[]};toolsRenderConnectionCheck();toolsConnectionCheckTick();
}

async function toolsTimedFetch(url,timeoutMs=5000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),started=performance.now();
  try{
    const response=await fetch(url,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
    return{ok:response.ok,status:response.status,httpMs:Math.max(0,Math.round(performance.now()-started)),response};
  }catch(_e){return{ok:false,status:0,httpMs:null,response:null};}
  finally{clearTimeout(timer);}
}
async function toolsFetchIp(url){
  const measured=await toolsTimedFetch(`${url}?format=json&_=${Date.now()}-${Math.random().toString(36).slice(2)}`,5000);
  if(!measured.ok)return{...measured,ip:''};
  try{const body=await measured.response.json();return{...measured,ip:String(body?.ip||'').slice(0,80)};}catch(_e){return{...measured,ok:false,ip:''};}
}
async function runToolsDiagnostics(){
  const button=document.getElementById('toolsRunDiagnosticsBtn');
  if(button){button.disabled=true;button.textContent='⏳ Перевіряю…';}
  const result=await MTToolsCore.runBrowserDiagnostics({fetch,timeoutMs:5000,now:()=>performance.now(),navigatorOnline:navigator.onLine});
  toolsDiagnosticResult=result;toolsDiagnosticRunAt=new Date();toolsDiagnosticSaved=false;
  renderToolsScreen('diagnostics');
}
async function toolsRunSpeedTest(){
  if(toolsSpeedController)return;toolsSpeedController=new AbortController();toolsSpeedStatus='Підготовка…';renderToolsScreen('diagnostics');
  const labels={prepare:'Підготовка…',latency:'Відгук…',download:'Завантаження…',upload:'Відвантаження…',processing:'Обробка результатів…'};
  try{
    const result=await MTToolsCore.runBrowserSpeedTest({fetch,signal:toolsSpeedController.signal,requestTimeoutMs:7000,totalTimeoutMs:20000,onProgress:stage=>{toolsSpeedStatus=labels[stage]||'Вимірювання…';const node=document.getElementById('toolsSpeedStatus');if(node)node.textContent=toolsSpeedStatus;}});
    toolsDiagnosticResult=result;toolsDiagnosticRunAt=new Date();toolsDiagnosticSaved=false;
    toolsSpeedStatus=result.speedStatus==='success'?'✅ Вимірювання завершено':result.speedStatus==='cancelled'?'Тест скасовано':'⚠ Частина вимірювань недоступна';
  }catch(_error){toolsSpeedStatus='Не вдалося виконати тест швидкості';}
  finally{toolsSpeedController=null;if(toolsView==='diagnostics')renderToolsScreen('diagnostics');}
  if(toolsView==='diagnostics'&&toolsDiagnosticResult?.speedStatus!=='cancelled'&&(toolsDiagnosticContext?.ticketId||toolsDiagnosticContext?.editorContext))await toolsSaveCurrentDiagnostic();
}
function toolsCancelSpeedTest(){toolsSpeedController?.abort();toolsSpeedStatus='Тест скасовується…';const node=document.getElementById('toolsSpeedStatus');if(node)node.textContent=toolsSpeedStatus;}
function toolsClearDiagnosticAddress(){toolsDiagnosticContext=null;toolsDiagnosticSaved=false;}
function toolsResumeTicketAddressInputs(){['f_city','f_street','f_house','f_apartment'].forEach(id=>{const input=document.getElementById(id);if(input)input.disabled=false;});}
function toolsSuspendTicketAddressInputs(){['f_city','f_street','f_house','f_apartment'].forEach(id=>{const input=document.getElementById(id);if(input){input.value='';input.disabled=true;}});}
function toolsLeaveDiagnostics(){if(toolsView!=='diagnostics')return;toolsStopConnectionCheck(false);toolsCancelSpeedTest();toolsResumeTicketAddressInputs();toolsClearDiagnosticAddress();toolsView='home';}
function toolsResetDiagnosticAddress(){toolsClearDiagnosticAddress();renderToolsScreen('diagnostics');}
function toolsOpenDiagnostics(context=null,returnTab='tools'){
  if(returnTab==='tools')appNavigationPush('tools-diagnostics',()=>{toolsLeaveDiagnostics();switchTab('tools');renderToolsScreen('home');});
  else if(returnTab==='calculator')appNavigationPush('tools-diagnostics',toolsReturnToTicket);
  else if(returnTab==='tickets')appNavigationPush('tools-diagnostics',()=>{toolsLeaveDiagnostics();switchTab('tickets');renderAddressNav();});
  toolsDiagnosticContext=context;toolsDiagnosticResult=null;toolsDiagnosticRunAt=null;toolsDiagnosticSaved=false;toolsSpeedStatus='';toolsReturnTab=returnTab;toolsView='diagnostics';
  switchTab('tools');renderToolsScreen('diagnostics');
}
function openToolsDiagnosticsFromCalculator(){
  syncFormToState();
  if(!calcState.city||!calcState.street){showToast('Спочатку вкажіть місто та вулицю');return;}
  document.activeElement?.blur?.();
  toolsCalculatorDraft={state:JSON.parse(JSON.stringify(calcState)),editingTicketId,originalPhotoKeys:(calcOriginalPhotoKeys||[]).slice()};
  try{localStorage.setItem(MT_TOOLS_DRAFT_KEY,JSON.stringify(toolsCalculatorDraft));}catch(_e){}
  toolsSuspendTicketAddressInputs();
  const context={id:MTToolsCore.profileId(calcState),...MTToolsCore.profileParts(calcState),address:MTToolsCore.addressLabel(calcState),ticketId:editingTicketId||'',editorContext:true};
  toolsOpenDiagnostics(context,'calculator');
}
function toolsReturnToTicket(){
  toolsLeaveDiagnostics();
  let draft=toolsCalculatorDraft;try{draft=draft||JSON.parse(localStorage.getItem(MT_TOOLS_DRAFT_KEY)||'null');}catch(_e){}
  if(!draft?.state){showToast('Чернетку заявки не знайдено');return;}
  calcState=JSON.parse(JSON.stringify(draft.state));editingTicketId=draft.editingTicketId??null;calcOriginalPhotoKeys=Array.isArray(draft.originalPhotoKeys)?draft.originalPhotoKeys.slice():[];
  fillFormFromState();document.getElementById('saveTicketBtn').textContent=editingTicketId?'Оновити заявку':'Зберегти заявку';document.getElementById('cancelEditBtn').classList.toggle('hidden',!editingTicketId);
  switchTab('calculator');showToast('Чернетку заявки відновлено');
}
function toolsClearCalculatorDraft(){toolsCalculatorDraft=null;try{localStorage.removeItem(MT_TOOLS_DRAFT_KEY);}catch(_e){}}
function openToolsDiagnosticsFromProfile(ids=[]){
  const list=tickets.filter(ticket=>ids.some(id=>String(id)===String(ticket.id)));
  if(!list.length){showToast('Профіль не знайдено');return;}
  toolsOpenDiagnostics({...MTToolsCore.profileFromTickets(list),ticketId:String(list[0].id)},'tickets');
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

function toolsMapHtml(){
  const objects=MTToolsCore.mapObjects(tickets,toolsNetworkPoints);
  const offline=MTOfflineMap?.readMeta?.();
  const mode=MTOfflineMap?.getMode?.()||'auto';
  const filters=MTToolsCore.MAP_CATEGORIES.map(category=>{
    const meta=MTToolsMap.CATEGORY_META[category];
    return `<button type="button" class="tools-map-filter active" data-map-filter="${escapeHtml(category)}" aria-pressed="true">${meta.icon} ${escapeHtml(meta.label)}</button>`;
  }).join('');
  return `${toolsBackButton()}
    <div id="toolsMapStatus" class="tools-map-status hidden" role="status"></div>
    <div class="tools-map-shell ${toolsMapFullscreen?'tools-map-fullscreen':''}"><div class="tools-map" id="toolsLeafletMap" aria-label="Інтерактивна карта об’єктів"></div><div class="tools-map-service-controls" aria-label="Дії карти"><button type="button" class="tools-map-floating-btn" data-tools-action="map-my-location" aria-label="Моє місце" title="Моє місце">🎯</button><button type="button" class="tools-map-floating-btn" data-tools-action="map-add-object" aria-label="Додати об’єкт" title="Додати об’єкт">＋</button></div><div class="tools-map-fullscreen-control"><button type="button" class="tools-map-floating-btn" data-tools-action="map-toggle-fullscreen" aria-label="${toolsMapFullscreen?'Вийти з повноекранної карти':'Відкрити карту на весь екран'}" title="${toolsMapFullscreen?'Вийти':'На весь екран'}">${toolsMapFullscreen?'✕':'⛶'}</button></div><div id="toolsMapEmptyState" class="tools-map-empty hidden"><strong>Офлайн-підкладка для цієї області не встановлена.</strong><div>Маркери доступні без підкладки. Керування офлайн-картою знаходиться в Налаштуваннях.</div></div></div>
    <div class="tools-map-filters" id="toolsMapFilters" aria-label="Фільтри об’єктів карти"><button type="button" class="tools-map-filter active" data-map-filter="all" aria-pressed="true">Усі</button><button type="button" class="tools-map-filter" data-map-filter="none" aria-pressed="false">Зняти всі</button>${filters}</div>
    ${objects.length?'':'<div class="card" style="font-size:12px;color:var(--text-dim);">Немає об’єктів із координатами. Додайте геолокацію до профілю або створіть точку мережі.</div>'}
    <div class="card tools-network-groups-card"><div class="row between wrap"><strong>Об’єкти мережі</strong><span class="tools-offline-map-meta">${toolsNetworkPoints.length}</span></div><div class="field" style="margin-top:8px;"><label>Пошук об’єктів</label><input type="search" role="searchbox" name="mt-internal-network-search" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" inputmode="search" id="toolsNetworkSearch" value="${escapeHtml(toolsNetworkSearch)}" placeholder="ID, тип, місто, вулиця, будинок, примітка"></div><div id="toolsNetworkGroups">${toolsNetworkGroupsHtml()}</div></div>
    <div class="row wrap tools-map-actions"><button type="button" class="btn" data-tools-action="map-bind-address" style="flex:1 0 100%;">📍 Прив’язати існуючу адресу</button></div>
    <div class="tools-offline-map-meta" style="margin:-2px 0 9px;">${offline?`✅ Офлайн-карта встановлена · ${escapeHtml(MTOfflineMap.formatBytes(offline.size))} · режим ${escapeHtml(mode)}`:'Офлайн-карта не встановлена'}</div>
    <details class="tools-map-info"><summary>ⓘ Про карту</summary><div>Звичайна підкладка: OpenStreetMap. Супутникова: MapTiler із власним ключем користувача. Постачальник плиток отримує лише координати видимої ділянки — без ПІБ, телефонів, адресного тексту, MAC, нотаток, фото чи історії.</div></details>`;
}
function toolsNetworkGroupsHtml(){
  const query=String(toolsNetworkSearch||'').trim(),groups=MTToolsCore.groupNetworkPoints(toolsNetworkPoints,query);if(!groups.length)return '<div class="tools-network-empty">Нічого не знайдено.</div>';
  return groups.map(cityGroup=>{const cityKey=cityGroup.city,cityOpen=!!query||toolsNetworkOpenCities.has(cityKey),streets=cityGroup.streets.map(streetGroup=>{const streetKey=`${cityKey}\u0000${streetGroup.street}`,streetOpen=!!query||toolsNetworkOpenStreets.has(streetKey),items=streetGroup.points.map(point=>`<button type="button" class="tools-network-object ${String(point.id)===String(toolsSelectedNetworkPointId)?'selected':''}" data-point-id="${escapeHtml(point.id)}"><span><strong>${escapeHtml(point.name||point.type||'Без назви')}</strong><small>${escapeHtml([point.type,point.house,point.note].filter(Boolean).join(' · '))}</small></span><span>›</span></button>`).join('');return `<details class="tools-network-street" data-network-street="${escapeHtml(streetKey)}" ${streetOpen?'open':''}><summary>${escapeHtml(streetGroup.street)} <span>${streetGroup.count}</span></summary>${items}</details>`;}).join('');return `<details class="tools-network-city" data-network-city="${escapeHtml(cityKey)}" ${cityOpen?'open':''}><summary>${escapeHtml(cityGroup.city)} <span>${cityGroup.count}</span></summary>${streets}</details>`;}).join('');
}
function toolsOpenPointEditorFromMap(point,placement){
  toolsOpenNetworkPointEditor('',{type:'FOB',...point},{placement,returnView:'map',returnToLinking:!!toolsLinkCreationContext});
}
function toolsStartMapAddMode(point=null){
  const status=document.getElementById('toolsMapStatus');
  if(status){status.textContent=point?'Перетягніть робочий маркер за потреби.':'Натисніть місце на карті для нового об’єкта.';status.classList.remove('hidden');}
  const placement=MTToolsMap.startPointPlacement({initial:point,onPlace:toolsOpenPointEditorFromMap});
  if(!placement)showToast('Карта ще не готова');else if(!point)showToast('Торкніться карти, щоб додати об’єкт');
}
async function toolsLocateOnMap(){
  showToast('Визначаю ваше місце…');
  try{const point=await MTToolsCore.requestCurrentPosition(navigator.geolocation);toolsLastUserLocation=point;MTToolsMap.showUserLocation(point,point.accuracy);showToast(`Ваше місце${point.accuracy?` · точність ≈ ${Math.round(point.accuracy)} м`:''}`);}
  catch(error){const code=Number(error?.code);showToast(code===1?'Доступ до геолокації заборонено':code===3?'Час очікування GPS вичерпано':'Геолокація недоступна');}
}
function toolsToggleMapFullscreen(){
  toolsMapFullscreen=!toolsMapFullscreen;
  document.body.classList.toggle('tools-map-fullscreen-open',toolsMapFullscreen);
  const shell=document.querySelector('.tools-map-shell'),button=document.querySelector('[data-tools-action="map-toggle-fullscreen"]');
  shell?.classList.toggle('tools-map-fullscreen',toolsMapFullscreen);
  if(button){button.textContent=toolsMapFullscreen?'✕':'⛶';button.title=toolsMapFullscreen?'Вийти':'На весь екран';button.setAttribute('aria-label',toolsMapFullscreen?'Вийти з повноекранної карти':'Відкрити карту на весь екран');}
  MTToolsMap.invalidateSize?.();
}
function toolsBindAddressFromMap(){
  const profiles=MTToolsCore.listProfiles(tickets);if(!profiles.length){showToast('Немає існуючих адрес для прив’язки');return;}
  openModal('Прив’язати існуючу адресу',`<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">Виберіть існуючий профіль. Координати не зміняться, доки ви явно не натиснете «Зберегти координати».</div><div class="field"><input type="search" role="searchbox" name="mt-internal-map-profile-search" inputmode="search" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" id="toolsAddressSearch" placeholder="Місто, вулиця, будинок, квартира або повна адреса"></div><div id="toolsAddressChoices" style="max-height:55vh;overflow:auto;"></div>`,{onOpen:root=>{
    const choices=document.getElementById('toolsAddressChoices'),input=document.getElementById('toolsAddressSearch');
    const render=query=>{const needle=String(query||'').trim().toLocaleLowerCase('uk'),matches=profiles.filter(profile=>!needle||[profile.city,profile.street,profile.house,profile.apartment,profile.address].some(value=>String(value||'').toLocaleLowerCase('uk').includes(needle))).slice(0,100);choices.innerHTML=matches.map(profile=>`<button type="button" class="btn btn-block tools-address-choice" data-profile-id="${escapeHtml(profile.id)}" style="margin-bottom:7px;text-align:left;">${escapeHtml(profile.address)}</button>`).join('')||'<div class="card">Нічого не знайдено.</div>';};
    render('');input.addEventListener('input',()=>render(input.value));root.onclick=event=>{const button=event.target.closest('.tools-address-choice');if(!button)return;const profile=profiles.find(item=>item.id===button.dataset.profileId);if(!profile)return;closeModal();toolsOpenAddressBindingPicker(profile);};
  }});
}
function toolsOpenAddressBindingPicker(profile){
  const list=tickets.filter(ticket=>MTToolsCore.profileId(ticket)===profile.id),source=list.find(ticket=>MTToolsCore.parseCoordinates(`${ticket.geoLat??''},${ticket.geoLng??''}`)||MTToolsCore.parseCoordinates(ticket.geoLink)),initial=source&&(MTToolsCore.parseCoordinates(`${source.geoLat??''},${source.geoLng??''}`)||MTToolsCore.parseCoordinates(source.geoLink));let picker=null;
  openModal('Вкажіть точку на карті',`<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">${escapeHtml(profile.address)}. Натисніть карту або перетягніть маркер. GPS використовується лише після окремого натискання.</div><div id="toolsAddressPickerStatus" class="tools-map-status hidden"></div><div id="toolsAddressPicker" class="tools-map tools-map-picker"></div><div class="row wrap" style="margin-top:8px;"><button type="button" class="btn" id="toolsAddressPickerGps" style="flex:1;">🎯 Моє місце</button><button type="button" class="btn btn-accent" id="toolsAddressPickerSave" style="flex:1;">Зберегти координати</button><button type="button" class="btn" id="toolsAddressPickerCancel">Скасувати</button></div>`,{onClose:()=>MTToolsMap.destroyPicker(),onOpen:()=>{
    picker=MTToolsMap.mountPicker(document.getElementById('toolsAddressPicker'),{initial,statusNode:document.getElementById('toolsAddressPickerStatus')});
    document.getElementById('toolsAddressPickerCancel').onclick=closeModal;
    document.getElementById('toolsAddressPickerGps').onclick=async()=>{try{const point=await MTToolsCore.requestCurrentPosition(navigator.geolocation);picker?.setPoint(point);showToast(point.accuracy?`Точність GPS ≈ ${Math.round(point.accuracy)} м`:'Точку GPS визначено');}catch(_error){showToast('Не вдалося отримати геолокацію');}};
    document.getElementById('toolsAddressPickerSave').onclick=async()=>{const point=picker?.getPoint();if(!point){showToast('Вкажіть точку на карті');return;}list.forEach(ticket=>{ticket.geoLat=Number(point.lat.toFixed(6));ticket.geoLng=Number(point.lng.toFixed(6));});await saveTickets();closeModal();renderToolsScreen('map');showToast('✅ Координати адреси збережено');};
  }});
}
function toolsBoundsLabel(header={}){
  return `${Number(header.minLat).toFixed(4)}, ${Number(header.minLon).toFixed(4)} → ${Number(header.maxLat).toFixed(4)}, ${Number(header.maxLon).toFixed(4)}`;
}
async function toolsPrepareOfflineMap(file,areaId=toolsOfflineImportAreaId){
  if(!file)return;
  const fileName=String(file.name||'').toLowerCase();
  if(fileName.endsWith('.json')){
    let isAreaParameters=false;
    try{if(file.size<=1024*1024){const parsed=JSON.parse(await file.text());isAreaParameters=parsed?.format==='master-tracker-offline-area-v1';}}catch(_e){}
    showToast(isAreaParameters?'Це файл параметрів області, а не офлайн-карта.\nДля офлайн-підкладки потрібен файл .pmtiles.':'Потрібен файл офлайн-карти у форматі .pmtiles.');return;
  }
  if(!fileName.endsWith('.pmtiles')){showToast('Потрібен файл офлайн-карти у форматі .pmtiles.');return;}
  if(!MTOfflineMap?.supported?.()){showToast('Цей браузер не підтримує локальне сховище офлайн-карти');return;}
  showToast('Перевіряю PMTiles…');
  try{
    const [info,quota]=await Promise.all([MTOfflineMap.inspectFile(file),MTOfflineMap.quotaFor(file.size)]),area=toolsLoadOfflineAreas().find(item=>item.id===areaId),overlap=area?MTToolsCore.offlineBoundsOverlap(area,info.header):null;
    if(quota.enough===false){showToast('Недостатньо вільного місця для цієї карти');return;}
    const quotaText=quota.available===null?'Доступний обсяг браузер не повідомив.':`Орієнтовно вільно: ${MTOfflineMap.formatBytes(quota.available)}.`;
    const matchText=area?(overlap>=.65?`✅ Файл відповідає області «${escapeHtml(area.name)}».`:`⚠️ Межі файла помітно відрізняються від області «${escapeHtml(area.name)}» (${Math.round(overlap*100)}% покриття). Імпорт дозволений, але перевірте територію.`):'Файл буде встановлено як активна офлайн-підкладка без прив’язки до збереженої області.';
    openModal('Офлайн-карта',`<div class="card" style="font-size:13px;line-height:1.55;"><strong>${escapeHtml(info.fileName)}</strong><br>Розмір: ${escapeHtml(MTOfflineMap.formatBytes(info.size))}<br>Територія: ${escapeHtml(toolsBoundsLabel(info.header))}<br>Масштаби: Z${info.header.minZoom}–Z${info.header.maxZoom}<br><span style="color:var(--text-dim);">${escapeHtml(quotaText)}</span><div class="tools-map-status" style="margin-top:8px;">${matchText}</div></div><div class="row" style="margin-top:10px;"><button type="button" class="btn btn-accent" id="toolsOfflineMapConfirmBtn" style="flex:1;">Встановити офлайн-карту</button><button type="button" class="btn" id="toolsOfflineMapCancelBtn">Скасувати</button></div>`,{onOpen:()=>{
      document.getElementById('toolsOfflineMapCancelBtn').onclick=closeModal;
      document.getElementById('toolsOfflineMapConfirmBtn').onclick=async event=>{
        const button=event.currentTarget;button.disabled=true;button.textContent='Зберігаю…';
        try{await MTOfflineMap.install(file,info,{areaId:area?.id||''});toolsOfflineImportAreaId='';closeModal();renderToolsScreen('offline');showToast('✅ Офлайн-карту встановлено');}
        catch(_e){button.disabled=false;button.textContent='Спробувати ще';showToast('Не вдалося зберегти карту. Попередню карту не змінено');}
      };
    }});
  }catch(error){
    const message=String(error?.message||'');
    showToast(message==='PMTILES_TILE_TYPE_UNSUPPORTED'?'Цей тип плиток PMTiles не підтримується. Потрібен vector MVT або raster PMTiles v3.':'Потрібен коректний файл офлайн-карти PMTiles v3.');
  }
}
async function toolsDeleteOfflineMap(){
  if(!confirm('Видалити лише офлайн-карту? Заявки, точки, фото й налаштування залишаться.'))return;
  const ok=await MTOfflineMap.remove();
  if(ok){renderToolsScreen(toolsView==='offline'?'offline':'map');showToast('Офлайн-карту видалено');}else showToast('Не вдалося видалити офлайн-карту');
}
function toolsOfflineSelectionHtml(value){
  if(!value)return '<div style="font-size:12px;color:var(--text-dim);">Область ще не вибрана.</div>';
  const estimate=MTToolsCore.estimateOfflineArea(value,value.minZoom||10,value.maxZoom||16),large=(estimate?.bytes||0)>500*1024*1024;
  const editing=toolsLoadOfflineAreas().find(item=>item.id===toolsOfflineEditingAreaId);
  return `<div class="card" style="margin-top:10px;"><strong>${editing?'Змінити область':'Нова область'}</strong><div class="field" style="margin-top:8px;"><label>Назва регіону</label><input id="toolsOfflineAreaName" value="${escapeHtml(value.name||editing?.name||'')}" placeholder="Наприклад: Дніпро"></div><div class="tools-offline-map-meta">Область вибрана ✅ · Zoom ${value.minZoom}–${value.maxZoom}</div>${large?'<div class="tools-map-status" style="margin-top:8px;">⚠️ Область може займати понад 500 МБ. Зменште її або максимальний zoom.</div>':''}<details class="tools-offline-more"><summary>Технічна інформація</summary><div class="tools-offline-map-meta">BBox: ${escapeHtml(toolsBoundsLabel({minLat:value.minLat,minLon:value.minLng,maxLat:value.maxLat,maxLon:value.maxLng}))}<br>Орієнтовно ${estimate?.tiles||0} плиток / ${escapeHtml(MTOfflineMap.formatBytes(estimate?.bytes||0))}</div></details><button type="button" class="btn btn-accent btn-block" data-tools-action="save-offline-area" style="margin-top:9px;">Зберегти область</button></div>`;
}
function toolsOpenOfflineMapGuide(areaId=''){
  const area=toolsLoadOfflineAreas().find(item=>item.id===areaId),areaDetails=area?`<div class="tools-map-status" style="margin-top:9px;"><strong>${escapeHtml(area.name)}</strong><br>BBox: ${escapeHtml(`${area.minLng},${area.minLat},${area.maxLng},${area.maxLat}`)}<br>Zoom: Z${area.minZoom}–Z${area.maxZoom}</div>`:'';
  openModal('Як отримати файл .pmtiles?',`<div class="card" style="font-size:13px;line-height:1.55;"><strong>1. Межі — не карта</strong><br>JSON містить лише назву, координати меж і zoom. Він не містить плиток і не перетворюється на карту.<br><br><strong>2. Підготуйте файл окремо</strong><br>Потрібен готовий <strong>PMTiles v3</strong> із vector MVT або raster-плитками з власного чи ліцензованого джерела. Офіційний PMTiles CLI може вирізати область лише з уже наявного сумісного PMTiles-архіву.<br><br><strong>3. Імпортуйте файл</strong><br>Застосунок перевірить формат, межі й доступне місце, а потім збереже карту локально на цьому пристрої.${areaDetails}</div><div class="tools-map-status" style="margin-top:10px;">Застосунок не завантажує плитки масово з OpenStreetMap або MapTiler і не надсилає ключ MapTiler у файл області.</div><a class="btn btn-block" style="margin-top:10px;text-decoration:none;text-align:center;" href="https://docs.protomaps.com/pmtiles/cli" target="_blank" rel="noopener noreferrer">Офіційна документація PMTiles CLI</a><div class="row wrap" style="margin-top:10px;"><button type="button" class="btn btn-accent" id="toolsOfflineGuideImportBtn" style="flex:1;">Вибрати готовий .pmtiles</button>${area?'<button type="button" class="btn" id="toolsOfflineGuideExportBtn">Зберегти межі (.json)</button>':''}<button type="button" class="btn" id="toolsOfflineGuideCloseBtn">Закрити</button></div>`,{onOpen:()=>{
    document.getElementById('toolsOfflineGuideCloseBtn').onclick=closeModal;
    document.getElementById('toolsOfflineGuideImportBtn').onclick=()=>{closeModal();toolsImportOfflineArea(area?.id||'');};
    const exportButton=document.getElementById('toolsOfflineGuideExportBtn');if(exportButton)exportButton.onclick=()=>{closeModal();toolsExportOfflineArea(area.id);};
  }});
}
function toolsOfflineAreasHtml(areas=[]){
  const installed=MTOfflineMap.readMeta?.();if(!areas.length)return `<div class="card"><strong>${installed?'✅ Офлайн-карта встановлена':'Офлайн-карта не встановлена'}</strong><div style="font-size:12px;color:var(--text-dim);margin-top:6px;">Збережених областей ще немає.</div></div>`;
  return `<div class="card"><div>${areas.map((area,index)=>{const linked=installed?.areaId===area.id;return `<div class="tools-offline-area-row"><div><strong>${index+1}. ${escapeHtml(area.name)}</strong><div class="tools-offline-map-meta">${linked?`✅ Офлайн-карта встановлена · ${escapeHtml(MTOfflineMap.formatBytes(installed.size))} · Zoom ${installed.header.minZoom}–${installed.header.maxZoom}`:'Карта не встановлена'}</div></div>${linked?`<div class="row wrap tools-offline-primary-actions"><button type="button" class="btn btn-sm" data-tools-action="open-offline-map">Відкрити</button><button type="button" class="btn btn-sm" data-tools-action="import-offline-area" data-area-id="${escapeHtml(area.id)}">Замінити</button><button type="button" class="btn btn-sm btn-danger" data-tools-action="delete-offline-map">Видалити</button></div>`:`<button type="button" class="btn btn-accent btn-block tools-offline-install" data-tools-action="import-offline-area" data-area-id="${escapeHtml(area.id)}">Вибрати файл .pmtiles і встановити</button>`}<details class="tools-offline-more"><summary>Технічна інформація</summary><div class="tools-offline-map-meta">BBox: ${escapeHtml(toolsBoundsLabel({minLat:area.minLat,minLon:area.minLng,maxLat:area.maxLat,maxLon:area.maxLng}))}<br>Zoom ${area.minZoom}–${area.maxZoom}</div><div class="row wrap"><button type="button" class="btn btn-sm" data-tools-action="show-offline-area" data-area-id="${escapeHtml(area.id)}">Показати межі</button><button type="button" class="btn btn-sm" data-tools-action="edit-offline-area" data-area-id="${escapeHtml(area.id)}">Змінити межі</button><button type="button" class="btn btn-sm" data-tools-action="offline-map-guide" data-area-id="${escapeHtml(area.id)}">Про формат PMTiles</button><button type="button" class="btn btn-sm" data-tools-action="export-offline-area" data-area-id="${escapeHtml(area.id)}">Зберегти параметри (.json)</button><button type="button" class="btn btn-sm btn-danger" data-tools-action="delete-offline-area" data-area-id="${escapeHtml(area.id)}">Видалити область</button></div></details></div>`;}).join('')}</div></div>`;
}
function toolsOfflineHtml(){
  const areas=toolsLoadOfflineAreas(),shown=toolsOfflinePendingBounds,installed=MTOfflineMap.readMeta?.(),mode=MTOfflineMap.getMode?.()||'auto';
  return `${toolsBackButton()}<input type="file" id="toolsOfflineMapFile" accept=".pmtiles,application/octet-stream,.json,application/json" class="hidden"><div class="card"><div class="row between wrap"><strong>Офлайн-карта</strong><select id="toolsMapBaseMode" class="tools-map-mode" aria-label="Режим підкладки"><option value="auto" ${mode==='auto'?'selected':''}>Авто</option><option value="online" ${mode==='online'?'selected':''}>Онлайн</option><option value="offline" ${mode==='offline'?'selected':''}>Офлайн</option></select></div>${!areas.length?`<div class="tools-offline-map-meta" style="margin-top:7px;">${installed?'✅ Офлайн-карта встановлена':'Спочатку додайте область'}</div>`:''}</div>${toolsOfflineAreasHtml(areas)}
    <div class="card"><strong>Додати область</strong><div style="font-size:12px;color:var(--text-dim);margin:6px 0;">Вкажіть zoom, натисніть «Вибрати область» і поставте дві протилежні точки прямокутника.</div><div class="field-row"><div class="field"><label>Мін. zoom</label><input id="toolsOfflineMinZoom" type="number" min="0" max="22" value="${shown?.minZoom||10}"></div><div class="field"><label>Макс. zoom</label><input id="toolsOfflineMaxZoom" type="number" min="0" max="22" value="${shown?.maxZoom||16}"></div></div><button type="button" class="btn btn-accent btn-block" data-tools-action="select-offline-bounds">▱ Вибрати область</button><div id="toolsOfflineSelection">${toolsOfflineSelectionHtml(shown)}</div></div>
    <div id="toolsOfflineSelectStatus" class="tools-map-status hidden"></div><div id="toolsOfflineSelectMap" class="tools-map"></div>`;
}
function toolsStartOfflineBoundsSelection(){
  const minZoom=Number(document.getElementById('toolsOfflineMinZoom')?.value||10),maxZoom=Number(document.getElementById('toolsOfflineMaxZoom')?.value||16),status=document.getElementById('toolsOfflineSelectStatus');
  if(status){status.textContent='Натисніть дві протилежні точки прямокутника.';status.classList.remove('hidden');}
  MTToolsMap.selectBounds(bounds=>{toolsOfflinePendingBounds={...bounds,minZoom,maxZoom};const selection=document.getElementById('toolsOfflineSelection');if(selection)selection.innerHTML=toolsOfflineSelectionHtml(toolsOfflinePendingBounds,false);if(status)status.textContent='Прямокутник вибрано. Перевірте розмір і натисніть «Зберегти вибір області».';});
}
function toolsSaveOfflineArea(){
  if(!toolsOfflinePendingBounds){showToast('Спочатку виберіть область');return;}const name=document.getElementById('toolsOfflineAreaName')?.value.trim();if(!name){showToast('Вкажіть назву області');return;}
  const areas=toolsLoadOfflineAreas(),at=areas.findIndex(item=>item.id===toolsOfflineEditingAreaId),base=at>=0?areas[at]:{},area=MTToolsCore.normalizeOfflineArea({...base,...toolsOfflinePendingBounds,name});
  const finish=next=>{if(toolsSaveOfflineAreas(next)){toolsOfflinePendingBounds=null;toolsOfflineEditingAreaId='';closeModal();renderToolsScreen('offline');showToast('✅ Область збережена');}};
  if(at>=0){areas[at]=area;finish(areas);return;}
  const duplicateAt=areas.findIndex(item=>MTToolsCore.offlineAreaDuplicate(item,area));if(duplicateAt<0){areas.push(area);finish(areas);return;}
  const duplicate=areas[duplicateAt];openModal('Схожа область вже існує',`<div class="card">«${escapeHtml(duplicate.name)}» має таку саму назву або майже ті самі межі.</div><div class="row wrap" style="margin-top:10px;"><button type="button" class="btn btn-accent" id="toolsOfflineDuplicateReplace">Замінити існуючу</button><button type="button" class="btn" id="toolsOfflineDuplicateNew">Зберегти як нову</button><button type="button" class="btn" id="toolsOfflineDuplicateCancel">Скасувати</button></div>`,{onOpen:()=>{
    document.getElementById('toolsOfflineDuplicateReplace').onclick=()=>{areas[duplicateAt]=MTToolsCore.normalizeOfflineArea({...duplicate,...toolsOfflinePendingBounds,name,id:duplicate.id,createdAt:duplicate.createdAt});finish(areas);};
    document.getElementById('toolsOfflineDuplicateNew').onclick=()=>{areas.push(area);finish(areas);};
    document.getElementById('toolsOfflineDuplicateCancel').onclick=closeModal;
  }});
}
function toolsEditOfflineArea(id){const area=toolsLoadOfflineAreas().find(item=>item.id===id);if(!area)return;toolsOfflineEditingAreaId=id;toolsOfflinePendingBounds={...area};renderToolsScreen('offline');}
function toolsDeleteOfflineArea(id){const areas=toolsLoadOfflineAreas(),area=areas.find(item=>item.id===id);if(!area||!confirm(`Видалити лише область «${area.name}»? Встановлений PMTiles та інші дані залишаться.`))return;toolsSaveOfflineAreas(areas.filter(item=>item.id!==id));if(toolsOfflineEditingAreaId===id){toolsOfflineEditingAreaId='';toolsOfflinePendingBounds=null;}renderToolsScreen('offline');showToast('Область видалено. Дані та PMTiles не змінено');}
function toolsShowOfflineArea(id){const area=toolsLoadOfflineAreas().find(item=>item.id===id);if(!area)return;MTToolsMap.drawBounds(area);document.getElementById('toolsOfflineSelectMap')?.scrollIntoView({behavior:'smooth',block:'center'});}
function toolsOpenOfflineMap(){MTOfflineMap.setMode('offline');toolsNavigate('map');}
function toolsImportOfflineArea(id){toolsOfflineImportAreaId=id;document.getElementById('toolsOfflineMapFile')?.click();}
function toolsExportOfflineArea(id){
  const area=toolsLoadOfflineAreas().find(item=>item.id===id);if(!area)return;
  const payload={format:'master-tracker-offline-area-v1',name:area.name,bounds:{minLat:area.minLat,minLng:area.minLng,maxLat:area.maxLat,maxLng:area.maxLng},zoom:{min:area.minZoom,max:area.maxZoom}};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`master-tracker-area-${String(area.name||'area').replace(/[^a-zа-яіїє0-9_-]+/gi,'-').replace(/^-|-$/g,'')||'area'}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),0);showToast('Параметри області експортовано. Це не файл карти.');
}
function toolsOpenProfileById(profileId){
  const profile=MTToolsCore.listProfiles(tickets).find(item=>item.id===profileId);
  if(!profile){showToast('Профіль не знайдено');return;}
  toolsMapReturnContext={profileId};appNavigationPush('map-profile',()=>{toolsMapReturnContext=null;closeModal();toolsView='map';switchTab('tools');renderToolsScreen('map');});
  addrNavState={level:'tickets',city:profile.city,street:profile.street,house:profile.house||'(без номера)',apartment:profile.apartment||'(без кв.)'};
  addrNavSearchQuery='';switchTab('tickets');renderAddressNav();
}
function toolsMapReturnButtonHtml(){return toolsMapReturnContext?appBackButtonHtml('Назад до карти'):'';}
function toolsClearMapReturnContext(){toolsMapReturnContext=null;}
function toolsReturnFromProfileToMap(){if(!appNavigationBack()){closeModal();toolsMapReturnContext=null;toolsView='map';switchTab('tools');renderToolsScreen('map');}}
function toolsOpenMapObject(item){
  if(!item)return;
  if(item.kind==='network'){toolsSelectedNetworkPointId=String(item.id);toolsHighlightNetworkPointInList(item.id);appNavigationPush('map-network-point',()=>{closeModal();toolsView='map';switchTab('tools');renderToolsScreen('map');});toolsShowNetworkPoint(item.id);return;}
  if(item.profiles.length===1){toolsOpenProfileById(item.profiles[0].id);return;}
  openModal('Відомі квартири',item.profiles.map(profile=>`<button type="button" class="btn btn-block tools-map-profile" data-profile-id="${escapeHtml(profile.id)}" style="margin-bottom:8px;">${escapeHtml(profile.apartment?`кв. ${profile.apartment}`:profile.address)}</button>`).join(''),{onOpen:root=>root.addEventListener('click',event=>{const button=event.target.closest('.tools-map-profile');if(button){closeModal();toolsOpenProfileById(button.dataset.profileId);}})});
}
function openAbonentMapPointPicker(ids=[]){
  const list=tickets.filter(ticket=>ids.some(id=>String(id)===String(ticket.id)));
  if(!list.length){showToast('Профіль не знайдено');return;}
  const source=list.find(ticket=>MTToolsCore.parseCoordinates(`${ticket.geoLat??''},${ticket.geoLng??''}`)||MTToolsCore.parseCoordinates(ticket.geoLink));
  const initial=source&&(MTToolsCore.parseCoordinates(`${source.geoLat??''},${source.geoLng??''}`)||MTToolsCore.parseCoordinates(source.geoLink));
  let picker=null;
  const closePicker=()=>{MTToolsMap.destroyPicker();closeModal();renderAddressNav();};
  openModal(initial?'📍 Уточнити точку':'📍 Додати на карту',`<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">Поставте маркер або перетягніть його. Google Maps посилання залишиться без змін.</div><div id="abonentMapPointStatus" class="tools-map-status hidden"></div><div id="abonentMapPointPicker" class="tools-map tools-map-picker"></div><div class="row wrap" style="margin-top:8px;"><button type="button" class="btn" id="abonentMapPointGps" style="flex:1;">🎯 Моє місце</button><button type="button" class="btn btn-accent" id="abonentMapPointSave" style="flex:1;">Зберегти точку</button><button type="button" class="btn" id="abonentMapPointCancel">Скасувати</button></div>`,{onClose:closePicker,onOpen:()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    picker=MTToolsMap.mountPicker(document.getElementById('abonentMapPointPicker'),{initial,statusNode:document.getElementById('abonentMapPointStatus')});
    document.getElementById('abonentMapPointCancel').onclick=closePicker;
    document.getElementById('abonentMapPointGps').onclick=async()=>{try{picker?.setPoint(await MTToolsCore.requestCurrentPosition(navigator.geolocation));}catch(_error){showToast('Не вдалося отримати геолокацію');}};
    document.getElementById('abonentMapPointSave').onclick=async()=>{
      if(!picker?.hasChanged()){showToast('Поставте або перемістіть маркер');return;}
      const point=picker?.getPoint();if(!point){showToast('Натисніть потрібне місце на карті');return;}
      const previous=list.map(ticket=>({ticket,geoLat:ticket.geoLat,geoLng:ticket.geoLng}));
      list.forEach(ticket=>{ticket.geoLat=Number(point.lat.toFixed(6));ticket.geoLng=Number(point.lng.toFixed(6));});
      if(!await saveTickets()){previous.forEach(item=>{item.ticket.geoLat=item.geoLat;item.ticket.geoLng=item.geoLng;});showToast('Не вдалося зберегти точку');return;}
      closePicker();showToast('✅ Точку збережено');
    };
  }))});
}

function openTicketGeoPointPicker(){
  const draft=MTToolsCore.createGeoDraft(calcState),initial=draft.get();
  let picker=null;
  const closePicker=()=>{MTToolsMap.destroyPicker();closeModal();};
  openModal('📍 Уточнити точку',`<div class="ticket-geo-picker-layout"><div class="ticket-geo-picker-help">Поставте маркер або перетягніть його. GPS працює лише після натискання. До збереження заявка не змінюється.</div><div id="ticketGeoPointStatus" class="tools-map-status hidden"></div><div id="ticketGeoPointPicker" class="tools-map tools-map-picker ticket-geo-picker-map"></div><div class="ticket-geo-picker-footer"><div id="ticketGeoPointCoords" class="ticket-geo-picker-coords">${initial?`${initial.lat.toFixed(6)}, ${initial.lng.toFixed(6)}`:'Точку ще не вибрано'}</div><div class="row wrap ticket-geo-picker-actions"><button type="button" class="btn" id="ticketGeoPointGps">🎯 Моє місцезнаходження</button><button type="button" class="btn btn-accent" id="ticketGeoPointSave">Зберегти точку</button><button type="button" class="btn" id="ticketGeoPointCancel">Скасувати</button></div></div></div>`,{overlayClass:'ticket-geo-picker-overlay',onClose:closePicker,onOpen:()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const showPoint=point=>{draft.set(point);const node=document.getElementById('ticketGeoPointCoords');if(node&&point)node.textContent=`${Number(point.lat).toFixed(6)}, ${Number(point.lng).toFixed(6)}`;};
    picker=MTToolsMap.mountPicker(document.getElementById('ticketGeoPointPicker'),{initial,statusNode:document.getElementById('ticketGeoPointStatus'),onChange:showPoint});
    document.getElementById('ticketGeoPointCancel').onclick=closePicker;
    document.getElementById('ticketGeoPointGps').onclick=async()=>{
      try{const point=await MTToolsCore.requestCurrentPosition(navigator.geolocation);picker?.setPoint(point);showToast(point.accuracy?`Точність GPS ≈ ${Math.round(point.accuracy)} м`:'Точку GPS визначено');}
      catch(error){const code=Number(error?.code);showToast(code===1?'Доступ до геолокації заборонено':code===3?'Час очікування GPS вичерпано':'Не вдалося визначити місцезнаходження');}
    };
    document.getElementById('ticketGeoPointSave').onclick=()=>{
      if(!picker?.hasChanged()){showToast('Поставте або перемістіть маркер');return;}
      const point=picker.getPoint();if(!point){showToast('Натисніть потрібне місце на карті');return;}
      draft.set(point);const committed=draft.commit();setGeoLink(committed.geoLink,{lat:committed.geoLat,lng:committed.geoLng});
      closePicker();showToast('✅ Точку збережено');
    };
  }))});
}

function toolsNetworkHtml(){
  const query=String(toolsNetworkSearch||''),list=MTToolsCore.searchNetworkPoints(toolsNetworkPoints,query).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return `${toolsBackButton()}<button type="button" class="btn btn-accent btn-block" data-tools-action="new-network-point">＋ Додати точку</button>
    <div class="field" style="margin-top:10px;"><input type="search" role="searchbox" name="mt-internal-network-list-search" inputmode="search" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" id="toolsNetworkSearch" value="${escapeHtml(query)}" placeholder="Пошук: тип, місто, вулиця, примітка"></div>
    <div style="margin-top:8px;">${list.length?list.map(point=>`<button type="button" class="btn btn-block tools-network-open" data-point-id="${escapeHtml(point.id)}" style="height:auto;min-height:58px;margin-bottom:8px;text-align:left;justify-content:space-between;"><span>📡 <strong>${escapeHtml(point.name||point.type||'Без назви')}</strong><small style="display:block;color:var(--text-dim);">${escapeHtml(MTToolsCore.networkPointAddress(point)||`${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`)}${point.note?` · ${escapeHtml(point.note.slice(0,50))}`:''}</small></span><span>›</span></button>`).join(''):'<div class="card">Нічого не знайдено.</div>'}</div>`;
}
let toolsNetworkSearch='';
function toolsRenderTicketNetworkLinks(){
  const root=document.getElementById('calcNetworkPointLinks');if(!root)return;calcState.networkPointIds=MTToolsCore.networkPointIds(calcState.networkPointIds);
  const points=calcState.networkPointIds.map(id=>toolsNetworkPoints.find(point=>String(point.id)===id)).filter(Boolean);
  root.innerHTML=points.length?points.map(point=>`<div class="row between calc-network-link"><button type="button" class="btn btn-sm calc-network-open" data-point-id="${escapeHtml(point.id)}">${escapeHtml(point.type)} · ${escapeHtml(MTToolsCore.networkPointAddress(point)||point.name||point.id)}</button><button type="button" class="btn btn-sm btn-danger calc-network-unlink" data-point-id="${escapeHtml(point.id)}" aria-label="Відв’язати">✕</button></div>`).join(''):'<span style="font-size:12px;color:var(--text-faint);">Об’єкти не прив’язані</span>';
  root.querySelectorAll('.calc-network-open').forEach(button=>button.onclick=()=>{appNavigationPush('calculator-network-point',closeModal);toolsShowNetworkPoint(button.dataset.pointId);});
  root.querySelectorAll('.calc-network-unlink').forEach(button=>button.onclick=()=>{if(!confirm('Відв’язати об’єкт від заявки?'))return;calcState.networkPointIds=MTToolsCore.unlinkNetworkPoint(calcState.networkPointIds,button.dataset.pointId);toolsRenderTicketNetworkLinks();formTouchedByUser=true;});
}
function toolsLinkNetworkPointToTicket(id){
  const point=toolsNetworkPoints.find(item=>String(item.id)===String(id));if(!point)return false;
  calcState.networkPointIds=MTToolsCore.linkNetworkPoint(calcState.networkPointIds,point.id);appNavigationDrop('ticket-network-preview');toolsTicketLinkContext=null;closeModal();toolsRenderTicketNetworkLinks();formTouchedByUser=true;return true;
}
function toolsShowNetworkPointOnMap(point,returnToLinking=false){
  if(!point)return false;
  if(returnToLinking){const state=toolsCaptureTicketLinkContext();appNavigationDrop('ticket-network-preview');appNavigationPush('ticket-network-map',()=>toolsOpenTicketNetworkPointPicker(state),state);}
  closeModal();toolsView='map';toolsSelectedNetworkPointId=String(point.id);switchTab('tools');renderToolsScreen('map');requestAnimationFrame(()=>requestAnimationFrame(()=>{MTToolsMap.focusPoint(point,18);toolsHighlightNetworkPointInList(point.id);document.getElementById('toolsLeafletMap')?.scrollIntoView({behavior:'smooth',block:'center'});}));return true;
}
function toolsTicketNetworkPointPreviewHtml(point){
  const view=MTToolsCore.networkPointPreviewData(point),rows=[['Тип об’єкта',view.type],['Назва',view.name],['Ідентифікатор',view.id],['Коротка позначка',view.label],['Повна адреса',view.address],['Місто',view.city],['Вулиця',view.street],['Будинок / орієнтир',view.house],['Координати',view.coordinates]];
  return `<div class="tools-network-preview">${appBackButtonHtml('Назад до списку')}<div class="card">${rows.filter(row=>row[1]).map(row=>`<div class="tools-result-row"><span>${escapeHtml(row[0])}</span><strong>${escapeHtml(row[1])}</strong></div>`).join('')}${view.note?`<div class="tools-network-preview-note"><span>Примітка</span><div>${escapeHtml(view.note)}</div></div>`:''}</div><div id="ticketNetworkPointPreviewPhotos" class="tools-point-photo-grid"><span class="tools-network-preview-photo-empty">Фото недоступне</span></div><div class="row wrap tools-network-preview-actions"><button type="button" class="btn" id="ticketNetworkPointPreviewMapBtn">Показати на карті</button><button type="button" class="btn btn-accent" id="ticketNetworkPointPreviewLinkBtn">Прив’язати до заявки</button><button type="button" class="btn" id="ticketNetworkPointPreviewCloseBtn">Закрити</button></div></div>`;
}
async function toolsPopulateTicketNetworkPointPreviewPhotos(point){
  const root=document.getElementById('ticketNetworkPointPreviewPhotos'),keys=MTToolsCore.networkPointPreviewData(point).photoKeys;if(!root||!keys.length)return;
  let rendered=0;
  for(let index=0;index<keys.length;index++){
    const data=await resolvePhotoAsync(keys[index],null);if(!root||!data)continue;
    const button=document.createElement('button'),image=document.createElement('img');button.type='button';button.className='tools-point-photo-view';button.dataset.photoIndex=String(index);button.setAttribute('aria-label',`Відкрити фото ${index+1}`);image.src=data;image.alt=`Фото об’єкта ${index+1}`;button.appendChild(image);root.appendChild(button);rendered++;
  }
  if(rendered)root.querySelector('.tools-network-preview-photo-empty')?.remove();
  root.querySelectorAll('.tools-point-photo-view').forEach(button=>button.onclick=()=>toolsOpenNetworkPhotoViewer(point.id,button.dataset.photoIndex));
}
function toolsOpenTicketNetworkPointPreview(id){
  const point=toolsNetworkPoints.find(item=>String(item.id)===String(id));if(!point)return false;
  const context=toolsCaptureTicketLinkContext();appNavigationPush('ticket-network-preview',()=>toolsOpenTicketNetworkPointPicker(context),context);
  const closePreview=()=>{appNavigationDrop('ticket-network-preview');toolsTicketLinkContext=null;closeModal();};
  openModal('Деталі об’єкта',toolsTicketNetworkPointPreviewHtml(point),{onClose:closePreview,onOpen:()=>{
    document.getElementById('ticketNetworkPointPreviewMapBtn').onclick=()=>toolsShowNetworkPointOnMap(point,true);
    document.getElementById('ticketNetworkPointPreviewLinkBtn').onclick=()=>toolsLinkNetworkPointToTicket(point.id);
    document.getElementById('ticketNetworkPointPreviewCloseBtn').onclick=closePreview;
    toolsPopulateTicketNetworkPointPreviewPhotos(point);
  }});return true;
}
function toolsCaptureTicketLinkContext(){
  const input=document.getElementById('ticketNetworkPointSearch'),list=document.getElementById('ticketNetworkPointChoices');
  if(input)toolsTicketLinkContext={ticketId:String(editingTicketId||'draft'),query:input.value,scrollTop:list?.scrollTop||0};
  return appNavigationState(toolsTicketLinkContext||{ticketId:String(editingTicketId||'draft'),query:'',scrollTop:0});
}
function toolsOpenTicketNetworkPointPicker(context=null){
  toolsTicketLinkContext=appNavigationState(context||{ticketId:String(editingTicketId||'draft'),query:'',scrollTop:0});
  const rank=point=>{let score=0;if(String(point.city||'').toLocaleLowerCase('uk')===String(calcState.city||'').toLocaleLowerCase('uk'))score+=2;if(String(point.street||'').toLocaleLowerCase('uk')===String(calcState.street||'').toLocaleLowerCase('uk'))score+=4;return score;};
  openModal('Прив’язати об’єкт',`<button type="button" class="btn btn-accent btn-block" id="ticketNetworkPointCreateBtn" style="margin-bottom:10px;">➕ Створити об’єкт</button><div class="field"><input type="search" role="searchbox" name="mt-internal-point-link-search" inputmode="search" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" id="ticketNetworkPointSearch" value="${escapeHtml(toolsTicketLinkContext.query||'')}" placeholder="Тип, місто, вулиця, адреса або примітка"></div><div id="ticketNetworkPointChoices" class="tools-network-point-choices"></div>`,{onClose:()=>{toolsTicketLinkContext=null;appNavigationDropPrefix('ticket-network-');closeModal();},onOpen:()=>{const input=document.getElementById('ticketNetworkPointSearch'),root=document.getElementById('ticketNetworkPointChoices'),render=()=>{const list=MTToolsCore.sortNewestFirst(MTToolsCore.searchNetworkPoints(toolsNetworkPoints,input.value)).sort((a,b)=>rank(b)-rank(a)).slice(0,150);root.innerHTML=list.map(point=>{const meta=MTToolsCore.networkPointPickerMeta(point);return `<div class="ticket-network-choice-row" data-point-row="${escapeHtml(point.id)}"><button type="button" class="btn ticket-network-choice" data-point-id="${escapeHtml(point.id)}"><span class="ticket-network-choice-copy"><span>${escapeHtml(point.type)} · ${escapeHtml(MTToolsCore.networkPointAddress(point)||point.name||point.id)}</span>${meta?`<small>${escapeHtml(meta)}</small>`:''}</span>${calcState.networkPointIds?.includes(String(point.id))?'<span>✅</span>':''}</button><button type="button" class="btn ticket-network-preview" data-point-id="${escapeHtml(point.id)}" aria-label="Переглянути деталі ${escapeHtml(point.name||point.type||point.id)}" title="Деталі">👁</button></div>`;}).join('')||'<div class="card">Нічого не знайдено.</div>';root.querySelectorAll('.ticket-network-choice').forEach(button=>button.onclick=()=>toolsLinkNetworkPointToTicket(button.dataset.pointId));root.querySelectorAll('.ticket-network-preview').forEach(button=>button.onclick=()=>toolsOpenTicketNetworkPointPreview(button.dataset.pointId));requestAnimationFrame(()=>{root.scrollTop=Number(toolsTicketLinkContext?.scrollTop)||0;const selected=toolsTicketLinkContext?.newPointId&&[...root.querySelectorAll('[data-point-row]')].find(row=>row.dataset.pointRow===String(toolsTicketLinkContext.newPointId));selected?.classList.add('selected');selected?.scrollIntoView({block:'nearest'});});};input.oninput=()=>{toolsTicketLinkContext.query=input.value;toolsTicketLinkContext.scrollTop=0;render();};document.getElementById('ticketNetworkPointCreateBtn').onclick=toolsStartTicketNetworkPointCreation;render();}});
}
function toolsStartTicketNetworkPointCreation(){
  const context=toolsCaptureTicketLinkContext();toolsLinkCreationContext=context;closeModal();appNavigationPush('ticket-network-create',()=>{toolsLinkCreationContext=null;toolsOpenTicketNetworkPointPicker(context);},context);toolsView='map';switchTab('tools');renderToolsScreen('map');requestAnimationFrame(()=>toolsStartMapAddMode());
}
function toolsReturnToTicketLinking(newPointId=''){
  const context=appNavigationState(toolsLinkCreationContext||toolsTicketLinkContext||{});context.newPointId=String(newPointId||'');toolsLinkCreationContext=null;appNavigationDrop('ticket-network-create');switchTab('calculator');toolsOpenTicketNetworkPointPicker(context);
}
function toolsNetworkPointPhotoSignature(point){return JSON.stringify((point.photoKeys||[point.photoKey]).filter(Boolean));}
function toolsNetworkPointTelegramText(point){
  const address=MTToolsCore.networkPointAddress(point),location=`https://www.google.com/maps?q=${point.lat},${point.lng}`;
  const metadata={schema:'master-tracker-network-point-v1',id:String(point.id),networkPointType:point.type||'',city:point.city||'',street:point.street||'',house:point.house||'',note:point.note||'',lat:point.lat,lng:point.lng,createdAt:point.createdAt,updatedAt:point.updatedAt};
  return [`📡 ${point.name||point.type}`,address?`Адреса: ${address}`:'',point.note?`Примітка: ${point.note}`:'',`Дата: ${new Date(point.updatedAt).toLocaleString('uk-UA')}`,`Координати: ${point.lat}, ${point.lng}`,location,'NETWORK_POINT_JSON',JSON.stringify(metadata)].filter(Boolean).join('\n');
}
function toolsOpenNetworkPointEditor(id='',defaults={},options={}){
  const existing=toolsNetworkPoints.find(point=>point.id===id)||defaults||{};
  const isNew=!existing.id;
  const cities=[...new Set([...(settings.cities||[]),...tickets.map(ticket=>ticket.city)].filter(Boolean))].sort();
  const streets=[...new Set([...Object.values(settings.streets||{}).flat(),...tickets.map(ticket=>ticket.street)].filter(Boolean))].sort();
  let pointEditorDirty=false;
  const closePointEditor=()=>{if(pointEditorDirty&&!confirm('Повернутись назад? Незбережені дані об’єкта буде втрачено.'))return;document.getElementById('toolsScreenRoot')?.classList.remove('tools-map-editor-open');options.placement?.cancel?.();MTToolsMap.destroyPicker();closeModal();if(options.returnToLinking)toolsReturnToTicketLinking();};
  openModal(existing.id?'Редагувати точку':'Нова точка мережі',`
    <div class="field"><label>Тип</label><select id="toolsPointType">${MTToolsCore.NETWORK_POINT_TYPES.map(type=>`<option ${type===(existing.type||'FOB')?'selected':''}>${escapeHtml(type)}</option>`).join('')}</select></div>
    <div class="field-row"><div class="field"><label>Місто</label><input id="toolsPointCity" name="mt-internal-point-city" autocomplete="off" autocorrect="off" spellcheck="false" list="toolsPointCities" value="${escapeHtml(existing.city||'')}"><datalist id="toolsPointCities">${cities.map(value=>`<option value="${escapeHtml(value)}">`).join('')}</datalist></div><div class="field"><label>Вулиця</label><input id="toolsPointStreet" name="mt-internal-point-street" autocomplete="off" autocorrect="off" spellcheck="false" list="toolsPointStreets" value="${escapeHtml(existing.street||'')}"><datalist id="toolsPointStreets">${streets.map(value=>`<option value="${escapeHtml(value)}">`).join('')}</datalist></div></div>
    <div class="field-row"><div class="field"><label>Будинок / орієнтир</label><input id="toolsPointHouse" name="mt-internal-point-location" autocomplete="off" autocorrect="off" spellcheck="false" value="${escapeHtml(existing.house||'')}"></div><div class="field"><label>Коротка позначка</label><input id="toolsPointLabel" name="mt-internal-point-label" autocomplete="off" value="${escapeHtml(existing.label||'')}"></div></div>
    <div class="field-row"><div class="field"><label>Широта</label><input id="toolsPointLat" inputmode="decimal" value="${existing.lat??''}" placeholder="50.4501"></div><div class="field"><label>Довгота</label><input id="toolsPointLng" inputmode="decimal" value="${existing.lng??''}" placeholder="30.5234"></div></div>
    <div class="row wrap" style="margin:-2px 0 12px;"><button type="button" class="btn" id="toolsPointLocateBtn" style="flex:1;">◎ Поточне місце</button><button type="button" class="btn" id="toolsPointPickBtn" style="flex:1;">🗺 Вказати на карті</button></div>
    <div id="toolsPointPickerPanel" class="hidden tools-map-picker-panel"><div id="toolsPointPickerStatus" class="tools-map-status hidden" role="status"></div><div id="toolsPointPickerMap" class="tools-map tools-map-picker" aria-label="Вибір координат точки"></div><div class="row" style="margin-top:8px;"><button type="button" class="btn btn-accent" id="toolsPointUseMapBtn" style="flex:1;">Використати цю точку</button><button type="button" class="btn" id="toolsPointCancelMapBtn">Скасувати</button></div></div>
    <div class="field"><label>Примітка</label><textarea id="toolsPointNote">${escapeHtml(existing.note||'')}</textarea></div>
    ${isNew?'':`<div class="field"><label>Збережені фото</label><div id="toolsPointExistingPhotos" class="tools-point-existing-photos">${(existing.photoKeys||[existing.photoKey]).filter(Boolean).map((key,index)=>`<div class="tools-point-existing-photo" data-photo-key="${escapeHtml(key)}"><img class="tools-point-existing-photo-preview" data-photo-preview-key="${escapeHtml(key)}" alt="Фото ${index+1}"><span>Фото ${index+1}</span><button type="button" class="btn btn-sm btn-danger tools-point-photo-remove" data-photo-key="${escapeHtml(key)}">🗑 Видалити</button></div>`).join('')||'<span style="color:var(--text-faint);font-size:12px;">Фото немає</span>'}</div></div>`}
    <div class="field"><label>Фото (до 3)</label><input type="file" id="toolsPointPhoto" accept="image/*" multiple></div>
    <div class="tools-point-editor-footer row wrap"><button type="button" class="btn btn-accent" id="toolsPointSaveBtn" style="flex:1;">Зберегти</button><button type="button" class="btn" id="toolsPointCancelBtn" style="flex:1;">Скасувати</button></div>`,{overlayClass:options.placement?'tools-point-editor-overlay':'tools-point-editor-modal',onClose:closePointEditor,onOpen:()=>{
      const latInput=document.getElementById('toolsPointLat'),lngInput=document.getElementById('toolsPointLng'),panel=document.getElementById('toolsPointPickerPanel');
      let mapPicker=null;
      const inputPoint=()=>MTToolsCore.parseCoordinates(`${latInput.value.replace(',','.')},${lngInput.value.replace(',','.')}`);
      const writePoint=point=>{latInput.value=Number(point.lat).toFixed(6);lngInput.value=Number(point.lng).toFixed(6);pointEditorDirty=true;};
      options.placement?.onChange?.(writePoint);
      document.getElementById('modalBody').addEventListener('input',()=>{pointEditorDirty=true;});
      document.getElementById('modalBody').addEventListener('change',()=>{pointEditorDirty=true;});
      document.querySelectorAll('[data-photo-preview-key]').forEach(async image=>{const data=await resolvePhotoAsync(image.dataset.photoPreviewKey,null);if(data)image.src=data;});
      document.querySelectorAll('.tools-point-photo-remove').forEach(button=>button.onclick=async()=>{if(!confirm('Видалити це фото?'))return;button.disabled=true;await toolsRemoveNetworkPointPhoto(existing.id,button.dataset.photoKey);});
      if(options.placement){document.getElementById('toolsScreenRoot')?.classList.add('tools-map-editor-open');setTimeout(()=>document.getElementById('toolsLeafletMap')?.scrollIntoView({block:'start'}),0);}
      document.getElementById('toolsPointCancelBtn').onclick=closePointEditor;
      document.getElementById('toolsPointPickBtn').onclick=()=>{
        panel.classList.remove('hidden');
        mapPicker=MTToolsMap.mountPicker(document.getElementById('toolsPointPickerMap'),{initial:inputPoint(),statusNode:document.getElementById('toolsPointPickerStatus')});
        if(!mapPicker)showToast('Модуль карти недоступний');
      };
      document.getElementById('toolsPointCancelMapBtn').onclick=()=>{MTToolsMap.destroyPicker();mapPicker=null;panel.classList.add('hidden');};
      document.getElementById('toolsPointUseMapBtn').onclick=()=>{
        const point=mapPicker?.getPoint();if(!point){showToast('Натисніть потрібне місце на карті');return;}
        writePoint(point);MTToolsMap.destroyPicker();mapPicker=null;panel.classList.add('hidden');showToast('Координати вибрано');
      };
      document.getElementById('toolsPointLocateBtn').onclick=()=>{
        if(!navigator.geolocation){showToast('Геолокація не підтримується');return;}
        showToast('Визначаю координати…');
        navigator.geolocation.getCurrentPosition(position=>{
          const point={lat:position.coords.latitude,lng:position.coords.longitude};writePoint(point);mapPicker?.setPoint(point);showToast('Поточне місце визначено');
        },()=>showToast('Не вдалося отримати геолокацію'),{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
      };
      const savePoint=async()=>{
        const saveButton=document.getElementById('toolsPointSaveBtn');if(saveButton.disabled)return;saveButton.disabled=true;
        const now=new Date(),type=document.getElementById('toolsPointType').value,label=document.getElementById('toolsPointLabel').value.trim(),base={...existing,name:[type,label].filter(Boolean).join(' '),type,city:document.getElementById('toolsPointCity').value,street:document.getElementById('toolsPointStreet').value,house:document.getElementById('toolsPointHouse').value,label,lat:document.getElementById('toolsPointLat').value.replace(',','.'),lng:document.getElementById('toolsPointLng').value.replace(',','.'),note:document.getElementById('toolsPointNote').value};
        const normalized=MTToolsCore.normalizeNetworkPoint(base,now);if(!normalized){saveButton.disabled=false;showToast('Вкажіть коректні координати');return;}
        const files=[...document.getElementById('toolsPointPhoto').files].slice(0,3),keys=(existing.photoKeys||[existing.photoKey]).filter(Boolean);
        for(const file of files){const key=await toolsStoreCompressedPhoto(file);if(!key){showToast('Не вдалося зберегти фото');return;}keys.push(key);}normalized.photoKeys=[...new Set(keys)].slice(0,3);normalized.photoKey=normalized.photoKeys[0]||'';
        const at=toolsNetworkPoints.findIndex(point=>point.id===normalized.id);if(at>=0)toolsNetworkPoints[at]=normalized;else toolsNetworkPoints.push(normalized);
        if(!toolsSaveNetworkPoints()){saveButton.disabled=false;return;}document.getElementById('toolsScreenRoot')?.classList.remove('tools-map-editor-open');options.placement?.cancel?.();MTToolsMap.destroyPicker();closeModal();if(options.returnToLinking)toolsReturnToTicketLinking(normalized.id);else renderToolsScreen(options.returnView||'map');showToast('Точку збережено локально');await toolsSendNetworkPointTelegram(normalized,{updateExisting:!isNew});
      };
      document.getElementById('toolsPointSaveBtn').onclick=savePoint;
    }});
}
async function toolsSendNetworkPointTelegram(point,options={}){
  const current=toolsNetworkPoints.find(item=>String(item.id)===String(point?.id));if(!current)return false;
  const hasReference=!!telegramNetworkMessageLink(current.telegramChatId,current.telegramMessageId);if(hasReference&&!options.updateExisting&&!options.republish)return true;
  if(toolsNetworkTelegramSending.has(current.id)){showToast('Відправлення вже виконується');return false;}toolsNetworkTelegramSending.add(current.id);
  try{
    const chatId=String(settings.tgBackupChatId||'').trim();if(!String(settings.tgBotToken||'').trim()||!chatId){current.telegramSendPending=true;toolsSaveNetworkPoints();showToast('Точку збережено. Telegram не налаштовано');return false;}
    const text=toolsNetworkPointTelegramText(current),photos=(current.photoKeys||[current.photoKey]).filter(Boolean),photoSignature=toolsNetworkPointPhotoSignature(current);
    const refs=(current.telegramMediaRefs||[]).map(ref=>({...ref}));let mediaOk=true,legacyRemoval=false;
    if(hasReference&&!options.republish){
      const result=await editTelegramTextMessage(current.telegramChatId,current.telegramMessageId,text);
      current.telegramSendPending=!result.ok;
      let legacyKeys=[];try{legacyKeys=JSON.parse(current.telegramPhotoSignature||'[]');}catch(_error){legacyKeys=[];}const previouslyTracked=new Set(refs.map(ref=>ref.photoKey)),untrackedLegacy=legacyKeys.filter(key=>!previouslyTracked.has(key));
      for(const ref of refs.filter(ref=>!photos.includes(ref.photoKey))){const deleted=await deleteTelegramMessageById(current.telegramChatId,ref.messageId);if(deleted.ok)refs.splice(refs.findIndex(item=>item.photoKey===ref.photoKey&&item.messageId===ref.messageId),1);else mediaOk=false;}
      const tracked=new Set(refs.map(ref=>ref.photoKey));
      for(const key of photos.filter(key=>!tracked.has(key)&&!legacyKeys.includes(key))){const sent=await sendTelegramPhotoMessage(current.telegramChatId,key,`${current.name||current.type} · фото`);if(sent.ok&&sent.messageId)refs.push({photoKey:key,messageId:sent.messageId});else mediaOk=false;}
      legacyRemoval=untrackedLegacy.some(key=>!photos.includes(key));
      current.telegramMediaRefs=refs;current.telegramMediaUpdatePending=!result.ok||!mediaOk||legacyRemoval;
      if(result.ok&&mediaOk&&!legacyRemoval)current.telegramPhotoSignature=photoSignature;
      toolsSaveNetworkPoints();
      if(!result.ok)showToast('Об’єкт збережено локально, але Telegram не вдалося оновити.');
      else if(current.telegramMediaUpdatePending)showToast('Текст синхронізовано. Фото збережено в Майстер-Трекері, але старе Telegram-медіа без message ID неможливо безпечно змінити.');
      else showToast('✅ Публікацію Telegram оновлено');
      return result.ok&&mediaOk&&!legacyRemoval;
    }
    const firstResult=await sendToTelegramChat(chatId,text,null,null);const newRefs=[];if(firstResult.ok){for(const key of photos){const sent=await sendTelegramPhotoMessage(chatId,key,`${current.name||current.type} · фото`);if(sent.ok&&sent.messageId)newRefs.push({photoKey:key,messageId:sent.messageId});else mediaOk=false;}}
    if(firstResult.ok&&telegramNetworkMessageLink(firstResult.chatId,firstResult.messageId)){current.telegramChatId=String(firstResult.chatId);current.telegramMessageId=Number(firstResult.messageId);current.telegramMediaRefs=newRefs;current.telegramSendPending=false;current.telegramMediaUpdatePending=!mediaOk;current.telegramPhotoSignature=JSON.stringify(newRefs.map(ref=>ref.photoKey));}else current.telegramSendPending=true;
    toolsSaveNetworkPoints();showToast(firstResult.ok&&mediaOk?'✅ Точку надіслано в Telegram':firstResult.ok?'Точку надіслано, але не всі фото синхронізовано':'Об’єкт збережено локально, але не вдалося надіслати в Telegram');return firstResult.ok&&mediaOk;
  }finally{toolsNetworkTelegramSending.delete(current.id);}
}
function toolsStoreCompressedPhoto(file){
  return new Promise(resolve=>{const reader=new FileReader();reader.onerror=()=>resolve(null);reader.onload=event=>{const image=new Image();image.onerror=()=>resolve(null);image.onload=async()=>{const scale=Math.min(1,800/image.width),canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);resolve(await storePhoto(canvas.toDataURL('image/jpeg',.72)));};image.src=event.target.result;};reader.readAsDataURL(file);});
}
function toolsPhotoKeyStillUsed(key,removedPointId){
  const inAnotherPoint=toolsNetworkPoints.some(point=>String(point.id)!==String(removedPointId)&&(point.photoKeys||[point.photoKey]).filter(Boolean).includes(key));
  const inTicket=tickets.some(ticket=>(ticket.photos||[ticket.photo]).filter(Boolean).includes(key));
  return inAnotherPoint||inTicket;
}
async function toolsRemoveNetworkPointPhoto(pointId,key){
  const point=toolsNetworkPoints.find(item=>String(item.id)===String(pointId));if(!point||!(point.photoKeys||[point.photoKey]).filter(Boolean).includes(key))return false;
  const previous={...point,photoKeys:(point.photoKeys||[]).slice()},nextKeys=(point.photoKeys||[point.photoKey]).filter(Boolean).filter(value=>value!==key);point.photoKeys=nextKeys;point.photoKey=nextKeys[0]||'';point.updatedAt=new Date().toISOString();
  if(!toolsSaveNetworkPoints()){Object.assign(point,previous);return false;}if(!toolsPhotoKeyStillUsed(key,pointId))await deletePhotoKey(key);await toolsSendNetworkPointTelegram(point,{updateExisting:true});closeModal();toolsOpenNetworkPointEditor(pointId);showToast('Фото видалено з об’єкта');return true;
}
async function toolsDeleteNetworkPoint(id){
  const previous=toolsNetworkPoints,outcome=MTToolsCore.removeNetworkPoint(previous,id);if(!outcome.removed)return false;
  const linked=MTToolsCore.ticketsForNetworkPoint(tickets,id),previousLinks=linked.map(ticket=>({ticket,ids:(ticket.networkPointIds||[]).slice()}));
  MTToolsCore.removeNetworkPointLinks(tickets,id);
  if(linked.length&&!await saveTickets()){previousLinks.forEach(item=>item.ticket.networkPointIds=item.ids);return false;}
  toolsNetworkPoints=outcome.points;
  if(!toolsSaveNetworkPoints()){toolsNetworkPoints=previous;previousLinks.forEach(item=>item.ticket.networkPointIds=item.ids);if(linked.length)await saveTickets();return false;}
  const photoKeys=[...new Set((outcome.removed.photoKeys||[outcome.removed.photoKey]).filter(Boolean))];
  for(const key of photoKeys){if(!toolsPhotoKeyStillUsed(key,id))await deletePhotoKey(key);}
  closeModal();renderToolsScreen(toolsView);showToast('Об’єкт видалено');return true;
}
function toolsConfirmDeleteNetworkPoint(id){
  const point=toolsNetworkPoints.find(item=>String(item.id)===String(id));if(!point)return;
  const linked=MTToolsCore.ticketsForNetworkPoint(tickets,id).length;
  openModal('Видалити об’єкт',`<p style="margin:0 0 14px;">Видалити цей об’єкт?${linked?`<br><strong>Цей об’єкт пов’язаний з ${linked} заявками.</strong> Заявки залишаться, буде видалено лише зв’язок.`:''}</p><div class="row wrap"><button type="button" class="btn btn-danger" id="toolsPointDeleteConfirmBtn" style="flex:1;">Видалити</button><button type="button" class="btn" id="toolsPointDeleteCancelBtn" style="flex:1;">Скасувати</button></div>`,{onOpen:()=>{
    document.getElementById('toolsPointDeleteCancelBtn').onclick=()=>toolsShowNetworkPoint(point.id);
    document.getElementById('toolsPointDeleteConfirmBtn').onclick=async event=>{event.currentTarget.disabled=true;await toolsDeleteNetworkPoint(point.id);};
  }});
}
async function toolsOpenNetworkPhotoViewer(pointId,startIndex=0){
  const point=toolsNetworkPoints.find(item=>String(item.id)===String(pointId)),keys=(point?.photoKeys||[point?.photoKey]).filter(Boolean);if(!keys.length)return;
  const images=(await Promise.all(keys.map(key=>resolvePhotoAsync(key,null)))).filter(Boolean);if(!images.length)return;let index=Math.max(0,Math.min(images.length-1,Number(startIndex)||0)),zoom=1;
  openModal('Фото об’єкта',`<div class="tools-photo-viewer"><div class="tools-photo-viewer-stage" id="toolsPhotoViewerStage"><img id="toolsPhotoViewerImage" alt="Фото об’єкта"></div><div class="row wrap tools-photo-viewer-controls"><button class="btn" id="toolsPhotoPrev">‹</button><button class="btn" id="toolsPhotoZoomOut">−</button><button class="btn" id="toolsPhotoZoomReset">100%</button><button class="btn" id="toolsPhotoZoomIn">＋</button><button class="btn" id="toolsPhotoNext">›</button></div></div>`,{overlayClass:'tools-photo-viewer-overlay',onOpen:()=>{const image=document.getElementById('toolsPhotoViewerImage'),stage=document.getElementById('toolsPhotoViewerStage'),draw=(resetScroll=false)=>{image.src=images[index];image.style.width=`${zoom*100}%`;image.classList.toggle('zoomed',zoom>1);document.getElementById('toolsPhotoZoomReset').textContent=`${Math.round(zoom*100)}%`;if(resetScroll){stage.scrollTop=0;stage.scrollLeft=0;}};const move=delta=>{index=(index+delta+images.length)%images.length;zoom=1;draw(true);};document.getElementById('toolsPhotoPrev').onclick=()=>move(-1);document.getElementById('toolsPhotoNext').onclick=()=>move(1);document.getElementById('toolsPhotoZoomOut').onclick=()=>{zoom=Math.max(1,zoom-.5);draw(zoom===1);};document.getElementById('toolsPhotoZoomIn').onclick=()=>{zoom=Math.min(4,zoom+.5);draw();};document.getElementById('toolsPhotoZoomReset').onclick=()=>{zoom=1;draw(true);};image.ondblclick=()=>{zoom=zoom===1?2:1;draw(zoom===1);};let touchX=null;stage.ontouchstart=event=>{touchX=event.touches.length===1?event.touches[0].clientX:null;};stage.ontouchend=event=>{if(zoom!==1||touchX===null||event.changedTouches.length!==1)return;const delta=event.changedTouches[0].clientX-touchX;if(Math.abs(delta)>50)move(delta>0?-1:1);touchX=null;};draw(true);}});
}
function toolsMoveNetworkPoint(id){
  const point=toolsNetworkPoints.find(item=>String(item.id)===String(id));if(!point)return;let picker=null;
  openModal('Перемістити на карті',`<div id="toolsMovePointStatus" class="tools-map-status hidden"></div><div id="toolsMovePointMap" class="tools-map tools-map-picker"></div><div class="row wrap" style="margin-top:8px;"><button class="btn btn-accent" id="toolsMovePointSave" style="flex:1;">Зберегти нове місце</button><button class="btn" id="toolsMovePointCancel">Скасувати</button></div>`,{onClose:()=>{MTToolsMap.destroyPicker();closeModal();},onOpen:()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{picker=MTToolsMap.mountPicker(document.getElementById('toolsMovePointMap'),{initial:point,statusNode:document.getElementById('toolsMovePointStatus')});document.getElementById('toolsMovePointCancel').onclick=()=>{MTToolsMap.destroyPicker();closeModal();toolsShowNetworkPoint(point.id);};document.getElementById('toolsMovePointSave').onclick=async()=>{if(!picker?.hasChanged()){showToast('Перемістіть маркер або торкніться карти');return;}const next=picker.getPoint(),previous={lat:point.lat,lng:point.lng,updatedAt:point.updatedAt};point.lat=next.lat;point.lng=next.lng;point.updatedAt=new Date().toISOString();if(!toolsSaveNetworkPoints()){Object.assign(point,previous);return;}await toolsSendNetworkPointTelegram(point,{updateExisting:true});MTToolsMap.destroyPicker();closeModal();renderToolsScreen('map');showToast('✅ Нове місце збережено');};}))});
}
function toolsShowNetworkPoint(id){
  const point=toolsNetworkPoints.find(item=>item.id===id);if(!point)return;
  toolsSelectedNetworkPointId=String(point.id);toolsHighlightNetworkPointInList(point.id);
  const modalNavigationKey=appNavigationPeek()?.key||'';
  const closePointDetails=()=>{if(modalNavigationKey)appNavigationDrop(modalNavigationKey);closeModal();};
  const address=MTToolsCore.networkPointAddress(point),telegramLink=telegramNetworkMessageLink(point.telegramChatId,point.telegramMessageId),telegramLabel=telegramLink?'✈️ Оновити в Telegram':point.telegramSendPending?'✈️ Повторити відправлення':'✈️ Надіслати в Telegram',linked=MTToolsCore.ticketsForNetworkPoint(tickets,point.id);openModal(point.name||point.type||'Точка мережі',`${appNavigationCanGoBack()?appBackButtonHtml():''}<div style="font-size:13px;line-height:1.6;"><strong>${escapeHtml(point.type)}</strong>${address?`<br>🏘 ${escapeHtml(address)}`:''}<br>📍 ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}<div style="font-size:11.5px;color:var(--text-dim);margin-top:4px;">Створено: ${escapeHtml(new Date(point.createdAt).toLocaleString('uk-UA'))}<br>Оновлено: ${escapeHtml(new Date(point.updatedAt).toLocaleString('uk-UA'))}</div>${point.note?`<div style="white-space:pre-wrap;margin-top:8px;">${escapeHtml(point.note)}</div>`:''}<div id="toolsPointPhotoPreview" class="tools-point-photo-grid" style="margin-top:8px;"></div>${linked.length?`<div class="card" style="margin-top:10px;"><strong>Пов’язані заявки: ${linked.length}</strong>${linked.map(ticket=>`<button class="btn btn-block tools-linked-ticket" data-ticket-id="${escapeHtml(ticket.id)}" style="margin-top:6px;">${escapeHtml(ticket.date||'')} — ${escapeHtml(ticket.type||'Заявка')}</button>`).join('')}</div>`:''}<div class="row wrap" style="margin-top:10px;"><button type="button" class="btn" id="toolsPointMapBtn" style="flex:1;">📍 Показати на карті</button><button type="button" class="btn" id="toolsPointMoveBtn" style="flex:1;">↔ Перемістити на карті</button><button type="button" class="btn" id="toolsPointRouteBtn" style="flex:1;">🗺 Маршрут</button><button type="button" class="btn" id="toolsPointEditBtn" style="flex:1;">✏️ Редагувати</button>${telegramLink?`<button type="button" class="btn btn-accent" id="toolsPointTelegramOpenBtn" style="flex:1 0 100%;">Відкрити в Telegram</button>`:''}<button type="button" class="btn" id="toolsPointTelegramBtn" style="flex:1 0 100%;">${telegramLabel}</button><button type="button" class="btn btn-danger" id="toolsPointDeleteBtn" style="flex:1 0 100%;">Видалити об’єкт</button></div></div>`,{onClose:closePointDetails,onOpen:async()=>{
    document.getElementById('toolsPointMapBtn').onclick=()=>toolsShowNetworkPointOnMap(point);
    document.getElementById('toolsPointRouteBtn').onclick=()=>window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${point.lat},${point.lng}`)}`,'_blank','noopener');
    document.getElementById('toolsPointMoveBtn').onclick=()=>toolsMoveNetworkPoint(point.id);
    document.getElementById('toolsPointEditBtn').onclick=()=>{closeModal();toolsOpenNetworkPointEditor(point.id);};
    document.getElementById('toolsPointDeleteBtn').onclick=()=>toolsConfirmDeleteNetworkPoint(point.id);
    const openTelegramButton=document.getElementById('toolsPointTelegramOpenBtn');if(openTelegramButton)openTelegramButton.onclick=()=>window.open(telegramLink,'_blank','noopener');
    document.getElementById('toolsPointTelegramBtn').onclick=async event=>{
      const button=event.currentTarget,oldText=button.textContent;button.disabled=true;button.textContent='Оновлення…';await toolsSendNetworkPointTelegram(point,{updateExisting:!!telegramLink});button.disabled=false;button.textContent=oldText;
    };
    document.querySelectorAll('.tools-linked-ticket').forEach(button=>button.onclick=()=>{closeModal();editTicket(button.dataset.ticketId);});
    const root=document.getElementById('toolsPointPhotoPreview'),photos=(point.photoKeys||[point.photoKey]).filter(Boolean);for(let index=0;index<photos.length;index++){const data=await resolvePhotoAsync(photos[index],null);if(root&&data)root.insertAdjacentHTML('beforeend',`<button class="tools-point-photo-view" data-photo-index="${index}" aria-label="Відкрити фото"><img src="${data}" alt="Фото точки"></button>`);}root?.querySelectorAll('.tools-point-photo-view').forEach(button=>button.onclick=()=>toolsOpenNetworkPhotoViewer(point.id,button.dataset.photoIndex));
  }});
}
function toolsHighlightNetworkPointInList(id){document.querySelectorAll('.tools-network-object').forEach(button=>button.classList.toggle('selected',String(button.dataset.pointId)===String(id)));}
function toolsFocusNetworkPoint(id){const point=toolsNetworkPoints.find(item=>String(item.id)===String(id));if(!point)return;toolsSelectedNetworkPointId=String(id);MTToolsMap.focusPoint(point,18);toolsHighlightNetworkPointInList(id);document.getElementById('toolsLeafletMap')?.scrollIntoView({behavior:'smooth',block:'center'});toolsShowNetworkPoint(point.id);}

function renderToolsScreen(view){
  const nextView=view||toolsView;if(toolsView==='diagnostics'&&nextView!=='diagnostics')toolsStopConnectionCheck(false);toolsView=nextView;
  const root=document.getElementById('toolsScreenRoot');if(!root)return;
  MTToolsMap?.captureView?.();
  if(toolsView==='diagnostics')root.innerHTML=toolsDiagnosticsHtml();
  else if(toolsView==='map'){
    root.innerHTML=toolsMapHtml();
    requestAnimationFrame(()=>MTToolsMap.mount(document.getElementById('toolsLeafletMap'),MTToolsCore.mapObjects(tickets,toolsNetworkPoints),{
      filterRoot:document.getElementById('toolsMapFilters'),statusNode:document.getElementById('toolsMapStatus'),emptyStateNode:document.getElementById('toolsMapEmptyState'),markerPreset:settings.mapMarkerPreset,markerPreferences:settings.mapMarkerPreferences,onSelect:toolsOpenMapObject,onAddHere:point=>toolsStartMapAddMode(point)
    }));
  }
  else if(toolsView==='network')root.innerHTML=toolsNetworkHtml();
  else if(toolsView==='offline'){
    root.innerHTML=toolsOfflineHtml();requestAnimationFrame(()=>{MTToolsMap.mount(document.getElementById('toolsOfflineSelectMap'),[],{statusNode:document.getElementById('toolsOfflineSelectStatus')});if(toolsOfflinePendingBounds)setTimeout(()=>MTToolsMap.drawBounds(toolsOfflinePendingBounds),0);});
  }
  else{toolsView='home';root.innerHTML=toolsHomeHtml();}
}
function bindToolsScreen(){
  const root=document.getElementById('toolsScreenRoot');
  root.addEventListener('click',event=>{
    const viewButton=event.target.closest('[data-tools-view]');if(viewButton){toolsNavigate(viewButton.dataset.toolsView);return;}
    const router=event.target.closest('[data-router-ip]');if(router){window.open(`http://${router.dataset.routerIp}`,'_blank','noopener');return;}
    const point=event.target.closest('.tools-network-open');if(point){toolsShowNetworkPoint(point.dataset.pointId);return;}
    const groupedPoint=event.target.closest('.tools-network-object');if(groupedPoint){toolsFocusNetworkPoint(groupedPoint.dataset.pointId);return;}
    const action=event.target.closest('[data-tools-action]')?.dataset.toolsAction;
    if(action==='quick-diagnostics')toolsOpenDiagnostics(null,'tools');
    else if(action==='run-diagnostics')runToolsDiagnostics();
    else if(action==='copy-diagnostics')toolsCopyDiagnostic();
    else if(action==='attach-diagnostics')toolsAttachDiagnostics();
    else if(action==='save-diagnostics')toolsSaveCurrentDiagnostic();
    else if(action==='reset-diagnostic-address')toolsResetDiagnosticAddress();
    else if(action==='run-speed-test')toolsRunSpeedTest();
    else if(action==='cancel-speed-test')toolsCancelSpeedTest();
    else if(action==='start-connection-check')toolsStartConnectionCheck();
    else if(action==='stop-connection-check')toolsStopConnectionCheck();
    else if(action==='return-to-ticket')toolsReturnToTicket();
    else if(action==='new-network-point')toolsOpenNetworkPointEditor();
    else if(action==='map-add-object')toolsStartMapAddMode();
    else if(action==='map-my-location')toolsLocateOnMap();
    else if(action==='map-toggle-fullscreen')toolsToggleMapFullscreen();
    else if(action==='map-add-at-location'&&toolsLastUserLocation)toolsStartMapAddMode(toolsLastUserLocation);
    else if(action==='map-use-online'){MTOfflineMap.setMode('online');renderToolsScreen('map');}
    else if(action==='map-bind-address')toolsBindAddressFromMap();
    else if(action==='select-offline-bounds')toolsStartOfflineBoundsSelection();
    else if(action==='save-offline-area')toolsSaveOfflineArea();
    else if(action==='show-offline-area')toolsShowOfflineArea(event.target.closest('[data-area-id]')?.dataset.areaId);
    else if(action==='open-offline-map')toolsOpenOfflineMap();
    else if(action==='edit-offline-area')toolsEditOfflineArea(event.target.closest('[data-area-id]')?.dataset.areaId);
    else if(action==='delete-offline-area')toolsDeleteOfflineArea(event.target.closest('[data-area-id]')?.dataset.areaId);
    else if(action==='import-offline-area')toolsImportOfflineArea(event.target.closest('[data-area-id]')?.dataset.areaId);
    else if(action==='export-offline-area')toolsExportOfflineArea(event.target.closest('[data-area-id]')?.dataset.areaId);
    else if(action==='offline-map-guide')toolsOpenOfflineMapGuide(event.target.closest('[data-area-id]')?.dataset.areaId||'');
    else if(action==='import-offline-map'){toolsOfflineImportAreaId='';document.getElementById('toolsOfflineMapFile')?.click();}
    else if(action==='delete-offline-map')toolsDeleteOfflineMap();
    else if(action==='offline-settings-back')appNavigationBack();
  });
  root.addEventListener('change',event=>{
    if(event.target.id==='toolsOfflineMapFile'){const file=event.target.files?.[0];event.target.value='';toolsPrepareOfflineMap(file);}
    if(event.target.id==='toolsMapBaseMode'){MTOfflineMap.setMode(event.target.value);renderToolsScreen(toolsView);}
  });
  root.addEventListener('toggle',event=>{const street=event.target.closest?.('[data-network-street]');if(street){street.open?toolsNetworkOpenStreets.add(street.dataset.networkStreet):toolsNetworkOpenStreets.delete(street.dataset.networkStreet);return;}const city=event.target.closest?.('[data-network-city]');if(city)city.open?toolsNetworkOpenCities.add(city.dataset.networkCity):toolsNetworkOpenCities.delete(city.dataset.networkCity);},true);
  root.addEventListener('input',event=>{if(event.target.id==='toolsNetworkSearch'){toolsNetworkSearch=event.target.value;renderToolsScreen('map');const input=document.getElementById('toolsNetworkSearch');input?.focus();input?.setSelectionRange(input.value.length,input.value.length);}});
  window.addEventListener('online',()=>{if(toolsView==='map'&&MTOfflineMap.getMode()==='auto'&&!MTToolsMap.handleConnectivityChange?.())renderToolsScreen('map');});
  window.addEventListener('offline',()=>{if(toolsView==='map'&&MTOfflineMap.getMode()==='auto'&&!MTToolsMap.handleConnectivityChange?.())renderToolsScreen('map');});
  document.getElementById('calcDiagnosticsBtn').addEventListener('click',openToolsDiagnosticsFromCalculator);
  document.getElementById('calcNetworkPointAddBtn')?.addEventListener('click',toolsOpenTicketNetworkPointPicker);
}
