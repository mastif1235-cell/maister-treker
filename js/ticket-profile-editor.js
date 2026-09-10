'use strict';

// Profile edit modal. Classic global API; initialized only by explicit user action.
// NEW: редагування ПІБ/телефону/адреси/логіна/пароля/договору просто з
// профілю абонента (навігатор адрес) — застосовується одразу до ВСІХ
// заявок за цією адресою: де було порожньо — додасть, де вже було —
// виправить. Синхронізацію в хмару/Telegram для кожної із заявок при
// цьому НЕ запускаємо (щоб не заспамити Telegram повідомленнями за кожну
// заявку одразу) — вони підхоплять зміну при наступному звичайному
// збереженні.
function showEditAbonentProfile(profileJson){
  let data;
  try{ data = JSON.parse(profileJson); }catch(e){ return; }
  const ids = data.ids || [];
  const bodyHtml = `
    <div class="row" style="gap:10px;">
      <div class="field" style="flex:1;"><label>Місто</label><input type="text" id="abonentEditCity" name="mt-internal-profile-city" list="abonentEditCityDatalist" autocomplete="off" autocorrect="off" spellcheck="false" value="${escapeHtml(data.city||'')}"><datalist id="abonentEditCityDatalist"></datalist></div>
      <div class="field" style="flex:2;"><label>Вулиця</label><input type="text" id="abonentEditStreet" name="mt-internal-profile-street" list="abonentEditStreetDatalist" autocomplete="off" autocorrect="off" spellcheck="false" value="${escapeHtml(data.street||'')}"><datalist id="abonentEditStreetDatalist"></datalist></div>
    </div>
    <div class="row" style="gap:10px; margin-top:10px;">
      <div class="field" style="flex:1;"><label>Будинок</label><input type="text" id="abonentEditHouse" value="${escapeHtml(data.house||'')}"></div>
      <div class="field" style="flex:1;"><label>Квартира</label><input type="text" id="abonentEditApartment" value="${escapeHtml(data.apartment||'')}"></div>
    </div>
    <div class="field" style="margin-top:10px;"><label>ПІБ</label><input type="text" id="abonentEditName" value="${escapeHtml(data.clientName||'')}"></div>
    <div class="field" style="margin-top:10px;"><label>Телефон</label><input type="text" id="abonentEditPhone" value="${escapeHtml(data.phone||'')}"></div>
    <div class="field" style="margin-top:10px;">
      <label>Додаткові телефони</label>
      <div id="abonentEditExtraPhonesList"></div>
      <button type="button" class="btn btn-sm" id="abonentEditAddPhoneBtn" style="margin-top:6px;">➕ Додати телефон</button>
    </div>
    <div class="field" style="margin-top:10px;"><label>Примітка (про абонента)</label><textarea id="abonentEditNote" style="min-height:60px;">${escapeHtml(data.note||'')}</textarea></div>
    <div class="field" style="margin-top:10px;"><label>Логін</label><input type="text" id="abonentEditLogin" value="${escapeHtml(data.login||'')}"></div>
    <div class="field" style="margin-top:10px;"><label>Пароль</label><input type="text" id="abonentEditPassword" value="${escapeHtml(data.password||'')}"></div>
    <div class="field" style="margin-top:10px;"><label>№ договору</label><input type="text" id="abonentEditContract" value="${escapeHtml(data.contractNumber||'')}"></div>
    <div style="font-size:11.5px; color:var(--text-faint); margin-top:8px;">Застосується до всіх заявок за цією адресою (${ids.length} шт.) — де вже було заповнено, зміниться; де не було — додасться.</div>
    <button type="button" class="btn btn-block" id="abonentEditSaveBtn" style="margin-top:12px;">Зберегти</button>`;
  openModal('Редагувати абонента', bodyHtml, {onClose: renderAddressNav, onOpen: ()=>{
    // NEW: та сама маска телефону (050)555-55-55, що й у калькуляторі, плюс
    // одразу приводимо вже наявне значення до маски (могло бути внесене
    // раніше у "сирому" вигляді, з таблиці тощо)
    const abonentEditPhoneEl = document.getElementById('abonentEditPhone');
    abonentEditPhoneEl.addEventListener('input', formatPhoneInput);
    formatPhoneInput({target: abonentEditPhoneEl});
    // NEW: додаткові телефони — рядки додаються/видаляються прямо в DOM
    // (без перерендеру всієї модалки, щоб не губити те, що вже надруковано
    // в інших полях); кожен новий рядок одразу отримує ту саму маску.
    const extraPhonesWrap = document.getElementById('abonentEditExtraPhonesList');
    function addAbonentExtraPhoneRow(value){
      const row = document.createElement('div');
      row.className = 'row abonent-extra-phone-row';
      row.style.cssText = 'gap:6px; margin-top:6px;';
      row.innerHTML = `<input type="text" class="abonent-extra-phone-input" value="${escapeHtml(value||'')}" style="flex:1;"><button type="button" class="btn btn-sm btn-danger abonent-extra-phone-remove">✕</button>`;
      extraPhonesWrap.appendChild(row);
      const inp = row.querySelector('.abonent-extra-phone-input');
      inp.addEventListener('input', formatPhoneInput);
      row.querySelector('.abonent-extra-phone-remove').addEventListener('click', ()=> row.remove());
    }
    (data.extraPhones||[]).forEach(p=> addAbonentExtraPhoneRow(p));
    document.getElementById('abonentEditAddPhoneBtn').addEventListener('click', ()=> addAbonentExtraPhoneRow(''));
    // NEW: ті самі підказки міст/вулиць (через <datalist>), що й у формі
    // створення заявки — вулиці підвантажуються окремо для кожного міста
    // і оновлюються при зміні поля "Місто"
    const abonentEditCityEl = document.getElementById('abonentEditCity');
    const abonentEditCityDl = document.getElementById('abonentEditCityDatalist');
    const abonentEditStreetDl = document.getElementById('abonentEditStreetDatalist');
    abonentEditCityDl.innerHTML = (settings.cities||[]).map(c=>`<option value="${escapeHtml(c)}"></option>`).join('');
    const updateAbonentEditStreetDl = city=>{
      const list = (settings.streets && settings.streets[city]) || [];
      abonentEditStreetDl.innerHTML = list.map(s=>`<option value="${escapeHtml(s)}"></option>`).join('');
    };
    updateAbonentEditStreetDl(data.city||'');
    abonentEditCityEl.addEventListener('input', e=> updateAbonentEditStreetDl(e.target.value.trim()));
    document.getElementById('abonentEditSaveBtn').addEventListener('click', ()=>{
      const vals = {
        city: document.getElementById('abonentEditCity').value.trim(),
        street: document.getElementById('abonentEditStreet').value.trim(),
        house: document.getElementById('abonentEditHouse').value.trim(),
        apartment: document.getElementById('abonentEditApartment').value.trim(),
        clientName: document.getElementById('abonentEditName').value.trim(),
        phone: document.getElementById('abonentEditPhone').value.trim(),
        extraPhones: Array.from(document.querySelectorAll('.abonent-extra-phone-input')).map(inp=>inp.value.trim()).filter(Boolean),
        note: document.getElementById('abonentEditNote').value.trim(),
        login: document.getElementById('abonentEditLogin').value.trim(),
        password: document.getElementById('abonentEditPassword').value.trim(),
        contractNumber: document.getElementById('abonentEditContract').value.trim()
      };
      // NEW: адреса застосовується одразу до ВСІХ заявок цього профілю —
      // якщо її справді змінили (а не просто ПІБ/телефон/тощо), попереджаємо,
      // скільки заявок "переїде" на нову адресу, щоб не зробити це випадково
      const addressChanged = vals.city!==(data.city||'') || vals.street!==(data.street||'') || vals.house!==(data.house||'') || vals.apartment!==(data.apartment||'');
      if(addressChanged){
        const sure = confirm(`Адресу змінено — вона застосується до ${ids.length} заявок(и) за старою адресою (вони «переїдуть» на нову). Якщо це насправді інший абонент — краще скасувати й створити нову заявку з новою адресою. Продовжити?`);
        if(!sure) return;
      }
      ids.forEach(id=>{
        const t = tickets.find(x=>String(x.id)===String(id));
        if(t){
          t.city = vals.city; t.street = vals.street; t.house = vals.house; t.apartment = vals.apartment;
          t.address = [[vals.street, vals.house].filter(Boolean).join(' '), vals.apartment ? `кв. ${vals.apartment}` : ''].filter(Boolean).join(', ');
          t.clientName = vals.clientName; t.phone = vals.phone; t.extraPhones = vals.extraPhones; t.abonentNote = vals.note;
          t.login = vals.login; t.password = vals.password; t.contractNumber = vals.contractNumber;
          // NEW: раніше після масової правки профілю текст заявки (t.content)
          // залишався СТАРИМ — диспетчеру при пересиланні/копіюванні летіло
          // старе ім'я/адреса/телефон, хоча в самій заявці все вже виправлено.
          // Для звичайних (не raw) заявок перебудовуємо текст з новими даними.
          if(!t.cloudImported) t.content = buildTicketContent({
            ...t,
            freeRepairCallThreshold:Number(settings.freeRepairCallThreshold)||0
          }, Number(t.sum)||0);
          // Профіль змінює вже наявну заявку, тому повтор має йти update,
          // а не add: сервер оновлює рядок по stable id без delete-вікна.
        }
      });
      saveTickets();
      showToast('Дані абонента оновлено');
      // NEW: якщо адресу виправили — навігатор слідує за заявками на їхню
      // нову адресу, а не лишається дивитись на порожнє місце
      addrNavState = {level:'tickets', city: vals.city, street: vals.street, house: vals.house || '(без номера)', apartment: vals.apartment || '(без кв.)'};
      renderAddressNav();
    });
  }});
}
