/* Майстер-Трекер — security.18.7 HMAC nonce lock split

   ВСТАВИТИ ЦЕЙ БЛОК У САМИЙ КІНЕЦЬ поточного Code.gs ПІСЛЯ security.18 wrapper,
   потім Ctrl+S -> Deploy -> Manage deployments -> Edit -> New version -> Deploy.

   Причина: secureAuthConsumeNonce_ у security.18 використовував ScriptLock,
   а legacyDoPostV65 теж використовує ScriptLock для запису в таблицю.
   Через це read-only HMAC verify і бізнес-запис могли блокувати один одного.

   Цей append-only patch перевизначає ТІЛЬКИ secureAuthConsumeNonce_.
   Бізнес-логіка, HMAC canonical/signature та старий SYNC_SECRET не змінюються.
*/

function secureAuthConsumeNonce_(nonce) {
  nonce = String(nonce || '');
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return false;

  // ВАЖЛИВО: auth nonce ledger має свій lock і більше не конкурує
  // з business ScriptLock у legacyDoPostV65.
  var lock = LockService.getUserLock();
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
