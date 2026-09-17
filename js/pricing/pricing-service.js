/* 💰 Ціни — рівень логіки: ефективна ціна, список населених пунктів і
   автопідстановка суми в НОВУ заявку.

   Правило наслідування: ефективна ціна = індивідуальна ціна населеного
   пункту, якщо вона задана, інакше — загальна. Саме тому зміна загальної
   ціни (500 → 550) одразу діє на всі міста без override, а місто з
   override (Таромське = 600) лишається незмінним. Кожна з трьох цін
   наслідується незалежно від інших.

   Тут НЕМАЄ жодного запису в заявки: ціни впливають лише на те, що
   підставляється у форму нової заявки. Уже збережені заявки зберігають
   власні суми назавжди.

   Класичний скрипт (window.MTPricingService) + module.exports для тестів. */
(function(root, factory){
  'use strict';
  const storage = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('./pricing-storage.js')
    : root.MTPricingStorage;
  const api = factory(storage);
  root.MTPricingService = api;
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function(store){
  'use strict';

  const TYPE_CONNECT = 'Підключення';
  const TYPE_REPAIR = 'Ремонт';

  /* Ефективна ціна одного виду для конкретного населеного пункту. */
  function effectivePrice(settings, kind, cityName){
    const override = store.overrideFor(settings, kind, cityName);
    return override === null ? store.generalPrice(settings, kind) : override;
  }

  function priceInfo(settings, kind, cityName){
    const override = store.overrideFor(settings, kind, cityName);
    const general = store.generalPrice(settings, kind);
    return {
      kind,
      label: store.LABELS[kind] || kind,
      general,
      override,
      individual: override !== null,
      value: override === null ? general : override,
      status: override === null ? 'Загальна' : 'Індивідуальна'
    };
  }

  function priceInfoList(settings, cityName){
    return store.KINDS.map(kind=>priceInfo(settings, kind, cityName));
  }

  /* Список населених пунктів збирається з ФАКТУ заявок (+ довідник міст
     і вже налаштовані пункти). Дублікати за регістром і зайвими пробілами
     зводяться в один пункт; для показу береться найохайніше написання. */
  function collectCities(settings, tickets){
    const map = new Map();
    const add = (raw, weight)=>{
      const key = store.normalizeKey(raw);
      if(!key) return;
      const pretty = store.displayNameOf(raw);
      const existing = map.get(key);
      if(!existing){ map.set(key, {key, displayName: pretty, weight}); return; }
      if(weight > existing.weight || (weight === existing.weight && betterSpelling(pretty, existing.displayName))){
        existing.displayName = pretty;
        existing.weight = Math.max(existing.weight, weight);
      }
    };

    // Найвищий пріоритет назви — те, що майстер сам зберіг у розділі цін.
    const pricing = store.ensure(settings);
    Object.keys(pricing.cities || {}).forEach(key=>{
      const entry = pricing.cities[key];
      add((entry && entry.displayName) || key, 3);
    });
    (Array.isArray(tickets) ? tickets : []).forEach(ticket=>{ if(ticket) add(ticket.city, 2); });
    (settings && Array.isArray(settings.cities) ? settings.cities : []).forEach(city=>add(city, 1));

    return Array.from(map.values())
      .map(item=>{
        const overrides = store.overrides(settings, item.key);
        return {
          key: item.key,
          displayName: item.displayName || item.key,
          overrides,
          hasOverride: Object.keys(overrides).length > 0,
          configured: Object.prototype.hasOwnProperty.call(pricing.cities || {}, item.key)
        };
      })
      .sort((a, b)=>a.displayName.localeCompare(b.displayName, 'uk'));
  }

  /* «Таромське» охайніше за «таромське» і за «ТАРОМСЬКЕ». */
  function betterSpelling(candidate, current){
    if(!candidate) return false;
    if(!current) return true;
    const score = value=>{
      const letters = value.replace(/[^\p{L}]/gu, '');
      if(!letters) return 0;
      const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
      if(upper === letters.length) return 1;           // ТАРОМСЬКЕ
      if(upper === 0) return 0;                        // таромське
      return 2;                                        // Таромське
    };
    return score(candidate) > score(current);
  }

  /* Короткий статус для списку населених пунктів. */
  function citySummary(settings, cityName){
    const overrides = store.overrides(settings, cityName);
    const kinds = store.KINDS.filter(kind=>Object.prototype.hasOwnProperty.call(overrides, kind));
    if(!kinds.length) return 'Використовує загальні ціни';
    return kinds.map(kind=>`${store.LABELS[kind]}: ${overrides[kind]} грн · індивідуальна`).join(' · ');
  }

  /* Автопідстановка для НОВОЇ заявки: місто + тип роботи → суми.
     Повторює наявну логіку застосунку (тариф лише для підключення,
     «Інше» без виклику й тарифу), додаючи лише врахування override. */
  function autofillFor(settings, type, cityName){
    if(type === TYPE_CONNECT){
      return {
        callFee: effectivePrice(settings, 'connection', cityName),
        tariff:  effectivePrice(settings, 'tariff', cityName)
      };
    }
    if(type === TYPE_REPAIR){
      return {callFee: effectivePrice(settings, 'callout', cityName), tariff: 0};
    }
    return {callFee: 0, tariff: 0};
  }

  /* Який вид ціни відповідає полю «Виклик» для цього типу заявки —
     потрібно, щоб у формі показати правильну підказку. */
  function callFeeKindFor(type){
    if(type === TYPE_CONNECT) return 'connection';
    if(type === TYPE_REPAIR) return 'callout';
    return null;
  }

  return Object.freeze({
    TYPE_CONNECT, TYPE_REPAIR,
    effectivePrice, priceInfo, priceInfoList,
    collectCities, citySummary, betterSpelling,
    autofillFor, callFeeKindFor
  });
});
