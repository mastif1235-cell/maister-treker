/* ---- Пасивний візуальний рендеринг калькулятора ----
   Читає calcState/settings і оновлює лише DOM. */
function renderEquipmentList(){
  const wrap = document.getElementById('equipmentList');
  wrap.innerHTML = calcState.equipment.map((eq,i)=>`
    <div class="eq-row">
      <label><input type="checkbox" data-eqidx="${i}" class="eq-check" ${eq.checked?'checked':''}> ${escapeHtml(eq.label)}</label>
      <input type="number" min="0" data-eqidx="${i}" class="eq-price" value="${eq.price}">
    </div>`).join('');
  updateEquipmentSummary();
}

// NEW: оновлює лише текст підсумку обладнання, не перебудовуючи інпути —
// щоб не збивати фокус/курсор під час введення ціни
function updateEquipmentSummary(){
  const checkedCount = calcState.equipment.filter(e=>e.checked).length;
  const sum = calcState.equipment.reduce((s,e)=> s + (e.checked ? safeNonNegativeNumber(e.price) : 0), 0);
  document.getElementById('equipmentSummary').textContent = checkedCount ? `— обрано: ${checkedCount}, ${fmtMoney(sum)}` : '';
}

// NEW: динамічний список кабелів (типи редагуються в Налаштуваннях) —
// замінює колишні жорстко закодовані поля UTP/Оптика
function renderCablesList(){
  const wrap = document.getElementById('cablesList');
  if(!calcState.cables || calcState.cables.length===0){
    wrap.innerHTML = `<div style="color:var(--text-faint); font-size:13px;">Типи кабелів не налаштовані — додайте у Налаштуваннях</div>`;
  } else {
    wrap.innerHTML = calcState.cables.map((c,i)=>`
      <div class="cab-row" data-cabidx="${i}">
        <span class="cab-label">${escapeHtml(c.label)}</span>
        <input type="number" data-cabidx="${i}" class="cab-meters" placeholder="метри" min="0" value="${c.meters||0}">
        <span class="cab-x">м ×</span>
        <input type="number" data-cabidx="${i}" class="cab-price" placeholder="грн/м" min="0" value="${c.pricePerMeter||0}">
      </div>`).join('');
  }
  updateCablesSummary();
}

// NEW: оновлює лише текст підсумку кабелів, не перебудовуючи інпути —
// щоб не збивати фокус/курсор під час введення метрів чи ціни
function updateCablesSummary(){
  const sum = (calcState.cables||[]).reduce((s,c)=>s+safeNonNegativeNumber(c.meters)*safeNonNegativeNumber(c.pricePerMeter),0);
  document.getElementById('cablesSummary').textContent = sum ? `— ${fmtMoney(sum)}` : '';
}

function renderPresetWorksList(){
  const wrap = document.getElementById('presetWorksList');
  if(!calcState.presetWorks || calcState.presetWorks.length===0){
    wrap.innerHTML = `<div style="color:var(--text-faint); font-size:13px;">Список робіт порожній — додайте у Налаштуваннях</div>`;
  } else {
    wrap.innerHTML = calcState.presetWorks.map((w,i)=>`
      <div class="eq-row" data-pwidx="${i}" style="align-items:center; gap:8px;">
        <label style="flex:1;"><input type="checkbox" data-pwidx="${i}" class="pw-check" ${w.checked?'checked':''}> ${escapeHtml(w.label)}</label>
        <input type="number" min="1" data-pwidx="${i}" class="pw-qty" value="${w.qty||1}" style="width:52px;" title="Кількість">
        <span style="color:var(--text-dim); font-size:12px;">×</span>
        <input type="number" min="0" data-pwidx="${i}" class="pw-price" value="${w.price}" style="width:70px;" title="Ціна">
      </div>`).join('');
  }
  const checkedCount = (calcState.presetWorks||[]).filter(w=>w.checked).length;
  const sum = (calcState.presetWorks||[]).reduce((s,w)=>s+(w.checked?safeNonNegativeNumber(w.price)*safeWorkQuantity(w.qty):0),0);
  document.getElementById('presetWorksSummary').textContent = checkedCount ? `— обрано: ${checkedCount}, разом: ${fmtMoney(sum)}` : '';
}

function renderAdditionalWorkList(){
  const wrap = document.getElementById('additionalWorkList');
  if(calcState.additionalWork.length===0){
    wrap.innerHTML = `<div style="color:var(--text-faint); font-size:13px; margin-bottom:8px;">Додаткових робіт немає</div>`;
    document.getElementById('additionalWorkSummary').textContent = '';
    return;
  }
  wrap.innerHTML = calcState.additionalWork.map((w,i)=>`
    <div class="aw-row" data-awidx="${i}">
      <input type="text" class="aw-desc" placeholder="Опис роботи" value="${escapeHtml(w.desc)}">
      <input type="number" class="aw-sum" placeholder="Сума" min="0" value="${w.sum}">
      <button type="button" class="btn btn-icon btn-sm aw-remove">✕</button>
    </div>`).join('');
  const sum = calcState.additionalWork.reduce((s,w)=>s+safeNonNegativeNumber(w.sum),0);
  document.getElementById('additionalWorkSummary').textContent = `— ${calcState.additionalWork.length}, ${fmtMoney(sum)}`;
}

function renderMasterChips(){
  const wrap = document.getElementById('calcMasterChips');
  if(!settings.masters || settings.masters.length===0){
    wrap.innerHTML = `<span style="color:var(--text-faint); font-size:13px;">Додайте майстрів у Налаштуваннях</span>`;
    return;
  }
  // Кілька майстрів можуть робити одне підключення разом — вибір
  // множинний. Звіряємо по імені, а не по літері: у різних майстрів
  // літера може збігатися (наприклад, двоє з однаковою першою літерою
  // прізвища), і звірка по літері підсвічувала б їх обох одразу.
  wrap.innerHTML = settings.masters.map(m=>{
    const active = (calcState.connectMasters||[]).some(x=>x.name===m.name);
    return `<button type="button" class="chip ${active?'active':''}" data-master-letter="${escapeHtml(m.letter)}" data-master-name="${escapeHtml(m.name)}">${escapeHtml(m.name)}</button>`;
  }).join('');
}

function renderCalcTagChips(){
  const wrap = document.getElementById('calcTagChips');
  if(settings.tags.length===0){
    wrap.innerHTML = `<span style="color:var(--text-faint); font-size:13px;">Додайте теги в Налаштуваннях</span>`;
  } else {
    wrap.innerHTML = settings.tags.map(tag=>{
      const active = calcState.tags.includes(tag);
      return `<button type="button" class="chip ${active?'active':''}" data-calctag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`;
    }).join('');
  }
  document.getElementById('tagsSummary').textContent = calcState.tags.length ? `— обрано: ${calcState.tags.length}` : '';
}

function updateCallFeeLabel(){
  document.getElementById('callFeeLabel').textContent = callFeeLabelFor(getEffectiveType()) + ', грн';
}

/* Показує/ховає зелений бейдж з координатами під полем адреси */
function renderGeoBadge(){
  const badge = document.getElementById('geoBadge');
  const linkEl = document.getElementById('geoLink');
  const btn = document.getElementById('geoBtn');
  const coords=typeof MTToolsCore!=='undefined'&&(MTToolsCore.explicitCoordinates(calcState)||MTToolsCore.parseCoordinates(calcState.geoLink));
  const mapsUrl=typeof MTToolsCore!=='undefined'?MTToolsCore.googleMapsUrl(calcState):calcState.geoLink;
  if(mapsUrl){
    const label=coords?`📍 ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`:'📍 Відкрити збережену геолокацію';
    linkEl.innerHTML = `<a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener" style="color:var(--accent); text-decoration:none;">${label}</a>`;
    badge.classList.remove('hidden');
    btn.style.background = 'var(--success)';
    btn.style.color = '#fff';
  } else {
    badge.classList.add('hidden');
    btn.style.background = '';
    btn.style.color = '';
  }
}
