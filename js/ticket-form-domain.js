/* ---- Чиста domain-логіка форми заявки ---- */
function blankTicketObject(){
  return {
    id:null, date:'', time:'', content:'', sum:0, tags:[], photo:null,
    photos:[], // NEW: до 3 фото на заявку; photo (одне) лишається як дублікат першого фото — для сумісності зі старим кодом, який ще читає лише photo
    type:'Підключення', city:'', address:'', clientName:'', phone:'',
    callFee:0, tariff:0,
    equipment: [],
    cables: [], // NEW: динамічний список кабелів замість фіксованих UTP/Оптика
    presetWorks: [],
    additionalWork: [{desc:'', sum:0}], // поле для вводу видно одразу, без кліку на "+"
    payment:'', cashAmount:0, cardAmount:0, itemPayments:{}, note:'', geoLink:'', masterNote:'', otherNote:'', macAddress:'', street:'', house:'', apartment:'', login:'', password:'', connectMasters:[], contractNumber:'', contractNumberDate:'', contractNumberMastersKey:'', synced:false,
    abonentNote:'', extraPhones:[], // NEW: примітка про абонента й додаткові телефони — рівня профілю, як login/password
    tgBackedUp:false, tgPhotoFileId:null, tgSepMsgId:null, tgTextMsgId:null, tgPhotoMsgId:null, tgJsonMsgId:null, // NEW: чи відправлено та які message_id в Telegram-групі (для видалення/пересилання при редагуванні)
    tgPhotoFileIds:[], tgPhotoMsgIds:[], // NEW: file_id/message_id ВСІХ фото заявки (до 3) — tgPhotoFileId/tgPhotoMsgId лишаються як дублікат першого, для сумісності зі старим кодом
    cloudImported:false // NEW: позначка «завантажено з хмари» — вмикає режим сирого редагування тексту
  };
}

function mergeEquipmentWithCatalog(saved, catalog){
  const savedMap = new Map((saved||[]).map(e=>[e.id, e]));
  return catalog.map(e=>{
    const s = savedMap.get(e.id);
    const savedPrice = s ? Number(s.price) : NaN;
    return {id:e.id, label:e.label, price: (s && !isNaN(savedPrice)) ? savedPrice : e.price, checked: s ? (s.checked !== false) : false};
  });
}

function mergeCablesWithCatalog(saved, catalog){
  const savedMap = new Map((saved||[]).map(c=>[c.id, c]));
  return catalog.map(c=>{
    const s = savedMap.get(c.id);
    const savedPrice = s ? Number(s.pricePerMeter) : NaN;
    return {id:c.id, label:c.label, meters: s ? (Number(s.meters)||0) : 0, pricePerMeter: (s && !isNaN(savedPrice)) ? savedPrice : c.pricePerMeter};
  });
}

function mergePresetWorksWithCatalog(saved, catalog){
  const savedMap = new Map((saved||[]).map(w=>[w.id, w]));
  return catalog.map(w=>{
    const s = savedMap.get(w.id);
    const savedPrice = s ? Number(s.price) : NaN;
    return {id:w.id, label:w.label, price: (s && !isNaN(savedPrice)) ? savedPrice : w.price, qty: s ? (Number(s.qty)||1) : 1, checked: s ? (s.checked !== false) : false};
  });
}

/* architecture-cleanup bootstrap.
 * This file is immediately before app.js in index.html. A zero-delay task runs
 * only after the current HTML parser task has finished, so app.js has already
 * declared its legacy functions. We then load the v2 settings owner first and
 * consolidated sync second, before the user can perform any sync action.
 * Keeping activation here avoids a risky full-file rewrite of index.html while
 * the architecture branch is being audited.
 */
(function scheduleConsolidatedSync(){
  function loadScript(src){
    return new Promise((resolve,reject)=>{
      if(document.querySelector('script[data-architecture-sync="'+src+'"]')) return resolve();
      const s=document.createElement('script');
      s.src=src;
      s.async=false;
      s.dataset.architectureSync=src;
      s.onload=resolve;
      s.onerror=()=>reject(new Error('Failed to load '+src));
      document.head.appendChild(s);
    });
  }
  setTimeout(async()=>{
    try{
      await loadScript('js/sync-settings-v65.js');
      await loadScript('js/sync-v65.js');
      window.dispatchEvent(new CustomEvent('maister-sync-ready',{detail:{release:window.MaisterSync?.release||''}}));
    }catch(err){
      console.error('[sync bootstrap]',err);
    }
  },0);
})();
