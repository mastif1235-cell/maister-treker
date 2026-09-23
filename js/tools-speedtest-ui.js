/* Speedtest: presentation and screen state. The Cloudflare engine only
   measures; everything drawn here is ours (own dial, own wording). Packet
   loss is intentionally absent — there is no honest source for it yet. */
let toolsSpeedtestState=null; // {running, handle, stage, liveMbps, last:{result}|null}

function toolsSpeedtestDialHtml(valueMbps,active){
  const radius=52,circumference=2*Math.PI*radius;
  const scale=Math.max(0,Math.min(1,Math.log10(1+Math.max(0,Number(valueMbps)||0))/Math.log10(1001))); // лог-шкала до 1000 Мбіт/с
  const offset=circumference*(1-scale);
  return `<svg viewBox="0 0 120 120" class="tools-speed-dial" role="img" aria-label="Індикатор швидкості">
    <circle cx="60" cy="60" r="${radius}" fill="none" stroke="var(--border)" stroke-width="8"></circle>
    <circle cx="60" cy="60" r="${radius}" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round"
      class="tools-speed-dial-arc" stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
      transform="rotate(-90 60 60)"></circle>
  </svg>`;
}

function toolsSpeedtestHtml(){
  const st=toolsSpeedtestState||{};
  const running=!!st.running;
  const value=st.liveMbps||((st.last&&st.last.result&&st.last.result.downloadMbps)||null);
  return `${toolsBackButton()}
  <div class="card" style="text-align:center;">
    ${toolsSpeedtestDialHtml(value,running)}
    <div style="margin-top:-84px;margin-bottom:52px;">
      <div id="toolsSpeedDialValue" style="font-size:34px;font-weight:700;">${value!=null?value:'—'}</div>
      <div class="tools-status-note">Мбіт/с</div>
    </div>
    <div id="toolsSpeedStage" class="tools-status-note" style="min-height:18px;">${escapeHtml(st.stage||(running?'Підготовка…':''))}</div>
    ${running
      ?'<button type="button" class="btn btn-block" data-tools-action="speed-stop" style="margin-top:10px;">■ Зупинити</button>'
      :'<button type="button" class="btn btn-accent btn-block" data-tools-action="speed-start" style="margin-top:10px;">▶ Почати тест</button>'}
  </div>
  <div id="toolsSpeedResults" style="margin-top:12px;">${toolsSpeedtestResultsHtml(st.last)}</div>
  <details class="card" style="margin-top:12px;">
    <summary class="tools-status-note">Деталі</summary>
    <div class="tools-status-note" style="margin-top:6px;">Тест виконується через мережу Cloudflare (speed.cloudflare.com): завантаження ~8 с і відвантаження ~6 с у кілька паралельних потоків, щоб стабільно вимірювати 100–1000 Мбіт/с. На швидких лініях може бути передано до ~400 МБ (отримано) і ~150 МБ (надіслано). Packet loss не вимірюється.</div>
  </details>`;
}

function toolsSpeedtestResultsHtml(last){
  if(!last)return '<div class="card tools-status-card"><div class="tools-status-note">Тест ще не запускався. Вимірювання виконується з цього телефону.</div></div>';
  const r=last.result||{};
  if(!r.downloadMbps&&!r.uploadMbps&&!r.latencyMs){
    const detail=r.detail?`<div class="tools-status-note" style="margin-top:4px;">Технічні подробиці: ${escapeHtml(String(r.detail).slice(0,160))}</div>`:'';
    return `<div class="card tools-status-card"><div class="tools-status-note">${escapeHtml(r.error||'Не вдалося виміряти швидкість')}</div>${detail}</div>`;
  }
  const row=(label,value,unit)=>value==null?'':`<div class="tools-status-line"><span>${label}</span><strong>${value} ${unit}</strong></div>`;
  const loaded=r.loadedLatencyMs!=null?row('Під навантаженням',r.loadedLatencyMs,'мс'):'';
  const partial=(r.warnings&&r.warnings.length&&r.ok==='partial')?`<div class="tools-status-note" style="margin-top:4px;">⚠️ ${escapeHtml(r.warnings.join('; '))} — решта метрик виміряна успішно.</div>`:'';
  const bytes=(r.bytesDown||r.bytesUp)?`<div class="tools-status-note" style="margin-top:4px;">Передано: ↓${Math.round((r.bytesDown||0)/1e6)} МБ / ↑${Math.round((r.bytesUp||0)/1e6)} МБ</div>`:'';
  return `<div class="card tools-status-card">
      ${row('Завантаження',r.downloadMbps,'Мбіт/с')}
      ${row('Відвантаження',r.uploadMbps,'Мбіт/с')}
      ${row('Відгук',r.latencyMs,'мс')}
      ${loaded}
      ${row('Стабільність',r.jitterMs,'мс')}
      ${partial}
      ${bytes}
      <div class="tools-status-note" style="margin-top:8px;">Вимірювання: Cloudflare (HTTPS, з цього телефону)</div>
    </div>
    <button type="button" class="btn btn-accent btn-block" data-tools-action="speed-start" style="margin-top:10px;">Повторити</button>`;
}

async function toolsSpeedtestStart(){
  if(toolsSpeedtestState&&toolsSpeedtestState.running)return;
  if(typeof navigator!=='undefined'&&navigator.onLine===false){showToast('Немає з\'єднання — тест потребує інтернету');return;}
  if(typeof MTSpeedtest==='undefined'){showToast('Не вдалося завантажити вимірювач');return;}
  toolsSpeedtestState={running:true,handle:null,stage:'Підготовка…',liveMbps:null,last:toolsSpeedtestState&&toolsSpeedtestState.last};
  if(toolsSpeedtestViewActive())renderToolsScreen('speedtest');
  try{
    const handle=await MTSpeedtest.create({
      onStage:(text,type)=>{const st=toolsSpeedtestState;if(!st)return;st.stage=text;if(toolsSpeedtestViewActive())toolsSpeedtestUpdateLive(null,text);},
      onLive:mbps=>{const st=toolsSpeedtestState;if(!st)return;st.liveMbps=mbps;if(toolsSpeedtestViewActive())toolsSpeedtestUpdateLive(mbps,null);},
      onFinish:result=>{
        const st=toolsSpeedtestState||{};
        toolsSpeedtestState={running:false,handle:null,stage:'Готово',liveMbps:null,last:{result}};
        if(toolsSpeedtestViewActive())renderToolsScreen('speedtest');
      },
      onError:message=>{
        const st=toolsSpeedtestState||{};
        toolsSpeedtestState={running:false,handle:null,stage:'',liveMbps:null,last:{result:{error:message||'Не вдалося виміряти швидкість'}}};
        if(toolsSpeedtestViewActive())renderToolsScreen('speedtest');
      }
    });
    const st=toolsSpeedtestState;
    if(!st||!st.running){handle.pause();return;} // пользователь ушёл/отменил во время подготовки
    st.handle=handle;
    handle.play();
  }catch(error){
    toolsSpeedtestState={running:false,handle:null,stage:'',liveMbps:null,last:{result:{error:'Не вдалося завантажити вимірювач',detail:String(error&&error.message||error)}}};
    if(toolsSpeedtestViewActive())renderToolsScreen('speedtest');
  }
}
function toolsSpeedtestStop(){
  const st=toolsSpeedtestState;
  if(st&&st.handle)st.handle.pause(); // незавершённый тест не превращается в результат (engine wrapper игнорирует onFinish после pause)
  toolsSpeedtestState={running:false,handle:null,stage:'',liveMbps:null,last:st?st.last:null};
  if(toolsSpeedtestViewActive())renderToolsScreen('speedtest');
}
function toolsSpeedtestLeave(){
  const st=toolsSpeedtestState;
  if(st&&st.running&&st.handle)st.handle.pause();
  if(st&&st.running)toolsSpeedtestState={running:false,handle:null,stage:'',liveMbps:null,last:st.last};
}
/* Точечные обновления во время теста — без перерисовки экрана. */
function toolsSpeedtestUpdateLive(mbps,stage){
  const dial=document.querySelector('#toolsScreenRoot .tools-speed-dial-arc');
  if(dial&&mbps!=null){
    const scale=Math.max(0,Math.min(1,Math.log10(1+Math.max(0,mbps))/Math.log10(1001)));
    const circumference=2*Math.PI*52;
    dial.style.strokeDashoffset=String(circumference*(1-scale));
  }
  if(mbps!=null){const valueNode=document.getElementById('toolsSpeedDialValue');if(valueNode)valueNode.textContent=String(mbps);}
  if(stage!=null){const stageNode=document.getElementById('toolsSpeedStage');if(stageNode)stageNode.textContent=stage;}
}
function toolsSpeedtestViewActive(){return typeof toolsView!=='undefined'&&toolsView==='speedtest';}
