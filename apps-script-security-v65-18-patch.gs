/* Майстер-Трекер — Apps Script HMAC auth patch v65.0-security.18
   ВСТАВИТИ В КІНЕЦЬ поточного Code.gs і створити НОВУ версію deployment.

   Мета:
   - секрет більше не передається в URL;
   - клієнт надсилає HMAC-SHA256 підпис + timestamp + одноразовий nonce;
   - захист від повторного відтворення запиту (replay) через CacheService;
   - під час міграції старий secret-параметр ще підтримується, тому синхронізація
     не ламається між оновленням Apps Script і оновленням PWA.

   Після того як security.18 буде перевірено на телефоні, legacy-режим можна
   окремо вимкнути наступним кроком.
*/

var SECURE_AUTH_V2 = 2;
var SECURE_AUTH_MAX_SKEW_MS = 5 * 60 * 1000;
var SECURE_AUTH_NONCE_TTL_SEC = 600;

// Зберігаємо посилання на поточні робочі обробники. Цей patch має бути
// вставлений САМЕ В КІНЕЦЬ Code.gs, після старих doGet/doPost.
var LEGACY_DO_POST_V65 = doPost;
var LEGACY_DO_GET_V65 = doGet;

function secureAuthBase64Url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function secureAuthConstantTimeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  var diff = a.length ^ b.length;
  var max = Math.max(a.length, b.length);
  for (var i = 0; i < max; i++) {
    var ac = a.length ? a.charCodeAt(i % a.length) : 0;
    var bc = b.length ? b.charCodeAt(i % b.length) : 0;
    diff |= ac ^ bc;
  }
  return diff === 0;
}

function secureAuthExpectedSig_(canonical) {
  var raw = Utilities.computeHmacSha256Signature(
    String(canonical),
    String(SYNC_SECRET),
    Utilities.Charset.UTF_8
  );
  return secureAuthBase64Url_(raw);
}

function secureAuthFreshTimestamp_(ts) {
  var n = Number(ts);
  if (!isFinite(n)) return false;
  return Math.abs(Date.now() - n) <= SECURE_AUTH_MAX_SKEW_MS;
}

function secureAuthConsumeNonce_(nonce) {
  nonce = String(nonce || '');
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return false;
  var cache = CacheService.getScriptCache();
  var key = 'mt-hmac-nonce:' + nonce;
  if (cache.get(key)) return false;
  cache.put(key, '1', SECURE_AUTH_NONCE_TTL_SEC);
  return true;
}

function secureAuthVerifyPostEnvelope_(outer) {
  if (!outer || Number(outer.v) !== SECURE_AUTH_V2) return null;
  var ts = String(outer.ts || '');
  var nonce = String(outer.nonce || '');
  var body = String(outer.body || '');
  var sig = String(outer.sig || '');
  if (!secureAuthFreshTimestamp_(ts)) return null;
  if (!body || body.length > 8 * 1024 * 1024) return null;
  var canonical = ts + '\n' + nonce + '\nPOST\n' + body;
  if (!secureAuthConstantTimeEqual_(secureAuthExpectedSig_(canonical), sig)) return null;
  if (!secureAuthConsumeNonce_(nonce)) return null;
  return body;
}

function secureAuthVerifyGet_(p) {
  p = p || {};
  if (Number(p.v) !== SECURE_AUTH_V2) return false;
  var ts = String(p.ts || '');
  var nonce = String(p.nonce || '');
  var action = String(p.action || 'list');
  var id = String(p.id || '');
  var sig = String(p.sig || '');
  if (!secureAuthFreshTimestamp_(ts)) return false;
  var canonical = ts + '\n' + nonce + '\nGET\n' + action + '\n' + id;
  if (!secureAuthConstantTimeEqual_(secureAuthExpectedSig_(canonical), sig)) return false;
  if (!secureAuthConsumeNonce_(nonce)) return false;
  return true;
}

function doPost(e) {
  try {
    var raw = e && e.postData ? String(e.postData.contents || '') : '';
    var outer = JSON.parse(raw || '{}');

    // security.18 HMAC envelope: перевіряємо підпис, а старій перевіреній
    // бізнес-логіці передаємо внутрішній body з локально підставленим secret.
    var signedBody = secureAuthVerifyPostEnvelope_(outer);
    if (signedBody !== null) {
      var data = JSON.parse(signedBody);
      data.secret = SYNC_SECRET;
      return LEGACY_DO_POST_V65({postData:{contents:JSON.stringify(data)}});
    }

    // Міграційна сумісність зі старою PWA. Після успішного тесту security.18
    // цей fallback можна буде видалити окремим релізом.
    return LEGACY_DO_POST_V65(e);
  } catch (err) {
    return jsonResponse({status:'error', message:'auth failed'});
  }
}

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (secureAuthVerifyGet_(p)) {
      var cloned = {};
      Object.keys(p).forEach(function(k){ cloned[k] = p[k]; });
      cloned.secret = SYNC_SECRET;
      return LEGACY_DO_GET_V65({parameter:cloned});
    }

    // Тимчасова сумісність зі старим ?secret=... на час безпечного переходу.
    return LEGACY_DO_GET_V65(e);
  } catch (err) {
    return jsonResponse({status:'error', message:'auth failed'});
  }
}
