/* AI: вкладення-зображення (UI-ready). Вибір із галереї/камери, preview,
   видалення, тип вкладення, даунскейл у dataURL (для майбутнього vision).
   Бекенд /ask зображення ПОКИ не приймає — send із вкладеннями блокується
   в ai-chat. Існуючий photo storage не чіпаємо. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
MTAI.createAttachmentManager = function(deps){
  const doc = deps.document;
  const onChange = deps.onChange || function(){};
  let items = []; // {id, kind, name, dataUrl, width, height, size}

  function count(){ return items.length; }
  function list(){ return items.slice(); }
  function canSendMore(){ return items.length < MTAI.config.LIMITS.attachmentsMax; }

  function downscale(dataUrl, edgePx){
    return new Promise(function(resolve){
      const img = new Image();
      img.onload = function(){
        try{
          const scale = Math.min(1, edgePx / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale)), hh = Math.max(1, Math.round(img.height * scale));
          const canvas = doc.createElement('canvas');
          canvas.width = w; canvas.height = hh;
          canvas.getContext('2d').drawImage(img, 0, 0, w, hh);
          resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.82), width: w, height: hh });
        }catch(_e){ resolve({ dataUrl: dataUrl, width: img.width, height: img.height }); }
      };
      img.onerror = function(){ resolve(null); };
      img.src = dataUrl;
    });
  }
  function fileToDataUrl(file){
    return new Promise(function(resolve, reject){
      const reader = new FileReader();
      reader.onload = function(){ resolve(String(reader.result)); };
      reader.onerror = function(){ reject(new Error('read error')); };
      reader.readAsDataURL(file);
    });
  }
  async function addFiles(fileList){
    const files = Array.from(fileList || []).slice(0, MTAI.config.LIMITS.attachmentsMax - items.length);
    for(const file of files){
      if(!/^image\//.test(file.type)) continue;
      if(file.size > MTAI.config.LIMITS.attachmentMaxBytes) continue;
      const raw = await fileToDataUrl(file);
      const small = await downscale(raw, MTAI.config.LIMITS.attachmentEdgePx);
      if(!small) continue;
      items.push({ id:'att_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
        kind:'other', name:file.name || 'photo.jpg', size:file.size,
        dataUrl:small.dataUrl, width:small.width, height:small.height });
      onChange(items.slice());
    }
    return items.slice();
  }
  function setKind(id, kind){ items.forEach(function(it){ if(it.id === id) it.kind = kind; }); onChange(items.slice()); }
  function remove(id){ items = items.filter(function(it){ return it.id !== id; }); onChange(items.slice()); }
  function clear(){ items = []; onChange(items.slice()); }
  /* Пейлоад для майбутнього vision-контракту (зараз не надсилається). */
  function payload(){
    return items.map(function(it){ return { kind:it.kind, dataUrl:it.dataUrl, width:it.width, height:it.height }; });
  }
  return { addFiles: addFiles, setKind: setKind, remove: remove, clear: clear, list: list, count: count, canSendMore: canSendMore, payload: payload };
};
})();
