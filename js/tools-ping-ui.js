/* Пінг: presentation and screen state. Session state lives here (a new-file
   owner per the tools extraction contract); tools-domain only renders this
   view and dispatches its actions. All probe/API-derived strings are escaped
   before they ever reach innerHTML. */
let toolsPingState=null; // {running, controller, last:{kind, target, result}}

function toolsPingHtml(){
  const st=toolsPingState||{};
  const running=!!st.running;
  return `${toolsBackButton()}
  <div class="card">
    <strong>Ціль перевірки</strong>
    <div class="field" style="margin-top:6px;"><input type="text" id="toolsPingTarget" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="1.1.1.1 або google.com" value="${escapeHtml(st.target||'')}"></div>
    <div class="tools-router-grid" style="margin-top:8px;">
      <button type="button" class="btn" data-tools-action="ping-preset" data-ping-preset="1.1.1.1">1.1.1.1</button>
      <button type="button" class="btn" data-tools-action="ping-preset" data-ping-preset="8.8.8.8">8.8.8.8</button>
      <button type="button" class="btn" data-tools-action="ping-preset" data-ping-preset="google.com">google.com</button>
    </div>
    ${running
      ?'<button type="button" class="btn btn-block" data-tools-action="ping-stop" style="margin-top:10px;">■ Зупинити</button>'
      :'<button type="button" class="btn btn-accent btn-block" data-tools-action="ping-start" style="margin-top:10px;">▶ Почати перевірку</button>'}
    <div class="tools-status-note" style="margin-top:8px;" id="toolsPingModeNote">${toolsPingModeNoteHtml(st)}</div>
  </div>
  <div id="toolsPingResults" style="margin-top:12px;">${toolsPingResultsHtml(st.last)}</div>
  <details class="card" style="margin-top:12px;">
    <summary class="tools-status-note">Деталі</summary>
    <div class="tools-status-note" style="margin-top:6px;">Зовнішня перевірка виконується через Globalping — мережу відкритих вузлів. Ціль перевірки бачать ці вузли. Локальна перевірка виконується безпосередньо з цього пристрою.</div>
    <div class="tools-status-note" style="margin-top:4px;">Для локальних адрес (192.168.x.x, 10.x.x.x) Android може запросити дозвіл на доступ до локальної мережі.</div>
  </details>`;
}
function toolsPingModeNoteHtml(st){
  if(st&&st.last&&st.last.kind==='local')return 'Локальна перевірка: цей телефон → пристрій у вашій мережі (Wi-Fi).';
  return 'Перевірка виконується із зовнішніх вузлів: результат показує, як ціль видно з інтернету.';
}

/* Rows and summary are built only from real API values — nothing is invented. */
function toolsPingResultsHtml(last){
  if(!last)return '<div class="card tools-status-card"><div class="tools-status-note">Перевірку ще не запускали.</div></div>';
  const result=last.result||{};
  if(!result.ok){
    const detail=result.detail?`<div class="tools-status-note" style="margin-top:4px;">Технічні подробиці: ${escapeHtml(String(result.detail).slice(0,160))}</div>`:'';
    return `<div class="card tools-status-card"><div class="tools-status-line"><span>${escapeHtml(last.target)}</span><strong>❌</strong></div><div class="tools-status-note" style="margin-top:6px;">${escapeHtml(result.error||'Не вдалося виконати перевірку')}</div>${detail}</div>`;
  }
  if(last.kind==='local'){
    const head=result.ok
      ?`<div class="tools-status-line"><span>Пристрій у мережі</span><strong>✅ Так</strong></div>
        <div class="tools-status-note" style="margin-top:6px;">Відгук: ~${Math.round(result.ms)} мс</div>`
      :'<div class="tools-status-line"><span>Пристрій у мережі</span><strong>❌ Не відповідає</strong></div>';
    return `<div class="card tools-status-card">${head}<div class="tools-status-note" style="margin-top:6px;">Перевірено з цього телефону. Це перевірка доступності пристрою, а не пакетний відгук мережі.</div></div>`;
  }
  const rows=(result.rows||[]).map(row=>{
    if(row.failed)return `<div class="tools-status-line"><span>${escapeHtml(row.label)}${row.where?` <span class="tools-status-note">· ${escapeHtml(row.where)}</span>`:''}</span><strong>— не відповів</strong></div>`;
    const loss=row.lossPct==null?'':` · втрати ${row.lossPct}%`;
    return `<div class="tools-status-line"><span>${escapeHtml(row.label)}${row.where?` <span class="tools-status-note">· ${escapeHtml(row.where)}</span>`:''}</span><strong>${Math.round(row.avgMs)} мс${loss}</strong></div>`;
  }).join('');
  const summary=result.summary?`<div class="tools-router-grid" style="margin-top:10px;">
      <div class="tools-status-note">Мін<br><strong style="font-size:15px;color:var(--text);">${Math.round(result.summary.minMs)} мс</strong></div>
      <div class="tools-status-note">Сер<br><strong style="font-size:15px;color:var(--text);">${Math.round(result.summary.avgMs)} мс</strong></div>
      <div class="tools-status-note">Макс<br><strong style="font-size:15px;color:var(--text);">${Math.round(result.summary.maxMs)} мс</strong></div>
      <div class="tools-status-note">Втрати<br><strong style="font-size:15px;color:var(--text);">${result.summary.lossPct}%</strong></div>
    </div>`:'';
  return `<div class="card tools-status-card">
      <div class="tools-status-line"><span>${escapeHtml(last.target)}</span><strong>${result.summary?'✅':'⚠️ частково'}</strong></div>
      ${rows}
      ${summary}
      <div class="tools-status-note" style="margin-top:8px;">Виміряно зовнішніми вузлами Globalping — не з цього телефону.</div>
    </div>`;
}

async function toolsPingStart(){
  if(toolsPingState&&toolsPingState.running)return;
  const input=document.getElementById('toolsPingTarget');
  const raw=input?input.value:'';
  const utils=typeof MTNetUtils!=='undefined'?MTNetUtils:null;
  const parsed=utils?utils.parseTargetInput(raw):{ok:false,error:'Службовий модуль недоступний'};
  if(!parsed.ok){showToast(parsed.error||'Некоректна адреса');return;}
  if(typeof navigator!=='undefined'&&navigator.onLine===false){showToast('Немає з\'єднання — перевірка потребує інтернету');return;}
  const controller=typeof AbortController==='function'?new AbortController():null;
  toolsPingState={running:true,controller,target:parsed.host,last:toolsPingState&&toolsPingState.last};
  renderToolsScreen('ping');
  const fetchImpl=(typeof fetch==='function')?fetch:null;
  /* run() валидирует сам — передаём сырой ввод, чтобы порт ( host:8080 ) дошёл до локальной проверки */
  const result=await MTPing.run(raw,{fetch:fetchImpl,signal:controller?controller.signal:null});
  const state=toolsPingState||{};
  toolsPingState={running:false,controller:null,target:parsed.host,last:{kind:parsed.local?'local':'external',target:parsed.host,result}};
  if(toolsPingViewActive()){
    renderToolsScreen('ping');
    if(result.ok)showToast('Перевірку завершено');
  }else if(state.controller){/* экран закрыли — результат дождётся возврата */}
}
function toolsPingStop(){
  if(toolsPingState&&toolsPingState.controller)toolsPingState.controller.abort();
  if(toolsPingState){toolsPingState.running=false;}
  if(toolsPingViewActive())renderToolsScreen('ping');
}
function toolsPingLeave(){
  if(toolsPingState&&toolsPingState.controller)toolsPingState.controller.abort();
  toolsPingState=toolsPingState?{running:false,controller:null,target:toolsPingState.target,last:toolsPingState.last}:null;
}
function toolsPingViewActive(){return typeof toolsView!=='undefined'&&toolsView==='ping';}
