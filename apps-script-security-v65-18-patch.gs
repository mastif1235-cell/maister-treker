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
   - replay-запити відсікаються через CacheService + короткий ScriptLock;
   - під час міграції старий secret-параметр ще підтримується, тому стара PWA
     не ламається між deployment Apps Script і ввімкненням security.18 у клієнті.

   ПІСЛЯ успішного тесту security.18 legacy fallback треба вимкнути окремим релізом.
*/

var SECURE_AUTH_V2 = 2;
var SECURE_AUTH_MIN_SECRET_LENGTH = 32;
var SECURE_AUTH_MAX_SKEW_MS = 5 * 60 * 1000;
var SECURE_AUTH_NONCE_TTL_SEC = 600;
var SECURE_AUTH_MAX_BODY_CHARS = 8 * 1024 * 1024;

function secureAuthBase64Url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function secureAuthConstantTimeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function secureAuthServerReady_() {
  return String(SYNC_SECRET || '').length >= SECURE_AUTH_MIN_SECRET_LENGTH;
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

  // CacheService сам по собі не має atomic "put-if-absent". Без lock два
  // одночасні replay-запити теоретично могли обидва побачити порожній cache.
  // Тримаємо lock лише на кілька мілісекунд навколо get+put, а не навколо
  // всієї бізнес-операції — legacyDoPostV65 далі бере свій основний lock окремо.
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(3000);
    var cache = CacheService.getScriptCache();
    var key = 'mt-hmac-nonce:' + nonce;
    if (cache.get(key)) return false;
    cache.put(key, '1', SECURE_AUTH_NONCE_TTL_SEC);
    return true;
  } catch (err) {
    return false;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function secureAuthVerifyPostEnvelope_(outer) {
  if (!secureAuthServerReady_()) return null;
  if (!outer || Number(outer.v) !== SECURE_AUTH_V2) return null;
  var ts = String(outer.ts || '');
  var nonce = String(outer.nonce || '');
  var body = String(outer.body || '');
  var sig = String(outer.sig || '');
  if (!secureAuthFreshTimestamp_(ts)) return null;
  if (!body || body.length > SECURE_AUTH_MAX_BODY_CHARS) return null;
  // HMAC-SHA256 у base64url без '=' завжди рівно 43 символи.
  if (!/^[A-Za-z0-9_-]{43}$/.test(sig)) return null;
  var canonical = ts + '\n' + nonce + '\nPOST\n' + body;
  if (!secureAuthConstantTimeEqual_(secureAuthExpectedSig_(canonical), sig)) return null;
  if (!secureAuthConsumeNonce_(nonce)) return null;
  return body;
}

function secureAuthVerifyGet_(p) {
  if (!secureAuthServerReady_()) return false;
  p = p || {};
  if (Number(p.v) !== SECURE_AUTH_V2) return false;
  var ts = String(p.ts || '');
  var nonce = String(p.nonce || '');
  var action = String(p.action || 'list');
  var id = String(p.id || '');
  var sig = String(p.sig || '');
  if (!secureAuthFreshTimestamp_(ts)) return false;
  if (action.length > 100 || id.length > 500) return false;
  if (!/^[A-Za-z0-9_-]{43}$/.test(sig)) return false;
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
