/* One simple catalog region. Progress updates only these small DOM nodes:
   never remount the map or rerender tickets on a network chunk. */
let toolsOfflineDownloadSubscribed=false;
function toolsOfflineDownloadHtml(){return '<section class="card tools-offline-download" id="toolsOfflineDownloadCard" aria-label="Офлайн-карта"></section>';}
function toolsOfflineAccessHtml(){
  const access=mtOfflineMapTokenStatus();
  return `<div class="tools-offline-download-meta"><strong>Доступ до офлайн-карти</strong><br>${access.configured?(access.persistent?'✅ Доступ налаштовано':'Доступ лише в цій сесії. Після перезапуску введіть токен знову.'):'Введіть окремий токен цього телефону.'}</div><div class="tools-offline-download-actions"><button type="button" class="btn" data-tools-action="offline-download-token">${access.configured?'Замінити токен':'Ввести токен'}</button>${access.configured?'<button type="button" class="btn" data-tools-action="offline-download-token-delete">Видалити токен</button>':''}</div>`;
}
function toolsOfflineDownloadMessage(code){
  const accessErrors={DOWNLOAD_AUTH:'Немає доступу до карти. Введіть або замініть токен цього телефону.',DOWNLOAD_RATE_LIMIT:'Забагато запитів. Спробуйте продовжити через хвилину.',DOWNLOAD_TIMEOUT:'Сервер доступу не відповів вчасно. Спробуйте продовжити.'};
  if(accessErrors[code])return accessErrors[code];
  const messages={HOSTING_UNCONFIGURED:'Завантаження ще не налаштовано.',MANIFEST_UNAVAILABLE:'Не вдалося отримати опис карти. Встановлена карта працює без нього.',MANIFEST_INVALID:'Некоректний опис карти.',MANIFEST_URL:'Некоректна адреса карти.',DOWNLOAD_QUOTA:'Недостатньо вільного місця для офлайн-карти.',DOWNLOAD_UNSUPPORTED:'Цей браузер не підтримує потокову офлайн-карту. Доступний ручний імпорт у Налаштуваннях.',OPFS_SYNC_UNAVAILABLE:'Цей браузер не підтримує потоковий запис. Доступний ручний імпорт.',ALREADY_CURRENT:'Карта вже актуальна.',STOPPED:'Завантаження призупинено.',OFFLINE_MAP_BUSY:'Карта вже змінюється в іншій вкладці.',PARTIAL_MISSING:'Незавершений файл втрачено. Видаліть незавершене й завантажте знову.',RESUME_MANIFEST_CHANGED:'Версія карти змінилася. Видаліть незавершене й завантажте нову карту.',RESUME_STATUS:'Сервер не підтвердив продовження. Незавершений файл збережено.',RESUME_RANGE:'Сервер повернув некоректний діапазон. Незавершений файл збережено.',RESUME_CHANGED:'Файл на сервері змінився. Видаліть незавершене й завантажте знову.',DELETE_FAILED:'Не вдалося видалити карту.'};
  if(String(code).startsWith('INTEGRITY_'))return 'Не вдалося перевірити офлайн-карту. Попередня карта не змінена.';
  return messages[code]||(code?(navigator.onLine===false?'Немає мережі. Завантаження призупинено.':'Завантаження призупинено. Перевірте мережу та спробуйте продовжити.'): '');
}
function toolsUpdateOfflineDownloadUi(state=MTOfflineDownloader.snapshot()){
  const node=document.getElementById('toolsOfflineDownloadCard');if(!node)return;
  const item=MTOfflineMapCatalog[0],m=state.manifest,j=state.journal,active=state.active;
  const downloading=['checking','downloading','stopping','verifying'].includes(state.phase),ready=active?.mapId===item.id;
  const title=state.phase==='checking'?'Перевіряю доступність карти…':state.phase==='verifying'?'Перевірка офлайн-карти':state.phase==='downloading'?'Завантаження офлайн-карти':state.phase==='stopping'?'Зупиняю завантаження…':j?'Завантаження призупинено':ready?'✅ Офлайн-карта готова':'Офлайн-карта';
  const signature=JSON.stringify([state.phase,state.message,state.configured,state.busy,ready,active?.version,m?.version,!!j,state.quota,mtOfflineMapTokenStatus()]);
  if(node.dataset.signature!==signature){
    node.dataset.signature=signature;
    const button=(action,label,disabled=false)=>`<button type="button" class="btn" data-tools-action="${action}" ${disabled?'disabled':''}>${label}</button>`;
    let buttons=downloading?button('offline-download-stop','Зупинити',state.phase==='stopping'):j?`${button('offline-download-start','Продовжити',state.busy||state.phase==='broken'||!state.configured)}${button('offline-download-discard','Видалити незавершене')}`:ready?`${button('open-offline-map','Відкрити')}${button('offline-download-start','Оновити',!state.configured||!MTOfflineDownloader.supported())}${button('offline-download-delete','Видалити')}`:button('offline-download-start','Завантажити',!state.configured||!MTOfflineDownloader.supported());
    if(j&&active)buttons+=button('open-offline-map','Відкрити попередню карту');
    const date=ready?new Date(active.updatedAt||active.importedAt).toLocaleDateString('uk-UA'):'';
    node.innerHTML=`<strong role="status">${escapeHtml(title)}</strong><div class="tools-offline-download-title">${escapeHtml(m?.title||item.title)}</div><div class="tools-offline-download-meta">≈ ${((ready?active.size:m?.size||item.size)/1000000).toFixed(1)} МБ · Деталізація: до будинків${m?.version||active?.version?`<br>Версія: ${escapeHtml(m?.version||active.version)}`:''}${date?`<br>Оновлено: ${escapeHtml(date)}`:''}</div>${j?'<progress id="toolsOfflineDownloadProgress" max="100" value="0" aria-label="Прогрес завантаження"></progress><div id="toolsOfflineDownloadBytes"></div>':''}<div class="tools-offline-download-actions">${buttons}</div><div class="tools-offline-download-meta">${escapeHtml(!state.configured?'Завантаження ще не налаштовано.':toolsOfflineDownloadMessage(state.message))}</div>${state.quota?`<div class="tools-offline-download-meta">Потрібно із запасом: ${escapeHtml(MTOfflineMap.formatBytes(state.quota.required))}. ${state.quota.available===null?'Браузер не повідомив доступний обсяг.':`Орієнтовно доступно: ${escapeHtml(MTOfflineMap.formatBytes(state.quota.available))}.`} Оцінка браузера не гарантує фізично вільне місце.</div>`:''}<details class="tools-offline-more"><summary>Про карту</summary><div class="tools-offline-download-meta">${escapeHtml(m?.source||active?.source||'Protomaps / OpenStreetMap')} · ${escapeHtml(m?.license||active?.license||'ODbL')}<br>© OpenStreetMap contributors<br>Native Z${m?.minZoom??active?.header?.minZoom??0}–Z${m?.maxZoom??active?.header?.maxZoom??15}; показ до Z18 (overzoom, без нових деталей).<br>Після завантаження карта працює без інтернету, доки браузер зберігає її дані.</div></details>`;
  }
  if(!node.querySelector('[data-tools-action="offline-download-token"]'))node.insertAdjacentHTML('beforeend',toolsOfflineAccessHtml());
  if(j){
    const percent=Math.floor(j.downloadedBytes/j.totalSize*100);
    const progress=document.getElementById('toolsOfflineDownloadProgress');if(progress)progress.value=percent;
    const bytes=document.getElementById('toolsOfflineDownloadBytes');if(bytes)bytes.textContent=`${percent}% · ${(j.downloadedBytes/1000000).toFixed(1)} МБ / ${(j.totalSize/1000000).toFixed(1)} МБ`;
  }
}
function toolsInitOfflineDownloadUi(){
  if(!toolsOfflineDownloadSubscribed){toolsOfflineDownloadSubscribed=true;MTOfflineDownloader.subscribe(toolsUpdateOfflineDownloadUi);}
  toolsUpdateOfflineDownloadUi();void MTOfflineDownloader.refresh();
}
async function toolsOfflineDownloadAction(action){
  if(action==='offline-download-token'){
    openModal('Доступ до офлайн-карти','<div class="field"><label for="offlineMapTokenInput">Окремий токен цього телефону</label><input id="offlineMapTokenInput" type="password" autocomplete="off" spellcheck="false" maxlength="128" placeholder="Токен доступу"></div><p>Це не пароль застосунку і не токен AI. Токен не входить до резервних копій.</p><button type="button" class="btn btn-accent btn-block" id="offlineMapTokenSave">Зберегти</button>',{onOpen:()=>{
      document.getElementById('offlineMapTokenSave').onclick=async event=>{
        const button=event.currentTarget,input=document.getElementById('offlineMapTokenInput');button.disabled=true;
        try{if(!input.value.trim())throw new Error('MAP_TOKEN_INVALID');await mtOfflineMapTokenSet(input.value);input.value='';closeModal();toolsUpdateOfflineDownloadUi();}
        catch(error){input.value='';button.disabled=false;showToast(error.message==='MAP_TOKEN_INVALID'?'Некоректний токен доступу.':'Не вдалося змінити збережений токен. Спробуйте знову.');}
      };
    }});return;
  }
  if(action==='offline-download-token-delete'){
    if(!await openConfirmModal({title:'Видалити токен?',message:'Встановлена офлайн-карта залишиться доступною.',confirmLabel:'Видалити',danger:true}))return;
    try{await mtOfflineMapTokenSet('');toolsUpdateOfflineDownloadUi();}catch(_e){showToast('Не вдалося видалити збережений токен.');}return;
  }
  if(action==='offline-download-start'){void MTOfflineDownloader.start();return;}
  if(action==='offline-download-stop'){await MTOfflineDownloader.stop();return;}
  if(action==='offline-download-discard'){
    if(await openConfirmModal({title:'Видалити незавершене?',message:'Встановлена карта й інші дані залишаться.',confirmLabel:'Видалити',danger:true}))try{await MTOfflineDownloader.discard();}catch(_e){showToast('Не вдалося видалити незавершений файл');}return;
  }
  if(action==='offline-download-delete'&&await openConfirmModal({title:'Видалити офлайн-карту Дніпропетровської області?',message:'Заявки, точки, фото й налаштування залишаться.',confirmLabel:'Видалити',danger:true})){
    if(await MTOfflineDownloader.remove()){renderToolsScreen(toolsView);showToast('Офлайн-карту видалено');}else showToast('Не вдалося видалити офлайн-карту');
  }
}
