/* Editor totals and mixed-payment presentation. Classic-script API; no initialization. */
function computeTotal(){
  let calculation;
  if(calcState.cloudImported){ // NEW: для відновленої з хмари заявки сума вводиться вручну
    calculation=calculateTicketTotal({cloudImported:true,rawSum:safeNonNegativeNumber(document.getElementById('f_rawSum').value)});
    document.getElementById('calcTotal').textContent = fmtMoney(calculation.total);
    return calculation.total;
  }
  // NEW: якщо оплату позначено як "Безкоштовно" — сума завжди 0, незалежно
  // від того, скільки обладнання/робіт/кабелів заповнено в калькуляторі
  // (раніше сума рахувалась як завжди, і "Безкоштовно" в оплаті на неї не впливало).
  const paymentEl = document.getElementById('f_payment');
  if(paymentEl && paymentEl.value === 'Безкоштовно'){
    calculation = calculateTicketTotal({payment:'Безкоштовно'});
    document.getElementById('calcTotal').textContent = fmtMoney(calculation.total);
    return calculation.total;
  }
  calculation = calculateTicketTotal({
    type:getEffectiveType(),
    freeRepairCallThreshold:Number(settings.freeRepairCallThreshold)||0,
    payment: paymentEl ? paymentEl.value : '',
    baseCallFee:ticketBaseCallFee(calcState),
    callFee:safeNonNegativeNumber(document.getElementById('f_callFee').value),
    tariff:safeNonNegativeNumber(document.getElementById('f_tariff').value),
    equipment: calcState.equipment,
    cables: calcState.cables,
    additionalWork: calcState.additionalWork,
    presetWorks: calcState.presetWorks
  });
  document.getElementById('calcTotal').textContent = fmtMoney(calculation.total);
  if(paymentEl && paymentEl.value === 'Змішана') renderMixedPaymentItems(); // NEW: перелік позицій і підсумок готівка/безготівка перераховуються при будь-якій зміні складу/цін
  return calculation.total;
}

// NEW: замість двох порожніх полів "скільки готівкою / скільки
// безготівкою" (які треба було рахувати вручну — саме те, для чого
// калькулятор і існує) — список УЖЕ вибраних позицій (виклик, тариф,
// обладнання, кабелі, роботи) з перемикачем 💵/💳 на кожну. Розбивка
// готівка/безготівка рахується сама, завжди гарантовано збігається із
// загальною сумою — рахувати в умі більше не треба.
function buildMixedPaymentItems(){
  return buildMixedPaymentItemsFromTicket({
    type: getEffectiveType(),
    freeRepairCallThreshold:Number(settings.freeRepairCallThreshold)||0,
    baseCallFee:ticketBaseCallFee(calcState),
    callFee: Number(document.getElementById('f_callFee').value)||0,
    tariff: Number(document.getElementById('f_tariff').value)||0,
    equipment: calcState.equipment, cables: calcState.cables,
    presetWorks: calcState.presetWorks, additionalWork: calcState.additionalWork
  });
}
// NEW: та сама розбивка на позиції, що й для живої форми (buildMixedPaymentItems
// вище), але працює з уже ЗБЕРЕЖЕНОЮ заявкою (без DOM-полів) — потрібна, щоб
// показати в тексті заявки й у профілі абонента не просто дві суми, а
// конкретно ЩО саме куплено готівкою, а що безготівкою.
// NEW: рядки "готівка: X (перелік позицій), безготівка: Y (перелік позицій)"
// для тексту заявки/профілю — щоб диспетчер одразу бачив, ЩО саме за яку
// оплату, а не лише дві суми без прив'язки до конкретного обладнання.
function renderMixedPaymentItems(){
  const wrap = document.getElementById('mixedPaymentItemsWrap');
  if(!wrap) return;
  const items = buildMixedPaymentItems();
  if(!calcState.itemPayments) calcState.itemPayments = {};
  // NEW: нову позицію (щойно додану заявку/обладнання) за замовчуванням
  // ставимо на "готівка" — типовий випадок "усе готівкою, крім однієї-двох
  // позицій" вимагає найменше тапів (перемкнути лише виняток на 💳)
  items.forEach(it=>{ if(!calcState.itemPayments[it.key]) calcState.itemPayments[it.key] = 'cash'; });
  if(!items.length){
    wrap.innerHTML = `<div style="font-size:12.5px; color:var(--text-faint); padding:6px 0;">Спочатку додайте виклик/обладнання/роботи вище</div>`;
  } else {
    wrap.innerHTML = items.map(it=>{
      const method = calcState.itemPayments[it.key];
      return `<div class="row" style="justify-content:space-between; align-items:center; gap:8px; padding:7px 0; border-bottom:1px solid var(--border);">
        <span style="flex:1; font-size:13.5px;">${escapeHtml(it.label)} — ${fmtMoney(it.amount)}</span>
        <div class="row" style="gap:4px;">
          <button type="button" class="btn btn-sm mixed-item-toggle ${method==='cash'?'btn-accent':''}" data-key="${escapeHtml(it.key)}" data-method="cash">💵</button>
          <button type="button" class="btn btn-sm mixed-item-toggle ${method==='card'?'btn-accent':''}" data-key="${escapeHtml(it.key)}" data-method="card">💳</button>
        </div>
      </div>`;
    }).join('');
  }
  // NEW: розбивка рахується сама з призначень вище — завжди коректна,
  // на відміну від ручного вводу двох чисел, де легко помилитись.
  const cash = items.reduce((s,it)=> s + (calcState.itemPayments[it.key]==='cash' ? it.amount : 0), 0);
  const card = items.reduce((s,it)=> s + (calcState.itemPayments[it.key]==='card' ? it.amount : 0), 0);
  calcState.cashAmount = cash;
  calcState.cardAmount = card;
  const hint = document.getElementById('mixedPaymentHint');
  if(hint) hint.innerHTML = `💵 Готівка: <b>${fmtMoney(cash)}</b> · 💳 Безготівка: <b>${fmtMoney(card)}</b>`;
}

// NEW: показує список позицій розбивки лише для "Змішана оплата" — коли
// частину суми (наприклад, абонплату) абонент кинув на карту, а частину
// (наприклад, роутер) віддав готівкою просто в руки. Раніше вся сума заявки
// могла бути зарахована лише ОДНИМ способом оплати, хоча реально бувало
// по-різному — звідси й плутанина при звірці з диспетчером.
function updateMixedPaymentVisibility(){
  const wrap = document.getElementById('mixedPaymentWrap');
  if(!wrap) return; // NEW: захист від старої версії index.html без цього блока — щоб не впала вся ініціалізація
  const isMixed = document.getElementById('f_payment').value === 'Змішана';
  wrap.classList.toggle('hidden', !isMixed);
  if(isMixed) renderMixedPaymentItems();
}
