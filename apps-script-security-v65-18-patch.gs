/* Майстер-Трекер — Apps Script HMAC auth patch v65.0-security.18

   ВАЖЛИВО: перед вставкою цього блока зробіть ДВІ точкові заміни у поточному Code.gs:

     function doPost(e)  ->  function legacyDoPostV65(e)
     function doGet(e)   ->  function legacyDoGetV65(e)

   Після цього вставте ВЕСЬ цей блок у самий кінець Code.gs і створіть НОВУ
   версію deployment.

   Міграція навмисно використовує ДВА секрети:
   - SYNC_SECRET — старий legacy secret, який уже є у робочому Code.gs;
   - SECURE_AUTH_HMAC_SECRET — новий випадковий секрет мінімум 32 символи.

   Це дозволяє спочатку задеплоїти HMAC wrapper, НЕ ламаючи стару PWA 17.3,
   а вже потім перевести клієнт на новий HMAC secret. Реальний HMAC secret
   не комітити у GitHub — вставити тільки у фактичний Apps Script.
*/

var SECURE_AUTH_HMAC_SECRET = 'ВСТАВТЕ_НОВИЙ_HMAC_СЕКРЕТ_МІНІМУМ_32_СИМВОЛИ';
var SECURE_AUTH_V2 = 2;
var SECURE_AUTH_MIN_SECRET_LENGTH = 32;
var SECURE_AUTH_MAX_SKEW_MS = 5 * 60 * 1000;
var SECURE_AUTH_NONCE_TTL_MS = 10 * 60 * 1000;
var SECURE_AUTH_NONCE_LEDGER_KEY = 'MT_HMAC_NONCES_V1';
var SECURE_AUTH_NONCE_LEDGER_MAX = 96;
var SECURE_AUTH_MAX_BODY_CHARS = 8 * 1024 * 1024;
var SECURE_AUTH_GET_ACTIONS = {list:true, checkTicketExists:true, getTicketById:true};

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
  return String(SECURE_AUTH_HMAC_SECRET || '').length >= SECURE_AUTH_MIN_SECRET_LENGTH;
}

function secureAuthExpectedSig_(canonical) {
  var raw = Utilities.computeHmacSha256Signature(
    String(canonical),
    String(SECURE_AUTH_HMAC_SECRET),
    Utilities.Charset.UTF_8
  );
  return secureAuthBase64Url_(raw);
}

function secureAuthFreshTimestamp_(ts) {
  var n = Number(ts);
  if (!isFinite(n)) return false;
  return Math.abs(Date.now() - n) <= SECURE_AUTH_MAX_SKEW_MS;
}

function secureAuthNonceHash_(nonce) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(nonce),
    Utilities.Charset.UTF_8
  );
  return secureAuthBase64Url_(digest);
}

function secureAuthConsumeNonce_(nonce) {
  nonce = String(nonce || '');
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return false;

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(3000);
    var props = PropertiesService.getScriptProperties();
    var now = Date.now();
    var hash = secureAuthNonceHash_(nonce);
    var ledger = [];
    var raw = props.getProperty(SECURE_AUTH_NONCE_LEDGER_KEY);

    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return false;
        ledger = parsed;
      } catch (e) {
        return false;
      }
    }

    ledger = ledger.filter(function(entry) {
      return entry && typeof entry.h === 'string' &&
        Number.isFinite(Number(entry.ts)) &&
        now - Number(entry.ts) <= SECURE_AUTH_NONCE_TTL_MS;
    });

    if (ledger.some(function(entry) { return entry.h === hash; })) return false;

    ledger.push({h:hash, ts:now});
    if (ledger.length > SECURE_AUTH_NONCE_LEDGER_MAX) {
      ledger = ledger.slice(ledger.length - SECURE_AUTH_NONCE_LEDGER_MAX);
    }

    props.setProperty(SECURE_AUTH_NONCE_LEDGER_KEY, JSON.stringify(ledger));
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
  if (!SECURE_AUTH_GET_ACTIONS[action]) return false;
  if (!secureAuthFreshTimestamp_(ts)) return false;
  if (id.length > 500) return false;
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

    var signedBody = secureAuthVerifyPostEnvelope_(outer);
    if (signedBody !== null) {
      var data = JSON.parse(signedBody);
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return jsonResponse({status:'error', message:'bad payload'});
      }
      // Legacy business logic лишається незмінною: її старий секрет
      // підставляємо тільки локально після успішної HMAC-перевірки.
      data.secret = SYNC_SECRET;
      return legacyDoPostV65({postData:{contents:JSON.stringify(data)}});
    }

    // До strict cutover стара PWA 17.3 продовжує працювати зі старим SYNC_SECRET.
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

    // До strict cutover дозволяємо лише вже існуючий legacy шлях.
    return legacyDoGetV65(e);
  } catch (err) {
    return jsonResponse({status:'error', message:'auth failed'});
  }
}
