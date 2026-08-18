/* Майстер-Трекер — security.18 strict cutover patch

   ЗАСТОСОВУВАТИ ТІЛЬКИ ПІСЛЯ успішного тесту security.18 клієнта.

   Передумови:
   1) у Code.gs вже встановлено apps-script-security-v65-18-patch.gs;
   2) клієнт уже завантажує js/security-sync-hmac-v65-18.js;
   3) створення / редагування / видалення / читання заявки перевірені;
   4) старі вкладки/PWA перезапущені й більше не потрібен ?secret= fallback.

   Що робити:
   - у ПОТОЧНОМУ security.18 wrapper замінити функції doPost/doGet на ці;
   - helper-функції secureAuth* та legacyDoPostV65/legacyDoGetV65 лишити як є;
   - створити нову версію deployment.

   Після цього старий secret у query/body більше НЕ приймається взагалі.
*/

function doPost(e) {
  try {
    var raw = e && e.postData ? String(e.postData.contents || '') : '';
    if (!raw || raw.length > SECURE_AUTH_MAX_BODY_CHARS * 2) {
      return jsonResponse({status:'error', message:'forbidden'});
    }

    var outer = JSON.parse(raw);
    var signedBody = secureAuthVerifyPostEnvelope_(outer);
    if (signedBody === null) {
      return jsonResponse({status:'error', message:'forbidden'});
    }

    var data = JSON.parse(signedBody);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return jsonResponse({status:'error', message:'bad payload'});
    }

    // Секрет не приходить мережею. Підставляємо його тільки локально,
    // щоб перевірена legacy-бізнес-логіка не потребувала переписування.
    data.secret = SYNC_SECRET;
    return legacyDoPostV65({postData:{contents:JSON.stringify(data)}});
  } catch (err) {
    return jsonResponse({status:'error', message:'forbidden'});
  }
}

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (!secureAuthVerifyGet_(p)) {
      return jsonResponse({status:'error', message:'forbidden'});
    }

    var cloned = {};
    Object.keys(p).forEach(function(k){ cloned[k] = p[k]; });
    cloned.secret = SYNC_SECRET;
    return legacyDoGetV65({parameter:cloned});
  } catch (err) {
    return jsonResponse({status:'error', message:'forbidden'});
  }
}
