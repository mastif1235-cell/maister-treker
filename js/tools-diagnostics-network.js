/* Browser speed diagnostics. Loaded after tools-domain.js. */
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
    toolsDiagnosticResult=MTToolsCore.mergeDiagnosticResults(network,speed);toolsDiagnosticRunAt=new Date();toolsSpeedStatus=speed.speedStatus==='success'?'Діагностику завершено':'Не вдалося виміряти швидкість';
  }finally{toolsSpeedController=null;if(toolsView==='diagnostics')renderToolsScreen('diagnostics');}
  if(toolsDiagnosticResult&&(toolsDiagnosticContext?.ticketId||toolsDiagnosticContext?.editorContext))await toolsSaveCurrentDiagnostic();
}
async function toolsRunSpeedTest(){
  if(toolsSpeedController)return;toolsSpeedController=new AbortController();toolsSpeedStatus='Підготовка…';renderToolsScreen('diagnostics');
  const labels={prepare:'Підготовка…',latency:'Відгук…',download:'Завантаження…',upload:'Відвантаження…',processing:'Обробка результатів…'};
  try{
    const result=await MTToolsCore.runBrowserSpeedTest({fetch,signal:toolsSpeedController.signal,requestTimeoutMs:7000,totalTimeoutMs:20000,onProgress:stage=>{toolsSpeedStatus=labels[stage]||'Вимірювання…';const node=document.getElementById('toolsSpeedStatus');if(node)node.textContent=toolsSpeedStatus;}});
    toolsDiagnosticResult=result;toolsDiagnosticRunAt=new Date();toolsDiagnosticSaved=false;
    toolsSpeedStatus=result.speedStatus==='success'?'Вимірювання завершено':result.speedStatus==='cancelled'?'Тест скасовано':'Не вдалося виміряти швидкість';
  }catch(_error){toolsSpeedStatus='Не вдалося виконати перевірку швидкості';}
  finally{toolsSpeedController=null;if(toolsView==='diagnostics')renderToolsScreen('diagnostics');}
  if(toolsView==='diagnostics'&&toolsDiagnosticResult?.speedStatus!=='cancelled'&&(toolsDiagnosticContext?.ticketId||toolsDiagnosticContext?.editorContext))await toolsSaveCurrentDiagnostic();
}
function toolsCancelSpeedTest(){if(!toolsSpeedController)return;toolsSpeedController?.abort();toolsSpeedStatus='Тест скасовується…';const node=document.getElementById('toolsSpeedStatus');if(node)node.textContent=toolsSpeedStatus;}
