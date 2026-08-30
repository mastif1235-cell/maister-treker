/* ---- Прив'язка локальних каталогів у Налаштуваннях ---- */
function bindSettingsCatalogControls(){
  // Матеріали: редагування назви/ціни та видалення
  document.getElementById('matMgmtList').addEventListener('input', e=>{
    const li = e.target.closest('.mat-label-inp');
    const pi = e.target.closest('.mat-price-inp');
    if(li){ settings.materials[Number(li.dataset.idx)].label = li.value; saveSettings(); }
    if(pi){settings.materials[Number(pi.dataset.idx)].price=safeNonNegativeNumber(pi.value);saveSettings();}
  });
  document.getElementById('matMgmtList').addEventListener('click', e=>{
    const rm = e.target.closest('.remove-mat-btn'); if(!rm) return;
    settings.materials.splice(Number(rm.dataset.idx), 1);
    saveSettings(); renderMatMgmtList();
    showToast('Матеріал видалено');
  });
  document.getElementById('addMatBtn').addEventListener('click', ()=>{
    const nameEl = document.getElementById('newMatName');
    const priceEl = document.getElementById('newMatPrice');
    const label = nameEl.value.trim();
    if(!label){ showToast('Введіть назву матеріалу'); return; }
    const price=safeNonNegativeNumber(priceEl.value);
    const id = 'mat_'+Date.now();
    settings.materials.push({id, label, price});
    ensureCatalogTags(); // NEW: одразу створює тег з такою ж назвою
    saveSettings(); renderMatMgmtList();
    nameEl.value = ''; priceEl.value = '';
    showToast(`Матеріал «${label}» додано`);
  });
  document.getElementById('newMatName').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addMatBtn').click(); }
  });

  // Майстри: редагування імені/літери та видалення (літера йде в номер договору)
  document.getElementById('masterMgmtList').addEventListener('input', e=>{
    const ni = e.target.closest('.master-name-inp');
    const li = e.target.closest('.master-letter-inp');
    if(ni){ settings.masters[Number(ni.dataset.idx)].name = ni.value; saveSettings(); }
    if(li){ settings.masters[Number(li.dataset.idx)].letter = li.value.toUpperCase(); saveSettings(); }
  });
  document.getElementById('masterMgmtList').addEventListener('click', e=>{
    const rm = e.target.closest('.remove-master-btn'); if(!rm) return;
    settings.masters.splice(Number(rm.dataset.idx), 1);
    saveSettings(); renderMasterMgmtList();
    showToast('Майстра видалено');
  });
  document.getElementById('addMasterBtn').addEventListener('click', ()=>{
    const nameEl = document.getElementById('newMasterName');
    const letterEl = document.getElementById('newMasterLetter');
    const name = nameEl.value.trim();
    const letter = letterEl.value.trim().toUpperCase();
    if(!name){ showToast('Введіть ім\'я майстра'); return; }
    if(!letter){ showToast('Введіть літеру'); return; }
    settings.masters.push({name, letter});
    saveSettings(); renderMasterMgmtList();
    nameEl.value = ''; letterEl.value = '';
    showToast(`Майстра «${name}» додано`);
  });
  document.getElementById('newMasterName').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('newMasterLetter').focus(); }
  });
  document.getElementById('newMasterLetter').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addMasterBtn').click(); }
  });

  // NEW: Типи кабелів — редагування назви/ціни, видалення, додавання
  document.getElementById('cableMgmtList').addEventListener('input', e=>{
    const li = e.target.closest('.cable-label-inp');
    const pi = e.target.closest('.cable-price-inp');
    if(li){ settings.cableTypes[Number(li.dataset.idx)].label = li.value; saveSettings(); }
    if(pi){settings.cableTypes[Number(pi.dataset.idx)].pricePerMeter=safeNonNegativeNumber(pi.value);saveSettings();}
  });
  document.getElementById('cableMgmtList').addEventListener('click', e=>{
    const rm = e.target.closest('.remove-cable-btn'); if(!rm) return;
    settings.cableTypes.splice(Number(rm.dataset.idx), 1);
    saveSettings(); renderCableMgmtList();
    showToast('Тип кабелю видалено');
  });
  document.getElementById('addCableBtn').addEventListener('click', ()=>{
    const nameEl = document.getElementById('newCableName');
    const priceEl = document.getElementById('newCablePrice');
    const label = nameEl.value.trim();
    if(!label){ showToast('Введіть назву кабелю'); return; }
    const pricePerMeter=safeNonNegativeNumber(priceEl.value);
    const id = 'cable_'+Date.now();
    settings.cableTypes.push({id, label, pricePerMeter});
    saveSettings(); renderCableMgmtList();
    nameEl.value = ''; priceEl.value = '';
    showToast(`Кабель «${label}» додано`);
  });
  document.getElementById('newCableName').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addCableBtn').click(); }
  });

  // Роботи з переліку: редагування назви/ціни та видалення
  document.getElementById('workMgmtList').addEventListener('input', e=>{
    const li = e.target.closest('.work-label-inp');
    const pi = e.target.closest('.work-price-inp');
    if(li){ settings.workTypes[Number(li.dataset.idx)].label = li.value; saveSettings(); }
    if(pi){settings.workTypes[Number(pi.dataset.idx)].price=safeNonNegativeNumber(pi.value);saveSettings();}
  });
  document.getElementById('workMgmtList').addEventListener('click', e=>{
    const rm = e.target.closest('.remove-work-btn'); if(!rm) return;
    settings.workTypes.splice(Number(rm.dataset.idx), 1);
    saveSettings(); renderWorkMgmtList();
    showToast('Роботу видалено зі списку');
  });
  document.getElementById('addWorkTypeBtn').addEventListener('click', ()=>{
    const nameEl = document.getElementById('newWorkName');
    const priceEl = document.getElementById('newWorkPrice');
    const label = nameEl.value.trim();
    if(!label){ showToast('Введіть назву роботи'); return; }
    const price=safeNonNegativeNumber(priceEl.value);
    const id = 'work_'+Date.now();
    settings.workTypes.push({id, label, price});
    ensureCatalogTags(); // NEW: одразу створює тег з такою ж назвою
    saveSettings(); renderWorkMgmtList();
    nameEl.value = ''; priceEl.value = '';
    showToast(`Робота «${label}» додана`);
  });
  document.getElementById('newWorkName').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addWorkTypeBtn').click(); }
  });
}
