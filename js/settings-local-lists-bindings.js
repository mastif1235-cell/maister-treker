/* ---- Прив'язка локальних списків у Налаштуваннях ---- */
function bindSettingsLocalListsControls(){
  document.getElementById('tagMgmtList').addEventListener('click', e=>{
    const btn = e.target.closest('.remove-tag-btn'); if(!btn) return;
    settings.tags = settings.tags.filter(t=>t!==btn.dataset.tag);
    saveSettings(); renderTagMgmtList();
  });
  document.getElementById('addTagBtn').addEventListener('click', ()=>{
    const input = document.getElementById('newTagInput');
    const val = input.value.trim();
    if(val && !settings.tags.includes(val)){ settings.tags.push(val); saveSettings(); renderTagMgmtList(); }
    input.value = '';
  });
  document.getElementById('newTagInput').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addTagBtn').click(); }
  });
  document.getElementById('resetTagsBtn').addEventListener('click', ()=>{
    if(!confirm('Скинути список тегів до стандартного?')) return;
    settings.tags = [...DEFAULT_TAGS]; saveSettings(); renderTagMgmtList();
  });

  // NEW: керування контактами швидкого набору
  document.getElementById('quickDialMgmtList').addEventListener('click', e=>{
    const btn = e.target.closest('.remove-quickdial-btn'); if(!btn) return;
    settings.quickDialContacts.splice(Number(btn.dataset.idx), 1);
    saveSettings(); renderQuickDialMgmtList();
  });
  document.getElementById('addQuickDialBtn').addEventListener('click', ()=>{
    const nameInput = document.getElementById('newQuickDialName');
    const phoneInput = document.getElementById('newQuickDialPhone');
    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    if(!name || !phone){ showToast('Вкажіть і ім\'я, і номер'); return; }
    if(!settings.quickDialContacts) settings.quickDialContacts = [];
    settings.quickDialContacts.push({name, phone});
    saveSettings(); renderQuickDialMgmtList();
    nameInput.value = ''; phoneInput.value = '';
  });
  document.getElementById('newQuickDialPhone').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addQuickDialBtn').click(); }
  });

  document.getElementById('cityMgmtList').addEventListener('click', e=>{
    const btn = e.target.closest('.remove-city-btn'); if(!btn) return;
    settings.cities = (settings.cities||[]).filter(c=>c!==btn.dataset.city);
    if(settings.streets) delete settings.streets[btn.dataset.city]; // NEW: прибираємо й вулиці видаленого міста
    saveSettings(); renderCityMgmtList();
  });
  document.getElementById('addCityBtn').addEventListener('click', ()=>{
    const input = document.getElementById('newCityInput');
    const val = input.value.trim();
    if(!settings.cities) settings.cities = [];
    if(val && !settings.cities.includes(val)){ settings.cities.push(val); saveSettings(); renderCityMgmtList(); }
    input.value = '';
  });
  document.getElementById('newCityInput').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addCityBtn').click(); }
  });

  // NEW: керування вулицями по містах у Налаштуваннях
  document.getElementById('streetMgmtCitySelect').addEventListener('change', e=>{
    streetMgmtSelectedCity = e.target.value;
    renderStreetMgmtList();
  });
  document.getElementById('streetMgmtList').addEventListener('click', e=>{
    const btn = e.target.closest('.remove-street-btn'); if(!btn) return;
    const city = streetMgmtSelectedCity;
    if(!city || !settings.streets || !settings.streets[city]) return;
    settings.streets[city] = settings.streets[city].filter(s=>s!==btn.dataset.street);
    saveSettings(); renderStreetMgmtList();
  });
  document.getElementById('addStreetBtn').addEventListener('click', ()=>{
    const city = streetMgmtSelectedCity;
    const input = document.getElementById('newStreetInput');
    const val = input.value.trim();
    if(!city){ showToast('Спершу додайте місто'); return; }
    if(!settings.streets) settings.streets = {};
    if(!settings.streets[city]) settings.streets[city] = [];
    if(val && !settings.streets[city].includes(val)){ settings.streets[city].push(val); saveSettings(); renderStreetMgmtList(); }
    input.value = '';
  });
  document.getElementById('newStreetInput').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addStreetBtn').click(); }
  });
}

function bindSettingsCoworkerControls(){
  document.getElementById('cwMgmtList').addEventListener('click', e=>{
    const btn = e.target.closest('.remove-cw-btn'); if(!btn) return;
    settings.coworkers = settings.coworkers.filter(c=>c!==btn.dataset.cw);
    saveSettings(); renderCwMgmtList();
  });
  document.getElementById('addCwBtn').addEventListener('click', ()=>{
    const input = document.getElementById('newCwInput');
    const val = input.value.trim();
    if(val && !settings.coworkers.includes(val)){ settings.coworkers.push(val); saveSettings(); renderCwMgmtList(); }
    input.value = '';
  });
  document.getElementById('newCwInput').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addCwBtn').click(); }
  });
}
