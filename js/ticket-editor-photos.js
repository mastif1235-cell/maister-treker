/* Editor photo input and preview. Classic-script API; existing photo storage helpers are reused. */
function renderPhotoPreview(){
  const wrap = document.getElementById('photoPreviewWrap');
  const cameraBtn = document.getElementById('photoCameraBtn');
  const galleryBtn = document.getElementById('photoGalleryBtn');
  const photos = calcState.photos || [];
  wrap.innerHTML = photos.map((p, i)=>`
    <div class="photo-thumb-wrap">
      <img class="photo-thumb" id="photoPreview${i}" src="">
      <button type="button" class="photo-remove" data-idx="${i}">✕</button>
    </div>`).join('');
  const fallbackFileIds = (calcState.tgPhotoFileIds && calcState.tgPhotoFileIds.length)
    ? calcState.tgPhotoFileIds
    : (calcState.tgPhotoFileId ? [calcState.tgPhotoFileId] : []);
  photos.forEach((p, i)=>{
    const img = document.getElementById('photoPreview'+i);
    const fallbackId = fallbackFileIds[i] || null;
    const resolved = getPhotoCached(p, (val)=>{ if(img) img.src = val; }, fallbackId);
    if(img) img.src = resolved || '';
  });
  // NEW: два окремі входи — "Камера" (capture=environment, відкриває саме
  // камеру) і "Галерея" (multiple, без capture — вибір із наявних фото).
  // Раніше була одна кнопка з input[multiple], а на Android Chrome
  // атрибут multiple прибирає пункт "Камера" з системного вибору — тому
  // зняти фото прямо з застосунку не виходило, лишалась тільки галерея.
  const full = photos.length >= 3;
  if(cameraBtn){ cameraBtn.disabled = full; cameraBtn.textContent = full ? '📷 Максимум 3 фото' : '📷 Камера'; }
  if(galleryBtn){ galleryBtn.disabled = full; galleryBtn.textContent = full ? '🖼️ Максимум 3 фото' : `🖼️ Галерея${photos.length ? ` (${photos.length}/3)` : ''}`; }
}

function handlePhotoFile(file){
  if(!file) return;
  if(!calcState.photos) calcState.photos = [];
  if(calcState.photos.length >= 3){ showToast('Максимум 3 фото на заявку'); return; }
  const sessionAtStart = formSessionId; // NEW: знімок сеансу форми — див. коментар біля оголошення formSessionId
  const reader = new FileReader();
  reader.onload = (e)=>{
    const img = new Image();
    img.onload = ()=>{
      const maxW = 800;
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width*scale);
      canvas.height = Math.round(img.height*scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if(calcState.photos.length >= 3) return; // NEW: могли додати паралельно кілька файлів одразу — перевіряємо ще раз перед пушем
      const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      // NEW: раніше сире фото (сотні КБ у base64) лежало прямо в
      // calcState.photos, і кожні 30с автозбереження чернетки записувало
      // ЙОГО ЦІЛИКОМ у localStorage (ліміт ~5МБ). 2-3 фото за зміну легко
      // переповнювали сховище — JSON.stringify падав з QuotaExceededError,
      // яка гасилась порожнім catch(e){}, і чернетка (весь введений текст,
      // не лише фото) тихо переставала зберігатись, без жодного попередження.
      // Тепер фото одразу переносимо в IndexedDB (як і при остаточному
      // збереженні заявки — storePhoto) ДО того, як воно потрапить у
      // calcState.photos — запис в IndexedDB займає долі секунди, тож
      // затримка перед появою у прев'ю непомітна, зате чернетка в
      // localStorage завжди лишається легкою, незалежно від кількості й
      // розміру фото.
      storePhoto(dataUrl).then(key=>{
        if(!key) return;
        // NEW: поки йшов запис в IndexedDB, користувач міг скасувати заявку
        // або відкрити іншу (formSessionId змінився) — тоді calcState вже
        // зовсім ІНШИЙ об'єкт (не той, для якого фото знімали), і без цієї
        // перевірки фото "приліплювалось" би до чужої заявки. У такому
        // випадку просто видаляємо щойно записане фото з IndexedDB.
        if(formSessionId !== sessionAtStart){ deletePhotoKey(key); return; }
        if(calcState.photos.length >= 3){ deletePhotoKey(key); return; } // могли встигнути додати ще, поки це фото записувалось
        photoCacheSet(key, dataUrl); // одразу в кеш — прев'ю показується миттєво, без походу в IndexedDB
        calcState.photos.push(key);
        calcState.photo = calcState.photos[0]; // NEW: перше фото дублюється в старе поле photo — для коду, який ще читає лише його
        renderPhotoPreview();
      });
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

