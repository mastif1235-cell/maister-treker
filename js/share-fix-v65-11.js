/* Майстер-Трекер — Android/PWA share fix v65.0-security.11
   Деякі Android/PWA повертають false з navigator.canShare({files,...}),
   хоча прямий navigator.share() з тим самим File працює. Через це кнопка
   «Переслати» раніше одразу переходила до fallback і лише копіювала текст.
*/

const SHARE_FIX_RELEASE_LABEL = 'v65.0-security.11 · 2026-08-18';

async function shareFixBuildTicketFiles(ticket){
  const refs = (ticket && ticket.photos && ticket.photos.length)
    ? ticket.photos.slice(0,3)
    : (ticket && ticket.photo ? [ticket.photo] : []);
  const fallbackIds = (ticket && ticket.tgPhotoFileIds && ticket.tgPhotoFileIds.length)
    ? ticket.tgPhotoFileIds
    : (ticket && ticket.tgPhotoFileId ? [ticket.tgPhotoFileId] : []);
  const files = [];
  for(let i=0;i<refs.length;i++){
    try{
      const photoData = await resolvePhotoAsync(refs[i], fallbackIds[i] || (i===0 ? ticket.tgPhotoFileId : null));
      if(!photoData) continue;
      const blob = await (await fetch(photoData)).blob();
      files.push(new File([blob], `foto-${i+1}.jpg`, {type: blob.type || 'image/jpeg'}));
    }catch(e){ /* одне пошкоджене фото не повинно ламати весь share */ }
  }
  return files;
}

if(typeof shareTicket === 'function'){
  shareTicket = async function(id){
    const t = tickets.find(x=>String(x.id)===String(id));
    if(!t) return;
    const text = t.content || '';

    if(typeof navigator.share === 'function'){
      const files = await shareFixBuildTicketFiles(t);

      // Спочатку реально ПРОБУЄМО системний share з фото+текстом.
      // navigator.canShare тут не є воротарем: на Android він інколи дає
      // false-negative у PWA, хоча саме меню «Поділитися» чудово відкривається.
      if(files.length){
        try{
          await navigator.share({title:'Заявка', text, files});
          return;
        }catch(e){
          if(e && e.name === 'AbortError') return;
          // Якщо конкретний WebView не приймає files+text — нижче все одно
          // пробуємо звичайний системний share лише з текстом.
        }
      }

      try{
        await navigator.share({title:'Заявка', text});
        return;
      }catch(e){
        if(e && e.name === 'AbortError') return;
      }
    }

    // Лише справжній останній fallback, коли системний share не спрацював.
    try{
      await navigator.clipboard.writeText(text);
      showToast('Поділитися не вдалося — текст скопійовано в буфер');
    }catch(e){
      showToast('Не вдалося поділитися заявкою');
    }
  };
}

// Та сама логіка для кнопки «Надіслати» у формі нової/редагованої заявки.
if(typeof shareCurrentTicket === 'function'){
  shareCurrentTicket = async function(){
    syncFormToState();
    const text = getCurrentTicketText();
    if(!text){ showToast('Немає що надсилати — заповніть заявку'); return; }

    if(typeof navigator.share === 'function'){
      const refs = (calcState.photos && calcState.photos.length)
        ? calcState.photos.slice(0,3)
        : (calcState.photo ? [calcState.photo] : []);
      const tempTicket = {
        photos: refs,
        photo: refs[0] || null,
        tgPhotoFileIds: calcState.tgPhotoFileIds || [],
        tgPhotoFileId: calcState.tgPhotoFileId || null
      };
      const files = await shareFixBuildTicketFiles(tempTicket);
      if(files.length){
        try{
          await navigator.share({title:'Заявка', text, files});
          return;
        }catch(e){
          if(e && e.name === 'AbortError') return;
        }
      }
      try{
        await navigator.share({title:'Заявка', text});
        return;
      }catch(e){
        if(e && e.name === 'AbortError') return;
      }
    }

    try{
      await navigator.clipboard.writeText(text);
      showToast('Поділитися не вдалося — текст скопійовано в буфер');
    }catch(e){
      showToast('Не вдалося поділитися заявкою');
    }
  };
}

if(typeof renderSettingsScreen === 'function'){
  const shareFixPreviousRenderSettingsScreen = renderSettingsScreen;
  renderSettingsScreen = function(){
    const result = shareFixPreviousRenderSettingsScreen.apply(this, arguments);
    const label = document.getElementById('appVersionLabel');
    if(label) label.textContent = `Версія застосунку: ${SHARE_FIX_RELEASE_LABEL}`;
    return result;
  };
}
