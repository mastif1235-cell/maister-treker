/* Майстер-Трекер — Apps Script HMAC auth patch v65.0-security.18

   ВАЖЛИВО: перед вставкою цього блока зробіть ДВІ точкові заміни у поточному Code.gs:

     function doPost(e)  ->  function legacyDoPostV65(e)
     function doGet(e)   ->  function legacyDoGetV65(e)

   Після цього вставте ВЕСЬ цей блок у самий кінець Code.gs і створіть НОВУ
   версію deployment. Це навмисно зроблено так, а не через "var old = doPost":
   у JavaScript declaration function doPost() піднімається (hoisting), і простий
   append-only wrapper міг би випадково посилатись сам на себе та піти в рекурсію.

   Мета:
   - syncSecret більше не передається в URL;
   - клієнт надсилає HMAC-SHA256 підпис + timestamp + одноразовий nonce;
   - replay-запити відсікаються через CacheService;
   - під час міграції старий secret-параметр ще підтримується, тому стара PWA
     не ламається між deployment Apps Script і ввімкненням security.18 у клієнті.

   ПІСЛЯ успішного тесту security.18 legacy fallback можна вимкнути окремим релізом.
*/

var SECURE_AUTH_V2 = 2;
var SECURE_AUTH_MAX_SKEW_MS = 5 * 60 * 1000;
var SECURE_AUTH_NONCE_TTL_SEC = 600;
var SECURE_AUTH_MAX_BODY_CHARS = 8 * 1024 * 1024;

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
  if (!body || body.length > SECURE_AUTH_MAX_BODY_CHARS) return null;
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(sig)) return null;
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
  if (action.length > 100 || id.length > 500) return false;
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(sig)) return false;
  var canonical = ts + '\n' + nonce + '\nGET\n' + action + '\n' + id;
  if (!secureAuthConstantTimeEqual_(secureAuthExpectedSig_(canonical), sig)) return false;
  if (!secureAuthConsumeNonce_(nonce)) return false;
  return true;
}

function doPost(e) {
  try {
    var raw = e && e.postData ? String(e.postData.contents || '') : '';
    if (raw.length > SECURE_AUTH_MAX_BODY_CHARS * 2) {
      return jsonResponse({status:'error', message:'request too large'});
    }
    var outer = JSON.parse(raw || '{}');

    // security.18: перевіряємо HMAC envelope, а старій перевіреній бізнес-логіці
    // передаємо внутрішній body з secret, підставленим тільки локально на сервері.
    var signedBody = secureAuthVerifyPostEnvelope_(outer);
    if (signedBody !== null) {
      var data = JSON.parse(signedBody);
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return jsonResponse({status:'error', message:'bad payload'});
      }
      data.secret = SYNC_SECRET;
      return legacyDoPostV65({postData:{contents:JSON.stringify(data)}});
    }

    // Тимчасова сумісність зі старою PWA. Після перевірки security.18 прибираємо.
    return legacyDoPostV65(e);
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
      return legacyDoGetV65({parameter:cloned});
    }

    // Тимчасова сумісність зі старим ?secret=... на час безпечного переходу.
    return legacyDoGetV65(e);
  } catch (err) {
    return jsonResponse({status:'error', message:'auth failed'});
  }
}
