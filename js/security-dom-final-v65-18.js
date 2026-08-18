/* Майстер-Трекер — final DOM/photo sink hardening v65.0-security.17.1
   Окремий клієнтський регрес-фікс перед міграцією Google HMAC security.18.

   Закриває залишкові місця, де зовнішні/імпортовані значення могли потрапити
   в innerHTML без достатньої нормалізації:
   - BarcodeDetector rawValue (QR/штрих-код може містити довільний текст);
   - geoLink label у калькуляторі;
   - shift id, що може прийти з вручну зміненої Google-таблиці;
   - legacy photo refs перед вставкою в <img src="...">.
*/

const SECURITY_DOM_FINAL_RELEASE_LABEL = 'v65.0-security.17.2 · 2026-08-18';
const SECURITY_DOM_MAX_PHOTO_URL_CHARS = 16 * 1024 * 1024;
const SECURITY_DOM_SAFE_DATA_IMAGE_RE = /^data:image\/(?:jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;
const SECURITY_DOM_SAFE_IDB_PHOTO_RE = /^idb:[A-Za-z0-9._:-]{1,220}$/;

function securityDomSafePhotoRef(value){
  const v=String(value||'');
  if(!v) return '';
  if(SECURITY_DOM_SAFE_IDB_PHOTO_RE.test(v)) return v;
  if(v.length<=SECURITY_DOM_MAX_PHOTO_URL_CHARS && SECURITY_DOM_SAFE_DATA_IMAGE_RE.test(v)) return v;
  return '';
}

function securityDomSafeResolvedPhoto(value){
  const v=String(value||'');
  if(!v) return null;
  if(v.length<=SECURITY_DOM_MAX_PHOTO_URL_CHARS && SECURITY_DOM_SAFE_DATA_IMAGE_RE.test(v)) return v;
  try{
    const u=new URL(v,location.href);
    if(u.protocol==='blob:' && u.origin===location.origin) return v;
  }catch(e){}
  return null;
}

if(typeof securityRuntimeSanitizeTicket==='function'){
  const securityDomPreviousSanitizeTicket=securityRuntimeSanitizeTicket;
  securityRuntimeSanitizeTicket=function(ticket,index){
    const t=securityDomPreviousSanitizeTicket(ticket,index);
    if('photo' in t) t.photo=securityDomSafePhotoRef(t.photo) || null;
    if(Array.isArray(t.photos)) t.photos=t.photos.map(securityDomSafePhotoRef).filter(Boolean).slice(0,3);
    if('tgPhotoFileId' in t) t.tgPhotoFileId=String(t.tgPhotoFileId||'').slice(0,512);
    if(Array.isArray(t.tgPhotoFileIds)) t.tgPhotoFileIds=t.tgPhotoFileIds.map(v=>String(v||'').slice(0,512)).filter(Boolean).slice(0,3);
    return t;
  };
}

if(typeof resolvePhotoAsync==='function'){
  const securityDomPreviousResolvePhotoAsync=resolvePhotoAsync;
  resolvePhotoAsync=async function(photoKey,tgFallbackFileId){
    const value=await securityDomPreviousResolvePhotoAsync(photoKey,tgFallbackFileId);
    return securityDomSafeResolvedPhoto(value);
  };
}
if(typeof getPhotoCached==='function'){
  const securityDomPreviousGetPhotoCached=getPhotoCached;
  getPhotoCached=function(photoKey,onLoaded,tgFallbackFileId){
    const safeKey=securityDomSafePhotoRef(photoKey);
    if(!safeKey) return null;
    const wrapped=typeof onLoaded==='function'
      ? (value)=>{ const safe=securityDomSafeResolvedPhoto(value); if(safe) onLoaded(safe); }
      : null;
    const value=securityDomPreviousGetPhotoCached(safeKey,wrapped,tgFallbackFileId);
    return securityDomSafeResolvedPhoto(value);
  };
}

if(typeof startMacScan==='function'){
  startMacScan=async function(){
    const modal=document.getElementById('macScanModal');
    const video=document.getElementById('macScanVideo');
    const results=document.getElementById('macScanResults');
    if(!modal || !video || !results) return;
    results.replaceChildren();
    macScanSeen=new Map();

    if(!('BarcodeDetector' in window)){
      showToast('Камера-сканер не підтримується цим браузером — введіть MAC вручну');
      return;
    }
    try{
      macScanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    }catch(e){
      showToast('Не вдалося відкрити камеру');
      return;
    }

    video.srcObject=macScanStream;
    modal.classList.remove('hidden');
    let detector;
    try{
      detector=new BarcodeDetector({formats:['code_128','code_39','code_93','codabar','itf','ean_13','ean_8','upc_a','upc_e','qr_code','data_matrix','pdf417']});
    }catch(e){ detector=new BarcodeDetector(); }

    const addResultButton=(rawValue)=>{
      const raw=String(rawValue||'').slice(0,512);
      if(!raw || macScanSeen.has(raw)) return;
      const mac=String(normalizeMac(raw)||'').slice(0,64);
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='btn btn-block';
      btn.style.textAlign='left';

      const main=document.createElement('div');
      main.style.fontWeight='700';
      main.textContent=mac;
      const sub=document.createElement('div');
      sub.style.fontSize='11.5px';
      sub.style.color='var(--text-dim)';
      sub.textContent='як відскановано: '+raw;
      btn.append(main,sub);

      btn.addEventListener('click',()=>{
        const input=document.getElementById('f_mac');
        if(input) input.value=mac;
        showToast(`Обрано: ${mac}`);
        stopMacScan();
      });
      macScanSeen.set(raw,btn);
      results.appendChild(btn);
    };

    const scanFrame=async()=>{
      if(!macScanStream) return;
      try{
        const codes=await detector.detect(video);
        (codes||[]).forEach(c=>{ if(c && c.rawValue) addResultButton(c.rawValue); });
      }catch(e){ /* невдалий кадр — пробуємо наступний */ }
      macScanRAF=requestAnimationFrame(scanFrame);
    };
    macScanRAF=requestAnimationFrame(scanFrame);
  };
}

if(typeof renderGeoBadge==='function'){
  renderGeoBadge=function(){
    const badge=document.getElementById('geoBadge');
    const linkEl=document.getElementById('geoLink');
    const btn=document.getElementById('geoBtn');
    if(!badge || !linkEl || !btn) return;

    const raw=String(calcState?.geoLink||'').trim();
    let safeUrl='';
    if(raw){
      try{
        const u=new URL(raw,location.href);
        if(u.protocol==='https:') safeUrl=u.href;
      }catch(e){}
    }

    linkEl.replaceChildren();
    if(safeUrl){
      const m=safeUrl.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
      const label=m
        ? `📍 ${Number(m[1]).toFixed(5)}, ${Number(m[2]).toFixed(5)}`
        : `📍 ${safeUrl.slice(0,40)}${safeUrl.length>40?'…':''}`;
      const a=document.createElement('a');
      a.href=safeUrl;
      a.target='_blank';
      a.rel='noopener noreferrer';
      a.style.color='var(--accent)';
      a.style.textDecoration='none';
      a.textContent=label;
      linkEl.appendChild(a);
      badge.classList.remove('hidden');
      btn.style.background='var(--success)';
      btn.style.color='#fff';
    }else{
      badge.classList.add('hidden');
      btn.style.background='';
      btn.style.color='';
    }
  };
}

if(typeof renderShiftHistory==='function'){
  renderShiftHistory=function(){
    const monthShifts=sortShiftsByDateDesc(getShiftsForMonth(shifts,statsViewDate));
    const card=document.getElementById('shiftHistoryCard');
    if(!card) return;
    if(!monthShifts.length){
      card.innerHTML='<div class="empty-state"><div class="es-icon">🕒</div>Змін у цьому місяці ще немає</div>';
      return;
    }
    card.innerHTML=monthShifts.map(s=>{
      const hours=Number.isFinite(Number(s.hours))?Number(s.hours):0;
      const earned=calculateShiftEarnings(hours,settings.hourlyRate);
      const safeId=escapeHtml(String(s.id??''));
      return `<div class="shift-row" data-id="${safeId}"><div><div class="sr-main">${escapeHtml(String(s.date||''))} · ${hours} год</div><div class="sr-sub">${escapeHtml(String(s.coworker||''))}${earned>0?` · ${fmtMoney(earned)}`:''}</div></div><button type="button" class="delete-shift-btn" data-id="${safeId}">✕</button></div>`;
    }).join('');
  };
}

if(typeof renderSettingsScreen==='function'){
  const securityDomPreviousRenderSettings=renderSettingsScreen;
  renderSettingsScreen=function(){
    const result=securityDomPreviousRenderSettings.apply(this,arguments);
    const label=document.getElementById('appVersionLabel');
    if(label) label.textContent=`Версія застосунку: ${SECURITY_DOM_FINAL_RELEASE_LABEL}`;
    return result;
  };
}