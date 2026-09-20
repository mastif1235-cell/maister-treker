/* One persisted settings envelope: canonical identities + derived legacy lists.
   Never publish a new identity in memory until localStorage accepted the write. */
function mtAddressBookChange(change){
  const previous=settings;
  try{
    const book=settings.addressBook?MTAddressBook.copy(settings.addressBook):MTAddressBook.fromLegacy(settings);
    change(book);
    settings={...settings,addressBook:book,...MTAddressBook.projection(book)};
    if(saveSettings()===false)throw new Error('Інша вкладка керує записом');
    return true;
  }catch(error){
    settings=previous;
    showToast('Довідник не збережено. Перевірте вільне місце, формат даних та активну вкладку.');
    return false;
  }
}
function mtAddressBookInitialize(){
  if(settings.addressBook){try{MTAddressBook.validate(settings.addressBook);return true;}catch(_error){return false;}}
  return mtAddressBookChange(()=>{});
}
function mtAddressBookRemember(city,street){
  return mtAddressBookChange(book=>MTAddressBook.remember(book,city,street));
}
function mtAddressBookRows(kind,items){
  return items.map(item=>`<div class="row" style="gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
    <span style="flex:1;min-width:120px;overflow-wrap:anywhere">${escapeHtml(item.name)}${item.active?'':' · архів'}
      ${item.aliases.length?`<small style="display:block">Aliases: ${escapeHtml(item.aliases.join(', '))}</small>`:''}</span>
    <button type="button" class="btn btn-sm" data-address-edit="${kind}" data-address-id="${item.id}">Редагувати</button>
    <button type="button" class="btn btn-sm" data-address-toggle="${kind}" data-address-id="${item.id}">${item.active?'В архів':'Відновити'}</button>
  </div>`).join('')||'<span style="color:var(--text-faint)">Список порожній</span>';
}
function mtAddressBookRenderCities(){
  const wrap=document.getElementById('cityMgmtList');if(!wrap)return;
  try{
    const book=MTAddressBook.validate(settings.addressBook);
    wrap.innerHTML='<p style="font-size:12px">Локальний довідник. Архівування та перейменування не змінюють історичні заявки. Для другого телефону використовуйте резервну копію.</p>'+mtAddressBookRows('cities',book.cities);
    if(MTAddressBook.duplicateCandidates(book).length)wrap.insertAdjacentHTML('beforeend','<p role="status">Є збіги назв або aliases. UUID збережено окремо; автоматичного об’єднання немає.</p>');
  }catch(_error){wrap.textContent='Довідник UUID недоступний. Старі адреси та заявки збережено; перевірте резервну копію або активну вкладку.';}
  mtAddressBookRenderLinkCheck();
}
function mtAddressBookRenderSelect(){
  const sel=document.getElementById('streetMgmtCitySelect');if(!sel)return;
  let cities=[];try{cities=MTAddressBook.validate(settings.addressBook).cities;}catch(_error){}
  if(!cities.some(c=>c.id===streetMgmtSelectedCity))streetMgmtSelectedCity=cities.find(c=>c.active)?.id||cities[0]?.id||'';
  sel.innerHTML=cities.length?cities.map(c=>`<option value="${c.id}" ${c.id===streetMgmtSelectedCity?'selected':''}>${escapeHtml(c.name)}${c.active?'':' · архів'} · ${c.id.slice(0,8)}</option>`).join(''):'<option value="">— спершу додайте місто —</option>';
}
function mtAddressBookRenderStreets(){
  const wrap=document.getElementById('streetMgmtList');if(!wrap)return;
  let streets=[];try{streets=MTAddressBook.validate(settings.addressBook).streets;}catch(_error){}
  wrap.innerHTML=mtAddressBookRows('streets',streets.filter(s=>s.cityId===streetMgmtSelectedCity));
}
function mtAddressBookEdit(kind,id){
  const item=settings.addressBook?.[kind]?.find(i=>i.id===id);if(!item)return;
  openModal('Адреса довідника',`<p style="overflow-wrap:anywhere">UUID: ${escapeHtml(item.id)}</p>
    <label>Назва<input id="addressBookName" maxlength="300" value="${escapeHtml(item.name)}"></label>
    <label>Aliases — одна назва на рядок<textarea id="addressBookAliases" rows="5">${escapeHtml(item.aliases.join('\n'))}</textarea></label>
    <p>Лише перевірені варіанти написання. Попередня назва не стає alias автоматично. Заявки не переписуються.</p>
    <button type="button" class="btn btn-accent" id="addressBookSave">Зберегти</button>`,{onOpen:()=>{
      document.getElementById('addressBookSave').onclick=()=>{
        const patch={name:document.getElementById('addressBookName').value,aliases:document.getElementById('addressBookAliases').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)};
        if(mtAddressBookChange(book=>MTAddressBook.update(book,kind,id,patch))){closeModal();renderCityMgmtList();}
      };
    }});
}
/* Stage 2B: the ONE place where a ticket gets its directory link. The card is
   saved through saveTickets() afterwards; a link is written only for a unique
   directory match, so an ambiguous or unknown address stays unlinked. */
function mtTicketAddressApply(ticket){
  try{
    if(typeof MTTicketAddressLink==='undefined')return false;
    const book=settings&&settings.addressBook;
    if(!book)return false;
    return MTTicketAddressLink.applyToTicket(ticket,book);
  }catch(_error){return false;}
}
function mtTicketAddressLabel(ticket){
  try{
    if(typeof MTTicketAddressLink==='undefined'||!settings||!settings.addressBook)return null;
    return MTTicketAddressLink.labelFor(settings.addressBook,ticket);
  }catch(_error){return null;}
}
/* Stage 2C: read-only plan + explicit confirmation. Nothing is linked until the
   master presses the button, and only EXACT/ALIAS_EXACT rows are ever proposed. */
let mtAddressLinkPlanCache=null;
function mtAddressBookLinkCounts(){
  if(typeof MTTicketAddressLinker==='undefined')return null;
  if(!mtAddressLinkPlanCache)return null;
  return mtAddressLinkPlanCache.counts;
}
function mtAddressBookRenderLinkCheck(){
  const wrap=document.getElementById('addressLinkCheck');if(!wrap)return;
  const rows=[
    ['Вже пов’язані з довідником','already_linked'],
    ['Точний збіг (можна пов’язати)','exact'],
    ['Збіг за псевдонімом (можна пов’язати)','alias_exact'],
    ['Неоднозначні — потрібне рішення майстра','ambiguous'],
    ['Немає в довіднику','no_match'],
    ['Помилковий або неповний адрес','malformed'],
    ['Пов’язані в іншому довіднику (не чіпаємо)','foreign']
  ];
  const counts=mtAddressBookLinkCounts();
  const list=counts?'<div style="font-size:12px;line-height:1.6;margin-top:6px;">'+rows.map(([label,key])=>`<div><span style="color:var(--text-dim)">${escapeHtml(label)}:</span> <strong>${Number(counts[key])||0}</strong></div>`).join('')+`<div style="color:var(--text-faint)">Перевірено заявок: ${Number(counts.total)||0}</div></div>`:'';
  const review=counts&&mtAddressLinkPlanCache.review.ambiguous.length?`<div style="font-size:12px;margin-top:8px;color:var(--text-dim)">Неоднозначні (перші ${mtAddressLinkPlanCache.review.ambiguous.length}): ${escapeHtml(mtAddressLinkPlanCache.review.ambiguous.map(r=>`${r.city||'—'} / ${r.street||'—'}`).join('; '))}</div>`:'';
  wrap.innerHTML=`<div style="font-size:12px;color:var(--text-dim)">Прив’язка заявок до довідника. Історичний текст заявок не змінюється, ticket.id не змінюється, неоднозначні адреси не вгадуються.</div>
    <button type="button" class="btn btn-sm btn-ghost btn-block" id="addressLinkCheckBtn" style="margin-top:8px;">🔎 Перевірити адреси заявок</button>
    ${list}${review}
    <button type="button" class="btn btn-sm btn-block${counts&&counts.actionable?' btn-accent':''}" id="addressLinkApplyBtn" style="margin-top:8px;"${counts&&counts.actionable?'':' disabled'}>Прив’язати ${counts?Number(counts.actionable)||0:0} заявок</button>`;
  document.getElementById('addressLinkCheckBtn').onclick=mtAddressBookCheckLinks;
  document.getElementById('addressLinkApplyBtn').onclick=mtAddressBookApplyLinks;
}
function mtAddressBookCheckLinks(){
  if(typeof MTTicketAddressLinker==='undefined'){showToast('Модуль прив’язки недоступний');return;}
  try{
    mtAddressLinkPlanCache=MTTicketAddressLinker.plan(tickets,settings.addressBook);
    mtAddressBookRenderLinkCheck();
    showToast(mtAddressLinkPlanCache.counts.actionable?`Можна пов’язати: ${mtAddressLinkPlanCache.counts.actionable}`:'Немає заявок для прив’язки');
  }catch(_error){
    mtAddressLinkPlanCache=null;mtAddressBookRenderLinkCheck();
    showToast('Не вдалося перевірити адреси');
  }
}
async function mtAddressBookApplyLinks(){
  if(typeof MTTicketAddressLinker==='undefined'||!mtAddressLinkPlanCache)return;
  const actionable=Number(mtAddressLinkPlanCache.counts.actionable)||0;
  if(!actionable){showToast('Немає заявок для прив’язки');return;}
  if(!await openConfirmModal({title:'Пов’язати заявки з довідником?',message:`Буде додано лише cityId/streetId до ${actionable} заявок із однозначною адресою. Текст, будинок, квартира та id заявок не змінюються. Неоднозначні адреси пропускаються.`,confirmLabel:'Прив’язати'}))return;
  const applied=MTTicketAddressLinker.apply(tickets,settings.addressBook,mtAddressLinkPlanCache);
  let saved=false;
  try{saved=(await saveTickets())!==false;}catch(_error){saved=false;}
  if(!saved){
    MTTicketAddressLinker.rollback(applied.applied);
    mtAddressLinkPlanCache=null;mtAddressBookRenderLinkCheck();
    showToast('Не вдалося зберегти — прив’язку скасовано');
    return;
  }
  mtAddressLinkPlanCache=null;mtAddressBookRenderLinkCheck();
  showToast(`Пов’язано заявок: ${applied.applied.length}`);
}
function bindAddressBookControls(){
  mtAddressBookInitialize();
  for(const element of ['cityMgmtList','streetMgmtList'])document.getElementById(element).addEventListener('click',async e=>{
    const edit=e.target.closest('[data-address-edit]');
    if(edit){mtAddressBookEdit(edit.dataset.addressEdit,edit.dataset.addressId);return;}
    const toggle=e.target.closest('[data-address-toggle]');if(!toggle)return;
    const kind=toggle.dataset.addressToggle,id=toggle.dataset.addressId,item=settings.addressBook?.[kind]?.find(i=>i.id===id);
    if(!item)return;
    if(item.active&&!await openConfirmModal({title:'Перенести адресу в архів?',message:'Історичні заявки та UUID залишаться незмінними. Адреса зникне з активного довідника; її можна відновити.',confirmLabel:'В архів'}))return;
    if(mtAddressBookChange(book=>MTAddressBook.update(book,kind,id,{active:!item.active})))renderCityMgmtList();
  });
  document.getElementById('addCityBtn').addEventListener('click',()=>{
    const input=document.getElementById('newCityInput');if(!input.value.trim())return;
    if(mtAddressBookChange(book=>MTAddressBook.remember(book,input.value,''))){input.value='';renderCityMgmtList();}
  });
  document.getElementById('newCityInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();document.getElementById('addCityBtn').click();}});
  document.getElementById('streetMgmtCitySelect').addEventListener('change',e=>{streetMgmtSelectedCity=e.target.value;renderStreetMgmtList();});
  document.getElementById('addStreetBtn').addEventListener('click',()=>{
    const input=document.getElementById('newStreetInput');if(!input.value.trim())return;
    if(mtAddressBookChange(book=>{
      const city=book.cities.find(c=>c.id===streetMgmtSelectedCity&&c.active);if(!city)throw new Error('Оберіть активне місто');
      // UI choice is an explicit city UUID, even if city names overlap.
      if(!book.streets.some(s=>s.cityId===city.id&&s.name===input.value.trim()))MTAddressBook.add(book,'streets',input.value,city.id);
    })){input.value='';renderCityMgmtList();}
  });
  document.getElementById('newStreetInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();document.getElementById('addStreetBtn').click();}});
}
