'use strict';

/* Canonical Web Share, photo picker and clipboard workflows. */

function dispatcherForwardText(text){
  // Output boundary only: canonical ticket.content and structured data stay intact.
  const internal=/(?:^\s*(?:Технічна\s+діагностика|Історія\s+діагностик(?:и)?|Technical\s+diagnostics|Diagnostic\s+history|diagnostic(?:s|History))\s*[:：=]|\b(?:mapDebug|debugData|internalMap|fullDataJson|committedRevision)\b)/i;
  const mapUrl=/https?:\/\/(?:www\.)?(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps|openstreetmap\.org|yandex\.[a-z.]+\/maps|waze\.com)[^\s<>"']*/gi;
  const number='[-+]?\\d+(?:[.,]\\d+)?',boundary='(?<![\\p{L}\\p{N}_])';
  const separator='(?:\\s*[:：=]\\s*|\\s+)';
  const geoLabel='(?:geo(?:location)?|location|GPS|Geolocation|Coordinates|Геолокац(?:ія|ия)|Координат[иы]|lat\\s*/\\s*(?:lng|lon))';
  const geoPair=new RegExp(boundary+geoLabel+separator+number+'\\s*[,;/]\\s*'+number,'giu');
  const geoUrl=new RegExp(boundary+'(?:'+geoLabel+'|geoLink|Map\\s+link|Coordinates\\s+link|Посилання\\s+на\\s+карту|Ссылка\\s+на\\s+карту)'+separator+'https?://[^\\s<>"\']*','giu');
  const geoField=new RegExp(boundary+'(?:geo(?:Lat|Lng|Accuracy|Timestamp)|location(?:Accuracy|Timestamp)|latitude|longitude|lat|lng|lon)'+separator+number,'giu');
  const geoLink=new RegExp(boundary+'(?:geoLink|geoSource|locationSource)'+separator+'[^\\s,;]+','giu');
  const timing='(?:before|after|до|после|після)';
  const signalLabel='(?:onuSignal(?:Before|After)?|signal(?:Before|After)?|optical(?:Level|Power)|rxPower|txPower|(?:ONU|ОНУ)\\s*(?:signal|сигнал)|(?:Сигнал|Рівень|Уровень)\\s*(?:ONU|ОНУ)?|optical\\s+(?:level|signal|power))';
  const reading=number+'(?:\\s*dBm\\b)?';
  const signalFragment=new RegExp(boundary+signalLabel+'(?:\\s*'+timing+')?'+separator+reading+'(?:\\s*(?:[,;→/]|->|—|–)\\s*'+timing+separator+reading+')*','giu');
  const signalHeader=new RegExp('^[^\\p{L}\\p{N}]*'+signalLabel+'(?:\\s*'+timing+')?\\s*[:：=]\\s*$','iu');
  const geoHeader=new RegExp('^[^\\p{L}\\p{N}]*'+geoLabel+'\\s*[:：=]\\s*$','iu');
  const bareSignal=new RegExp('^\\s*'+reading+'\\s*$','iu');
  const barePair=new RegExp('^\\s*'+number+'\\s*[,;/]\\s*'+number+'\\s*$','u');
  const dbm=new RegExp(boundary+number+'\\s*dBm\\b','giu');
  // A marker lets us clean only separators left by removed fragments, not
  // arbitrary house numbers, negative values, money or unmarked numeric pairs.
  const removed='\uE000';
  let continuation='';
  return String(text||'').split(/\r?\n/).map(line=>{
    if(internal.test(line))return '';
    if(signalHeader.test(line)){continuation='signal';return '';}
    if(geoHeader.test(line)){continuation='geo';return '';}
    if(continuation==='signal'&&bareSignal.test(line)||continuation==='geo'&&barePair.test(line))return '';
    continuation='';
    const removeUrl=url=>removed+(/[;,]$/.test(url)?url.slice(-1):'');
    const cleaned=line.replace(geoUrl,removeUrl).replace(mapUrl,removeUrl)
      .replace(geoPair,removed).replace(geoField,removed).replace(geoLink,removed).replace(signalFragment,removed).replace(dbm,removed);
    if(cleaned===line)return line.trimEnd();
    const result=cleaned.replace(/(?:\s*[,;—–]\s*)?\uE000(?:\s*[,;—–]\s*\uE000)*/g,'')
      .replace(/^\s*[,;—–]\s*|\s*[,;—–]\s*$/g,'').replace(/:\s*[,;]\s*/g,': ')
      .replace(/[ \t]{2,}/g,' ').replace(/\s+([,;])/g,'$1').trim();
    return /[\p{L}\p{N}]/u.test(result)?result:'';
  }).filter(line=>line.trim()).join('\n').trim();
}

async function sharePickerBuildItems(ticket){
  const refs = (ticket && Array.isArray(ticket.photos) && ticket.photos.length)
    ? ticket.photos.slice(0,3)
    : (ticket && ticket.photo ? [ticket.photo] : []);
  const fallbackIds = (ticket && Array.isArray(ticket.tgPhotoFileIds) && ticket.tgPhotoFileIds.length)
    ? ticket.tgPhotoFileIds
    : (ticket && ticket.tgPhotoFileId ? [ticket.tgPhotoFileId] : []);
  const items = [];
  for(let i=0;i<refs.length;i++){
    try{
      const photoData = await resolvePhotoAsync(refs[i], fallbackIds[i] || (i===0 ? ticket.tgPhotoFileId : null));
      if(!photoData) continue;
      const blob = await photoSourceToBlob(photoData);
      const type = (blob.type && blob.type.startsWith('image/')) ? blob.type : 'image/jpeg';
      const ext = type.includes('png') ? 'png' : (type.includes('webp') ? 'webp' : 'jpg');
      const file = new File([blob], `zayavka-foto-${i+1}.${ext}`, {type});
      const previewUrl = URL.createObjectURL(file);
      items.push({file, previewUrl, sourceIndex:i});
    }catch(e){ /* пошкоджене/відсутнє фото просто пропускаємо */ }
  }
  return items;
}

async function sharePickerTextOnly(text){
  if(typeof navigator.share === 'function'){
    try{
      await navigator.share({title:'Заявка', text});
      return true;
    }catch(e){
      if(e && e.name === 'AbortError') return true;
    }
  }
  try{
    await navigator.clipboard.writeText(text);
    showToast('Поділитися недоступне — текст скопійовано');
  }catch(e){ showToast('Не вдалося поділитися заявкою'); }
  return false;
}

function shareMultiCleanup(items){
  (items||[]).forEach(x=>{ try{ URL.revokeObjectURL(x.previewUrl); }catch(e){} });
}

function shareMultiClose(items){
  shareMultiCleanup(items);
  closeModal();
}

async function openTicketSharePicker(text, ticket){
  text = dispatcherForwardText(text);
  if(!text){ showToast('Немає що надсилати'); return; }
  if(typeof navigator.share !== 'function'){
    await sharePickerTextOnly(text);
    return;
  }

  showToast('Готую фото для відправки…');
  const items = await sharePickerBuildItems(ticket || {});
  if(!items.length){
    await sharePickerTextOnly(text);
    return;
  }

  const rows = items.map((item, i)=>`
    <label style="display:flex; align-items:center; gap:12px; padding:10px; border:1px solid var(--border); border-radius:12px; margin-bottom:8px; background:var(--surface-2); cursor:pointer;">
      <input type="checkbox" class="share-photo-choice" data-i="${i}" checked style="width:22px; height:22px; flex:0 0 auto;">
      <img src="${item.previewUrl}" alt="Фото ${i+1}" style="width:76px; height:76px; object-fit:cover; border-radius:10px; flex:0 0 auto;">
      <div style="font-weight:700;">📷 Фото ${i+1}</div>
    </label>`).join('');

  openModal('📤 Переслати заявку', `
    <div style="font-size:13px; color:var(--text-dim); margin-bottom:10px;">
      ${items.length > 1 ? 'Оберіть фото, які потрібно додати до заявки.' : 'Фото вже підготовлено до відправки.'}
    </div>
    <div id="sharePhotoPickerList">${rows}</div>
    <div id="sharePhotoPickerCount" style="font-size:12.5px; color:var(--text-dim); margin:8px 0 12px;"></div>
    <button type="button" class="btn btn-accent btn-block" id="sharePhotoPickerSend">📤 Надіслати вибране</button>
    <button type="button" class="btn btn-block hidden" id="sharePhotoPickerFilesOnly" style="margin-top:8px;">📷 Надіслати фото (текст уже скопійовано)</button>
    <div id="sharePhotoPickerHint" style="font-size:12px; color:var(--text-dim); margin-top:10px;"></div>
  `, {
    // КРИТИЧНО: openModal використовує opts.onClose ЗАМІСТЬ closeModal,
    // тому тут потрібно не лише звільнити preview URL, а й реально закрити модалку.
    onClose:()=> shareMultiClose(items),
    onOpen:(body)=>{
      const sendBtn = body.querySelector('#sharePhotoPickerSend');
      const filesOnlyBtn = body.querySelector('#sharePhotoPickerFilesOnly');
      const hint = body.querySelector('#sharePhotoPickerHint');
      const count = body.querySelector('#sharePhotoPickerCount');
      const choices = ()=>[...body.querySelectorAll('.share-photo-choice')];
      const selectedFiles = ()=> choices().filter(c=>c.checked).map(c=>items[Number(c.dataset.i)]?.file).filter(Boolean);
      const updateCount = ()=>{
        const n = selectedFiles().length;
        count.textContent = n ? `Вибрано фото: ${n} з ${items.length}` : 'Фото не вибрано — буде надіслано лише текст';
      };
      choices().forEach(c=>c.addEventListener('change', updateCount));
      updateCount();

      sendBtn.addEventListener('click', async ()=>{
        const files = selectedFiles();
        if(!files.length){
          try{
            await navigator.share({title:'Заявка', text});
            shareMultiClose(items);
          }catch(e){
            if(!(e && e.name==='AbortError')) hint.textContent = 'Не вдалося відкрити системне меню.';
          }
          return;
        }

        // Один файл: Android/Telegram/Viber нормально приймають photo + text.
        if(files.length === 1){
          try{
            await navigator.share({title:'Заявка', text, files});
            shareMultiClose(items);
            return;
          }catch(e){
            if(e && e.name === 'AbortError') return;
            // Якщо конкретний WebView не приймає photo+text — підготуємо
            // надійний двокроковий fallback: текст у буфер, фото окремо.
            try{ navigator.clipboard.writeText(text); }catch(_){ }
            hint.textContent = 'Телефон не прийняв фото разом із текстом. Текст скопійовано — натисніть кнопку нижче, щоб передати фото.';
            filesOnlyBtn.classList.remove('hidden');
            sendBtn.classList.add('hidden');
            filesOnlyBtn._shareFiles = files;
            return;
          }
        }

        // 2-3 фото: НЕ додаємо text у Web Share payload. Це не баг нашої
        // заявки — Telegram і Viber самі по-різному розкладають multi-file
        // share з text. Передача лише files прибирає і втрату тексту в TG,
        // і дублювання тексту біля кожного фото у Viber. Текст кладемо в
        // буфер один раз — його достатньо вставити одним повідомленням.
        let copyStarted = false;
        try{
          navigator.clipboard.writeText(text);
          copyStarted = true;
        }catch(_){ }
        try{
          await navigator.share({title:'Фото заявки', files});
          shareMultiClose(items);
          showToast(copyStarted
            ? '📷 Фото передано. Текст заявки скопійовано — вставте його одним повідомленням.'
            : '📷 Фото передано. Текст автоматично скопіювати не вдалося.');
        }catch(e){
          if(e && e.name === 'AbortError') return;
          hint.textContent = 'Android не дозволив передати вибрані фото через системне меню.';
        }
      });

      filesOnlyBtn.addEventListener('click', async ()=>{
        const files = filesOnlyBtn._shareFiles || selectedFiles();
        if(!files.length) return;
        try{
          await navigator.share({title:'Фото заявки', files});
          shareMultiClose(items);
        }catch(e){
          if(!(e && e.name==='AbortError')) hint.textContent = 'Android не дозволив передати фото через системне меню.';
        }
      });
    }
  });
}

async function shareTicket(id){
  const ticket = tickets.find(x=>String(x.id)===String(id));
  if(!ticket) return;
  await openTicketSharePicker(dispatcherForwardText(ticket.content), ticket);
}

async function copyTicketText(){
  syncFormToState();
  const text = dispatcherForwardText(getCurrentTicketText()); // raw-mode uses the same output boundary
  try{
    await navigator.clipboard.writeText(text);
    showToast('Текст заявки скопійовано');
  }catch(e){
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); showToast('Текст заявки скопійовано'); }
    catch(e2){ showToast('Не вдалося скопіювати текст'); }
    ta.remove();
  }
}

async function sharePhoto(){
  const photos = calcState.photos && calcState.photos.length ? calcState.photos : (calcState.photo ? [calcState.photo] : []);
  if(!photos.length){ showToast('Спочатку додайте фото'); return; }
  if(!navigator.share){ showToast('Web Share API не підтримується цим браузером'); return; }
  try{
    // NEW: до 3 фото — резолвимо й пакуємо всі одразу в один виклик share()
    // (Web Share API 2-го рівня підтримує кілька файлів за раз)
    const files = [];
    const fallbackFileIds = (calcState.tgPhotoFileIds && calcState.tgPhotoFileIds.length)
      ? calcState.tgPhotoFileIds
      : (calcState.tgPhotoFileId ? [calcState.tgPhotoFileId] : []);
    for(let i=0;i<photos.length;i++){
      const fallbackId = fallbackFileIds[i] || null;
      const photoData = await resolvePhotoAsync(photos[i], fallbackId);
      if(!photoData) continue;
      const blob = await photoSourceToBlob(photoData);
      files.push(new File([blob], `foto${i+1}.jpg`, {type:'image/jpeg'}));
    }
    if(!files.length){ showToast('Не вдалося завантажити фото'); return; }
    if(navigator.canShare && !navigator.canShare({files})){
      showToast('Цей браузер не підтримує надсилання фото'); return;
    }
    await navigator.share({files, title:'Фото заявки'});
  }catch(e){
    if(e.name !== 'AbortError') showToast('Не вдалося надіслати фото');
  }
}

async function shareCurrentTicket(){
  syncFormToState();
  const text = dispatcherForwardText(getCurrentTicketText());
  if(!text){ showToast('Немає що надсилати — заповніть заявку'); return; }
  const refs = (calcState.photos && calcState.photos.length) ? calcState.photos.slice(0,3) : (calcState.photo ? [calcState.photo] : []);
  await openTicketSharePicker(text, {
    photos: refs,
    photo: refs[0] || null,
    tgPhotoFileIds: calcState.tgPhotoFileIds || [],
    tgPhotoFileId: calcState.tgPhotoFileId || null
  });
}
