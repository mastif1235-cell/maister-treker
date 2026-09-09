/* Connection checks and browser speed diagnostics. Loaded after tools-domain.js. */
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
  if(toolsSpeedController)return;
  const button=document.getElementById('toolsRunDiagnosticsBtn');
  toolsSpeedController=new AbortController();toolsSpeedStatus='Перевірка інтернету…';toolsDiagnosticSaved=false;
  if(button){button.disabled=true;button.textContent='⏳ Повна діагностика…';}
  try{
    const network=await MTToolsCore.runBrowserDiagnostics({fetch,timeoutMs:5000,now:()=>performance.now(),navigatorOnline:navigator.onLine});
    if(toolsSpeedController.signal.aborted)return;
    const labels={prepare:'Підготовка оцінки швидкості…',latency:'Відгук…',download:'Швидкість завантаження…',upload:'Швидкість відвантаження…',processing:'Обробка результатів…'};
    let speed;
    try{speed=await MTToolsCore.runBrowserSpeedTest({fetch,signal:toolsSpeedController.signal,requestTimeoutMs:7000,totalTimeoutMs:20000,onProgress:stage=>{toolsSpeedStatus=labels[stage]||'Браузерна оцінка швидкості…';const node=document.getElementById('toolsSpeedStatus');if(node)node.textContent=toolsSpeedStatus;}});}
    catch(_error){speed={speedStatus:'error',summaryStatus:'warning',resources:[{label:'Браузерна оцінка швидкості',ok:false,state:'unavailable',detail:'Вимірювання недоступне'}]};}
    if(toolsSpeedController.signal.aborted||speed.speedStatus==='cancelled')return;
    toolsDiagnosticResult=MTToolsCore.mergeDiagnosticResults(network,speed);toolsDiagnosticRunAt=new Date();toolsSpeedStatus=speed.speedStatus==='success'?'✅ Повну діагностику завершено':'⚠ Діагностику збережено без частини даних швидкості';
  }finally{toolsSpeedController=null;if(toolsView==='diagnostics')renderToolsScreen('diagnostics');}
  if(toolsDiagnosticResult&&(toolsDiagnosticContext?.ticketId||toolsDiagnosticContext?.editorContext))await toolsSaveCurrentDiagnostic();
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
function toolsCancelSpeedTest(){if(!toolsSpeedController)return;toolsSpeedController?.abort();toolsSpeedStatus='Тест скасовується…';const node=document.getElementById('toolsSpeedStatus');if(node)node.textContent=toolsSpeedStatus;}
