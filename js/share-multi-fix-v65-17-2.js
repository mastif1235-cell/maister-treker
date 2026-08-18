/* Майстер-Трекер — multi-photo share regression fix v65.0-security.17.2
   Виправляє два практичні Android/PWA баги:
   1) Хрестик у модалці "Переслати заявку" не закривав її, бо custom onClose
      лише звільняв blob URL і не викликав closeModal().
   2) Telegram/Viber по-різному трактують Web Share payload text + кілька files:
      Telegram часто відкидає text, а Viber може дублювати text біля кожного
      фото. Для 2-3 фото тепер передаємо ТІЛЬКИ файли, а текст заявки кладемо
      в буфер обміну один раз. Для одного фото лишаємо звичний photo+text.
*/

const SHARE_MULTI_FIX_RELEASE_LABEL = 'v65.0-security.17.2 · 2026-08-18';

function shareMultiCleanup(items){
  (items||[]).forEach(x=>{ try{ URL.revokeObjectURL(x.previewUrl); }catch(e){} });
}

function shareMultiClose(items){
  shareMultiCleanup(items);
  closeModal();
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

if(typeof renderSettingsScreen === 'function'){
  const shareMultiPreviousRenderSettingsScreen = renderSettingsScreen;
  renderSettingsScreen = function(){
    const result = shareMultiPreviousRenderSettingsScreen.apply(this, arguments);
    const label = document.getElementById('appVersionLabel');
    if(label) label.textContent = `Версія застосунку: ${SHARE_MULTI_FIX_RELEASE_LABEL}`;
    return result;
  };
}
