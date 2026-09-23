/* Пінг: презентація і стан екрана. Головний режим — «Нагляд»: безперервні
   HTTPS-проби з цього телефону (~1/с) з live-журналом і статистикою сесії;
   пропадання інтернету лише рахується і НЕ зупиняє моніторинг. Разові
   перевірки (Globalping для довільних цілей, локальні пристрої) працюють
   як і раніше. Стан сесій живе тут; tools-domain лише рендерить екран. */
let toolsPingState=null;   // разові перевірки (external/local/direct one-shot)
let toolsPingMonitor=null; // сесія нагляду {running,controller,host,stats}

function toolsPingHtml(){
  const st=toolsPingState||{},mon=toolsPingMonitor||{};
  const running=!!mon.running||!!(st&&st.running); // «Зупинити» і під час разової перевірки
  const repeat=!running&&mon.host!=null;
  return `${toolsBackButton()}
  <div class="card">
    <strong>Ціль перевірки</strong>
    <div class="field" style="margin-top:6px;"><input type="text" id="toolsPingTarget" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="1.1.1.1 або google.com" value="${escapeHtml(st.target||mon.host||'')}"></div>
    <div class="tools-router-grid" style="margin-top:8px;">
      <button type="button" class="btn" data-tools-action="ping-preset" data-ping-preset="1.1.1.1">1.1.1.1</button>
      <button type="button" class="btn" data-tools-action="ping-preset" data-ping-preset="8.8.8.8">8.8.8.8</button>
      <button type="button" class="btn" data-tools-action="ping-preset" data-ping-preset="google.com">google.com</button>
    </div>
    <div id="toolsPingAction" style="margin-top:10px;">${toolsPingActionButtonHtml(running,repeat)}</div>
    ${mon.running?`<div class="tools-status-note" style="margin-top:8px;">Нагляд за <strong>${escapeHtml(mon.host)}</strong> — орієнтовно раз на секунду.</div>`:''}
  </div>
  <div class="card" style="margin-top:12px;">
    <div id="toolsPingStats">${toolsPingStatsHtml(mon.stats)}</div>
  </div>
  <div class="card" style="margin-top:12px;">
    <div id="toolsPingLog" class="tools-ping-log" aria-live="polite"></div>
  </div>
  <div id="toolsPingResults" style="margin-top:12px;">${toolsPingResultsHtml(st.last)}</div>
  <details class="card" style="margin-top:12px;">
    <summary class="tools-status-note">Деталі</summary>
    <div class="tools-status-note" style="margin-top:6px;">Пресетні цілі (1.1.1.1, 8.8.8.8, google.com тощо) перевіряються безперервно з цього телефону через HTTPS: це перевірка доступності, а не ICMP-пінг; час у рядку — час відповіді сервера.</div>
    <div class="tools-status-note" style="margin-top:4px;">Зовнішня перевірка довільних цілей виконується через Globalping — мережу відкритих вузлів. Ціль перевірки бачать ці вузли.</div>
    <div class="tools-status-note" style="margin-top:4px;">Для локальних адрес (192.168.x.x, 10.x.x.x) Android може запросити дозвіл на доступ до локальної мережі.</div>
  </details>`;
}
function toolsPingActionButtonHtml(running,repeat){
  if(running)return '<button type="button" class="btn btn-block" data-tools-action="ping-stop">■ Зупинити</button>';
  return `<button type="button" class="btn btn-accent btn-block" data-tools-action="ping-start">${repeat?'▶ Почати знову':'▶ Почати моніторинг'}</button>`;
}

/* Статистика всієї сесії (усі спроби від старту, навіть ті, чиї рядки вже
   прибрані з журналу). Min/avg/max — тільки по успішних відповідях. */
function toolsPingStatsHtml(stats){
  if(!stats)return '<div class="tools-status-note">Моніторинг ще не запускався. Виберіть ціль і натисніть «Почати моніторинг» — відповіді з’являтимуться у журналі приблизно раз на секунду.</div>';
  const cell=(label,value)=>`<div class="tools-status-note">${label}<br><strong style="font-size:15px;color:var(--text);">${value}</strong></div>`;
  return `<div class="tools-router-grid">
      ${cell('Перевірок',stats.total)}
      ${cell('Успішних',stats.success)}
      ${cell('Без відповіді',stats.failed)}
      ${cell('Втрати',stats.lossPct+'%')}
      ${cell('Мін',stats.minMs==null?'—':stats.minMs+' мс')}
      ${cell('Сер',stats.avgMs==null?'—':stats.avgMs+' мс')}
      ${cell('Макс',stats.maxMs==null?'—':stats.maxMs+' мс')}
    </div>`;
}

/* Live-журнал: рядок з'являється одразу після спроби; у DOM тримаємо останні
   ~100 рядків (старі прибираємо), автоскрол працює лише коли читач унизу. */
function toolsPingLogCap(logEl,max){
  let removed=0;
  while(logEl.children.length>max){logEl.removeChild(logEl.firstChild);removed++;}
  return removed;
}
function toolsPingLogShouldStick(logEl){
  return logEl.scrollTop+logEl.clientHeight>=logEl.scrollHeight-40;
}
function toolsPingMonitorAppendRow(logEl,host,entry){
  const stick=logEl.children.length===0||toolsPingLogShouldStick(logEl);
  const line=document.createElement('div');
  line.className='tools-ping-line '+(entry.ok?(entry.ms>=MTPing.MONITOR_SLOW_MS?'tools-ping-slow':'tools-ping-ok'):'tools-ping-fail');
  line.textContent=entry.ok?('#'+entry.seq+' Відповідь від '+host+': '+entry.ms+' мс'):('#'+entry.seq+' Немає відповіді');
  logEl.appendChild(line);
  toolsPingLogCap(logEl,100);
  if(stick)logEl.scrollTop=logEl.scrollHeight;
}

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
  if(last.kind==='direct'){
    if(!result.ok){
      const detail=result.detail?`<div class="tools-status-note" style="margin-top:4px;">Технічні подробиці: ${escapeHtml(String(result.detail).slice(0,160))}</div>`:'';
      return `<div class="card tools-status-card"><div class="tools-status-line"><span>${escapeHtml(last.target)}</span><strong>❌</strong></div><div class="tools-status-note" style="margin-top:6px;">${escapeHtml(result.error||'Ціль не відповіла')}</div>${detail}<div class="tools-status-note" style="margin-top:6px;">HTTPS-перевірка з цього телефону (не ICMP-пінг).</div></div>`;
    }
    const failed=result.attempts-result.success;
    return `<div class="card tools-status-card">
      <div class="tools-status-line"><span>${escapeHtml(last.target)}</span><strong>✅ Доступний</strong></div>
      <div class="tools-status-note" style="margin-top:4px;">Успішних спроб: ${result.success}/${result.attempts}${failed?` (без відповіді: ${failed})`:''}</div>
      <div class="tools-router-grid" style="margin-top:10px;">
        <div class="tools-status-note">Мін<br><strong style="font-size:15px;color:var(--text);">${Math.round(result.minMs)} мс</strong></div>
        <div class="tools-status-note">Сер<br><strong style="font-size:15px;color:var(--text);">${Math.round(result.avgMs)} мс</strong></div>
        <div class="tools-status-note">Макс<br><strong style="font-size:15px;color:var(--text);">${Math.round(result.maxMs)} мс</strong></div>
      </div>
      <div class="tools-status-note" style="margin-top:8px;">HTTPS-перевірка з цього телефону — час відповіді сервера, не ICMP-пінг.</div>
    </div>`;
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

function toolsPingMonitorStart(host){
  if(toolsPingMonitor&&toolsPingMonitor.running)return;
  if(typeof MTPing==='undefined'||typeof MTPing.runMonitor!=='function'){showToast('Службовий модуль недоступний');return;}
  /* Нова сесія нагляду — чистий екран: one-shot-стан нейтралізуємо, щоб стара
     ціль/результат разової перевірки не змішувалися з новим моніторингом
     (поле показує host монітора, стара картка результату не показується). */
  const st1=toolsPingState;
  if(st1&&st1.running&&st1.controller)st1.controller.abort(); // на випадок залишеної разової перевірки
  toolsPingState={running:false,controller:null,target:host,last:null};
  const controller=typeof AbortController==='function'?new AbortController():null;
  toolsPingMonitor={running:true,controller,host,stats:MTPing.createMonitorStats()};
  if(toolsPingViewActive())renderToolsScreen('ping'); // нова чиста сесія: порожній журнал, нульова статистика
  const logEl=document.getElementById('toolsPingLog'),statsEl=document.getElementById('toolsPingStats');
  MTPing.runMonitor(host,{
    fetch:(typeof fetch==='function')?fetch:undefined, // vm/тести: той самий глобальний fetch, що бачить UI
    signal:controller?controller.signal:null,
    intervalMs:MTPing.MONITOR_INTERVAL_MS,
    timeoutMs:MTPing.MONITOR_TIMEOUT_MS,
    onAttempt:entry=>{
      const st=toolsPingMonitor;
      if(!st||st.controller!==controller)return; // застаріла сесія після Stop
      st.stats=entry.stats;
      if(logEl)toolsPingMonitorAppendRow(logEl,st.host,entry);
      if(statsEl)statsEl.innerHTML=toolsPingStatsHtml(entry.stats);
    }
  }).then(()=>{
    const st=toolsPingMonitor;
    if(st&&st.controller===controller){st.running=false;st.controller=null;toolsPingRefreshAction();}
  });
}
/* Оновлюємо лише кнопку — журнал і статистика лишаються на екрані. */
function toolsPingRefreshAction(){
  const container=document.getElementById('toolsPingAction');
  if(container)container.innerHTML=toolsPingActionButtonHtml(!!(toolsPingMonitor&&toolsPingMonitor.running),!!(toolsPingMonitor&&toolsPingMonitor.host));
}
function toolsPingStopMonitor(){
  const st=toolsPingMonitor;
  if(st&&st.running&&st.controller)st.controller.abort(); // миттєво: цикл і поточна проба
  if(st){st.running=false;st.controller=null;}
  if(toolsPingViewActive())toolsPingRefreshAction();
}

async function toolsPingStart(){
  if(toolsPingMonitor&&toolsPingMonitor.running)return;
  const input=document.getElementById('toolsPingTarget');
  const raw=input?input.value:'';
  const utils=typeof MTNetUtils!=='undefined'?MTNetUtils:null;
  const parsed=utils?utils.parseTargetInput(raw):{ok:false,error:'Службовий модуль недоступний'};
  if(!parsed.ok){showToast(parsed.error||'Некоректна адреса');return;}
  const directHosts=typeof MTPing!=='undefined'&&MTPing.DIRECT_HOSTS?MTPing.DIRECT_HOSTS:null;
  if(!parsed.local&&directHosts&&Object.prototype.hasOwnProperty.call(directHosts,parsed.host)){
    toolsPingMonitorStart(parsed.host); // безперервний нагляд
    return;
  }
  await toolsPingRunOnce(raw,parsed); // локальні та довільні публічні цілі — як раніше
}
async function toolsPingRunOnce(raw,parsed){
  if(typeof navigator!=='undefined'&&navigator.onLine===false){showToast('Немає з\'єднання — перевірка потребує інтернету');return;}
  /* Разова перевірка деактивує відображуваний стан старого нагляду (host/stats),
     щоб завершений моніторинг не впливав на one-shot UI і кнопку Stop. */
  toolsPingMonitor={running:false,controller:null,host:null,stats:null};
  const controller=typeof AbortController==='function'?new AbortController():null;
  toolsPingState={running:true,controller,target:parsed.host,last:toolsPingState&&toolsPingState.last};
  renderToolsScreen('ping');
  const fetchImpl=(typeof fetch==='function')?fetch:null;
  /* run() валидирует сам — передаём сырой ввод, чтобы порт ( host:8080 ) дошёл до локальной проверки */
  const result=await MTPing.run(raw,{fetch:fetchImpl,signal:controller?controller.signal:null});
  if(!toolsPingState||toolsPingState.controller!==controller)return; // сесію замінено (старт монітора) — не перезаписуємо
  toolsPingState={running:false,controller:null,target:parsed.host,last:{kind:parsed.local?'local':(result.kind==='direct'?'direct':'external'),target:parsed.host,result}};
  if(toolsPingViewActive()){
    renderToolsScreen('ping');
    if(result.ok)showToast('Перевірку завершено');
  }
  /* екран закрили (leave) або сесію замінили — результат просто не малюємо */
}
function toolsPingStop(){
  /* Stop діє на РЕАЛЬНО активну операцію, а не на залишковий стан:
     активний one-shot → перерисовка one-shot UI; активний нагляд → лише
     кнопка (журнал і статистика лишаються). Старий mon.host сам по собі
     вибір гілки не визначає. */
  const st=toolsPingState;
  const mon=toolsPingMonitor;
  if(st&&st.running&&st.controller){ // зараз іде разова перевірка
    st.controller.abort();
    st.running=false;
    if(toolsPingViewActive())renderToolsScreen('ping');
    return;
  }
  if(mon&&mon.running&&mon.controller){ // зараз іде нагляд
    mon.controller.abort(); // миттєво: цикл і поточна проба
    mon.running=false;mon.controller=null;
    if(toolsPingViewActive())toolsPingRefreshAction();
    return;
  }
  if(toolsPingViewActive())renderToolsScreen('ping'); // нічого активного — нормалізуємо екран
}
function toolsPingMonitorState(){return toolsPingMonitor;} // доступ для тестів/діагностики (у браузері — теж глобальна функція)
function toolsPingOneShotState(){return toolsPingState;} // доступ для тестів/діагностики

function toolsPingLeave(){
  if(toolsPingState&&toolsPingState.controller)toolsPingState.controller.abort();
  toolsPingState=toolsPingState?{running:false,controller:null,target:toolsPingState.target,last:toolsPingState.last}:null;
  const mon=toolsPingMonitor;
  if(mon&&mon.running&&mon.controller)mon.controller.abort(); // закриття екрана зупиняє нагляд
  if(mon){mon.running=false;mon.controller=null;}
}
function toolsPingViewActive(){return typeof toolsView!=='undefined'&&toolsView==='ping';}
