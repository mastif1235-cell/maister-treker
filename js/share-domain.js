/* Canonical Web Share and clipboard workflows. */

async function shareTicket(id){
  const t = tickets.find(x=>String(x.id)===String(id)); if(!t) return; // NEW
  const text = t.content || '';
  try{
    const photoData = t.photo ? await resolvePhotoAsync(t.photo, t.tgPhotoFileId) : null;
    if(photoData){
      const res = await fetch(photoData);
      const blob = await res.blob();
      const file = new File([blob], 'foto.jpg', {type:'image/jpeg'});
      if(navigator.canShare && navigator.canShare({files:[file], text})){
        await navigator.share({title:'Заявка', text, files:[file]});
        return;
      }
    }
    if(navigator.share){
      await navigator.share({title:'Заявка', text});
      return;
    }
    throw new Error('share-unsupported');
  }catch(e){
    if(e.name==='AbortError') return; // користувач сам закрив меню «Поділитися»
    try{
      await navigator.clipboard.writeText(text);
      showToast(t.photo ? 'Поділитися фото з текстом тут недоступне — текст скопійовано, фото додайте в Viber вручну' : 'Поділитися недоступне — текст скопійовано');
    }catch(e2){ showToast('Не вдалося поділитися заявкою'); }
  }
}

async function copyTicketText(){
  syncFormToState();
  const text = getCurrentTicketText(); // NEW: враховує raw-режим
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
      const res = await fetch(photoData);
      const blob = await res.blob();
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

/* ---- Збереження / оновлення заявки ---- */

async function shareCurrentTicket(){
  // Працює навіть якщо заявку ще не збережено — рахуємо суму й текст
  // прямо з поточної форми, як для копіювання, а не з уже збереженого списку.
  syncFormToState();
  const text = getCurrentTicketText(); // NEW: враховує raw-режим
  if(!text){ showToast('Немає що надсилати — заповніть заявку'); return; }
  try{
    const photoData = calcState.photo ? await resolvePhotoAsync(calcState.photo, calcState.tgPhotoFileId) : null;
    if(photoData){
      const res = await fetch(photoData);
      const blob = await res.blob();
      const file = new File([blob], 'foto.jpg', {type:'image/jpeg'});
      if(navigator.canShare && navigator.canShare({files:[file], text})){
        await navigator.share({title:'Заявка', text, files:[file]});
        return;
      }
    }
    if(navigator.share){
      await navigator.share({title:'Заявка', text});
      return;
    }
    throw new Error('share-unsupported');
  }catch(e){
    if(e.name==='AbortError') return; // користувач сам закрив меню «Поділитися»
    try{
      await navigator.clipboard.writeText(text);
      showToast('Поділитися недоступне — текст скопійовано');
    }catch(_){
      showToast('Не вдалося поділитися заявкою');
    }
  }
}

