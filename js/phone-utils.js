/*
 * Чисті утиліти українських телефонних номерів.
 *
 * Це класичний script, а не ES-модуль: глобальні імена збережені для
 * зворотної сумісності з app.js. Тут немає DOM, storage, мережі або
 * змінюваного стану застосунку.
 */

const UA_PHONE_REGEX = /(?<!\d)(\+?38)?[\s(\-]*0\d{2}[\s)\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}(?!\d)/g;

function extractPhoneFromText(text){
  const matches = String(text||'').match(UA_PHONE_REGEX);
  return matches ? matches[0] : null;
}

function phoneDigitsToMask(raw){
  let digits = String(raw||'').replace(/\D/g,'');
  if(digits.startsWith('380') && digits.length>=12) digits = '0' + digits.slice(3);
  else if(digits.startsWith('80') && digits.length>=11) digits = '0' + digits.slice(2);
  digits = digits.slice(0,10);
  let out = '';
  if(digits.length>0) out = '(' + digits.substring(0,3);
  if(digits.length>=3) out += ')';
  if(digits.length>3) out += digits.substring(3,6);
  if(digits.length>6) out += '-' + digits.substring(6,8);
  if(digits.length>8) out += '-' + digits.substring(8,10);
  return out;
}

function normalizePhoneKey(raw){
  if(!raw) return '';
  const digits = String(raw).replace(/\D/g,'');
  if(!digits) return '';
  return digits.slice(-9);
}

function extractPhoneCandidatesFromText(text){
  const raw = String(text||'');
  const found = raw.match(UA_PHONE_REGEX) || [];
  const keys = found.map(normalizePhoneKey).filter(Boolean);
  return [...new Set(keys)];
}
