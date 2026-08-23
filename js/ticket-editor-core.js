/* Pre-app ticket editor state factory. */

function blankCalcState(){
  const t = blankTicketObject();
  const now = new Date();
  t.date = formatDate(now);
  t.time = formatTime(now);
  // NEW: підставляємо ціну виклику за замовчуванням залежно від типу заявки
  // (тип за замовчуванням — "Підключення"); змінюється в Налаштуваннях.
  t.callFee = Number(settings.defaultConnectFee) || 0;
  t.tariff = (t.type === 'Підключення') ? (Number(settings.defaultTariff) || 0) : 0; // тариф лише для підключення
  // NEW: на відміну від blankTicketObject() (порожні масиви — так зберігається
  // у самій заявці), тут, у стані ЖИВОЇ форми, одразу розгортаємо повний
  // каталог обладнання/кабелів/робіт — щоб було з чого вибирати чекбоксами.
  t.equipment = mergeEquipmentWithCatalog([], getEquipmentConfig());
  t.cables = mergeCablesWithCatalog([], getCableTypesConfig());
  t.presetWorks = mergePresetWorksWithCatalog([], getWorkTypesConfig());
  return t;
}
