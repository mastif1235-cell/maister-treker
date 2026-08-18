/* Майстер-Трекер — share photo picker v65.0-security.12
   Фото готуються ДО фінального натискання кнопки у модалці. Це дає
   navigator.share() свіжий user gesture на Android/PWA і дозволяє вибрати,
   які саме фото (1..3) відправляти разом із текстом заявки.
*/

const SHARE_PICKER_RELEASE_LABEL = 'v65.0-security.12 · 2026-08-18';

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
      const blob = await (await fetch(photoData)).blob();
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

async function openTicketSharePicker(text, ticket){
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
    onClose:()=> items.forEach(x=>{ try{ URL.revokeObjectURL(x.previewUrl); }catch(e){} }),
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

      // Важливо: файли вже готові. На цьому кліку navigator.share викликається
      // без читання IndexedDB/fetch перед ним — Android отримує свіжий gesture.
      sendBtn.addEventListener('click', async ()=>{
        const files = selectedFiles();
        if(!files.length){
          try{ await navigator.share({title:'Заявка', text}); closeModal(); }
          catch(e){ if(!(e && e.name==='AbortError')) hint.textContent = 'Не вдалося відкрити системне меню.'; }
          return;
        }
        try{
          await navigator.share({title:'Заявка', text, files});
          closeModal();
          return;
        }catch(e){
          if(e && e.name === 'AbortError') return;
          // На частині Android/WebView спільний payload text+files не
          // приймається. Не втрачаємо фото: даємо окремий свіжий клік для
          // file-only share, а текст кладемо в буфер для вставки у Viber.
          try{ await navigator.clipboard.writeText(text); }catch(_){ }
          hint.textContent = 'Телефон не прийняв фото разом із текстом. Текст скопійовано — натисніть кнопку нижче, щоб передати вибрані фото.';
          filesOnlyBtn.classList.remove('hidden');
          sendBtn.classList.add('hidden');
          filesOnlyBtn._shareFiles = files;
        }
      });

      filesOnlyBtn.addEventListener('click', async ()=>{
        const files = filesOnlyBtn._shareFiles || selectedFiles();
        if(!files.length) return;
        try{
          await navigator.share({title:'Фото заявки', files});
          closeModal();
        }catch(e){
          if(!(e && e.name==='AbortError')) hint.textContent = 'Android не дозволив передати фото через системне меню.';
        }
      });
    }
  });
}

if(typeof shareTicket === 'function'){
  shareTicket = async function(id){
    const t = tickets.find(x=>String(x.id)===String(id));
    if(!t) return;
    await openTicketSharePicker(t.content || '', t);
  };
}

if(typeof shareCurrentTicket === 'function'){
  shareCurrentTicket = async function(){
    syncFormToState();
    const text = getCurrentTicketText();
    if(!text){ showToast('Немає що надсилати — заповніть заявку'); return; }
    const refs = (calcState.photos && calcState.photos.length) ? calcState.photos.slice(0,3) : (calcState.photo ? [calcState.photo] : []);
    await openTicketSharePicker(text, {
      photos: refs,
      photo: refs[0] || null,
      tgPhotoFileIds: calcState.tgPhotoFileIds || [],
      tgPhotoFileId: calcState.tgPhotoFileId || null
    });
  };
}

if(typeof renderSettingsScreen === 'function'){
  const sharePickerPreviousRenderSettingsScreen = renderSettingsScreen;
  renderSettingsScreen = function(){
    const result = sharePickerPreviousRenderSettingsScreen.apply(this, arguments);
    const label = document.getElementById('appVersionLabel');
    if(label) label.textContent = `Версія застосунку: ${SHARE_PICKER_RELEASE_LABEL}`;
    return result;
  };
}
