/* 💰 Ціни — рівень зберігання.

   ВАЖЛИВО (інтеграція, а не дублювання): загальні ціни НЕ отримують нового
   місця зберігання. Вони й далі живуть у канонічних полях налаштувань, які
   вже існували в застосунку до цього розділу:

     callout    → settings.defaultRepairCallFee  (Виклик, ремонт)
     tariff     → settings.defaultTariff         (Тариф підключення)
     connection → settings.defaultConnectFee     (Підключення)

   Новим є ЛИШЕ шар індивідуальних цін по населених пунктах:

     settings.pricing = {
       cities: {
         "таромське": { displayName:"Таромське", overrides:{ connection:600 } }
       }
     }

   Місто зберігає тільки відхилення (overrides), а не копію всіх цін — тому
   зміна загальної ціни автоматично діє на всі міста без свого override.

   Класичний скрипт (window.MTPricingStorage) + module.exports для тестів. */
(function(root, factory){
  'use strict';
  const api = factory();
  root.MTPricingStorage = api;
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function(){
  'use strict';

  const KINDS = Object.freeze(['callout', 'tariff', 'connection']);
  const LABELS = Object.freeze({callout:'Виклик', tariff:'Тариф', connection:'Підключення'});
  // Канонічні поля налаштувань, що вже існували — саме там лежать загальні ціни.
  const GENERAL_FIELD = Object.freeze({
    callout:    'defaultRepairCallFee',
    tariff:     'defaultTariff',
    connection: 'defaultConnectFee'
  });
  const GENERAL_FALLBACK = Object.freeze({callout:300, tariff:250, connection:500});

  function isKind(kind){ return KINDS.indexOf(kind) >= 0; }

  /* Ключ населеного пункту: "  Таромське " / "таромське" / "ТАРОМСЬКЕ" — це
     один і той самий пункт. Пробіли схлопуються, регістр знімається, різні
     варіанти апострофа зводяться до одного. */
  function normalizeKey(name){
    return String(name == null ? '' : name)
      .replace(/[\u02BC\u2019\u055A`']/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function displayNameOf(name){
    return String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  }

  /* Сума в гривнях: невід'ємне ціле. Все інше (порожнє, текст, мінус,
     NaN, Infinity) — null, тобто "ціна не задана". */
  function normalizeAmount(value){
    if(value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if(!Number.isFinite(number) || number < 0) return null;
    return Math.round(number);
  }

  /* Читає (і за потреби створює) контейнер pricing. Нічого не чистить і не
     скидає — якщо структури ще не було, з'являється порожня та безпечна. */
  function ensure(settings){
    if(!settings || typeof settings !== 'object') return {cities:{}};
    if(!settings.pricing || typeof settings.pricing !== 'object') settings.pricing = {};
    if(!settings.pricing.cities || typeof settings.pricing.cities !== 'object') settings.pricing.cities = {};
    return settings.pricing;
  }

  /* ---- Загальні ціни: читання/запис канонічних полів налаштувань ---- */
  function generalPrice(settings, kind){
    if(!isKind(kind)) return 0;
    const raw = settings ? settings[GENERAL_FIELD[kind]] : undefined;
    const value = normalizeAmount(raw);
    return value === null ? GENERAL_FALLBACK[kind] : value;
  }

  function generalPrices(settings){
    return {
      callout:    generalPrice(settings, 'callout'),
      tariff:     generalPrice(settings, 'tariff'),
      connection: generalPrice(settings, 'connection')
    };
  }

  function setGeneralPrice(settings, kind, value){
    if(!settings || !isKind(kind)) return false;
    const amount = normalizeAmount(value);
    if(amount === null) return false;
    settings[GENERAL_FIELD[kind]] = amount;
    return true;
  }

  /* ---- Індивідуальні ціни населеного пункту ---- */
  function cityEntry(settings, cityName){
    const key = normalizeKey(cityName);
    if(!key) return null;
    const pricing = ensure(settings);
    const entry = pricing.cities[key];
    return entry && typeof entry === 'object' ? entry : null;
  }

  function overrides(settings, cityName){
    const entry = cityEntry(settings, cityName);
    const source = entry && entry.overrides && typeof entry.overrides === 'object' ? entry.overrides : {};
    const result = {};
    KINDS.forEach(kind=>{
      const amount = normalizeAmount(source[kind]);
      if(amount !== null) result[kind] = amount;
    });
    return result;
  }

  function overrideFor(settings, kind, cityName){
    if(!isKind(kind)) return null;
    const map = overrides(settings, cityName);
    return Object.prototype.hasOwnProperty.call(map, kind) ? map[kind] : null;
  }

  function hasOverride(settings, cityName){
    return Object.keys(overrides(settings, cityName)).length > 0;
  }

  /* Задати індивідуальну ціну. Місто зберігає лише це відхилення — решта цін
     і далі наслідуються від загальних. */
  function setOverride(settings, cityName, kind, value){
    if(!settings || !isKind(kind)) return false;
    const key = normalizeKey(cityName);
    if(!key) return false;
    const amount = normalizeAmount(value);
    if(amount === null) return false;
    const pricing = ensure(settings);
    const existing = pricing.cities[key] && typeof pricing.cities[key] === 'object' ? pricing.cities[key] : null;
    const entry = existing || {displayName: displayNameOf(cityName), overrides:{}};
    if(!entry.overrides || typeof entry.overrides !== 'object') entry.overrides = {};
    if(!entry.displayName) entry.displayName = displayNameOf(cityName);
    entry.overrides[kind] = amount;
    pricing.cities[key] = entry;
    return true;
  }

  /* «↩ Повернути загальну ціну»: індивідуальна ціна зникає, місто знову
     наслідує загальну. Сам населений пункт залишається в списку. */
  function clearOverride(settings, cityName, kind){
    if(!settings || !isKind(kind)) return false;
    const entry = cityEntry(settings, cityName);
    if(!entry || !entry.overrides) return false;
    if(!Object.prototype.hasOwnProperty.call(entry.overrides, kind)) return false;
    delete entry.overrides[kind];
    return true;
  }

  /* Видалення населеного пункту з НАЛАШТУВАНЬ цін. Старі заявки не чіпаються
     жодним чином — вони зберігають власні суми. Якщо на це місто буде нова
     заявка, воно знову з'явиться в списку автоматично. */
  function removeCity(settings, cityName){
    const key = normalizeKey(cityName);
    if(!key) return false;
    const pricing = ensure(settings);
    if(!Object.prototype.hasOwnProperty.call(pricing.cities, key)) return false;
    delete pricing.cities[key];
    return true;
  }

  function rememberDisplayName(settings, cityName){
    const key = normalizeKey(cityName);
    if(!key) return false;
    const entry = cityEntry(settings, cityName);
    if(!entry) return false;
    const pretty = displayNameOf(cityName);
    if(pretty && pretty !== entry.displayName) entry.displayName = pretty;
    return true;
  }

  return Object.freeze({
    KINDS, LABELS, GENERAL_FIELD, GENERAL_FALLBACK,
    isKind, normalizeKey, displayNameOf, normalizeAmount, ensure,
    generalPrice, generalPrices, setGeneralPrice,
    cityEntry, overrides, overrideFor, hasOverride,
    setOverride, clearOverride, removeCity, rememberDisplayName
  });
});
