# Dispatcher contact / free-service presentation hotfix

Candidate: **v92.10 / runtime-155 / maister-treker-v85-runtime-155**.
Base: `45f27f46c27ef68732f9f3a3d7e04ea54f748a8a` (merged PR #93).
Review only: no production deployment, user-data changes or queue operations.

## Root cause and canonical inputs

The dispatcher projection already canonicalized free-payment totals to zero,
but independently copied a positive saved `ticket.callFee` into `service_fee`.
The formatter displayed that fee without checking the payment. Projection now
omits the field for `Безкоштовно`; formatting also suppresses legacy positive
fees on free rows. Paid repair still displays `Виклик`, paid connection displays
`Підключення`. Saved tickets and `callFee` are not mutated.

`js/ticket-editor-domain.js` reads the saved structured `clientName` / `phone`
from the editor's `f_client` / `f_phone` controls. Only those fields are projected
into `client_name` / `client_phone`. No name/phone parsing from imported content,
notes or dispatcher comments. Tariff, material quantities/prices/physical stats
and the existing saved-total behavior are unchanged.

## Final normal card order

Header → contract → address (city-only fallback) → full name → phone → MAC →
partner → materials → service fee → tariff → payment → total → dispatcher note.
Empty optional blocks are absent. The note remains last. `Інше` stays header
plus note, even if an old row contains other fields.

## Structured privacy boundary

Contacts are optional typed fields, not a generic privacy-filter exception.
Names have bounded letter/punctuation validation. Phones preserve saved readable
spelling after outer trim, with 7–15 digits, bounded length and only phone
punctuation. Credentials, URLs, control characters and formula syntax fail closed.
The leading `+` exception is confined to the validated `client_phone` field;
the existing `_DispatcherData` writer stores cells as text. Arbitrary strings
still pass the existing formula guard. HMAC/authentication code is unchanged.

Public-note projection retains the previous sanitizer and additionally removes
unlabelled phone-like values with 7–15 digits, allowing spaces, parentheses and
hyphens while preserving letter/digit token boundaries. Quantities, money,
dates, times and MAC values remain unchanged. Incoming signed DTOs cannot
bypass that boundary with a phone in `dispatcher_comment`. This check is only
on incoming upserts: historical row reads/hashes are not changed or rewritten.
Material sanitization and material aggregation use the original code.

## Append-only compatibility

The mandatory 27 fields stay frozen. Optional column order is now:
`materials_json`, `contract_number`, `service_fee`, `tariff_amount`,
`client_name`, `client_phone`.

New nonempty contact values are hash-bound. Undefined contacts are excluded from
canonical content, keeping every previous canonical field order/hash valid.
The existing prefix-schema reader and header-only extension support old rows;
blank appended cells are omitted on read. No historical rewrite or reorder.
Storage tests cover four prior schema prefixes, contact round-trip and tampering.

## Regression evidence

- `dispatcher-client-contact-free-fee.test.js`: A–O cases, paid/free repair and
  connection, exact order, omissions, structured contacts, note privacy,
  immutable source, old hashes, hash-bound new contacts and unchanged stats.
- `dispatcher-connection-presentation.test.js`: prior schemas, header-only
  extension, actual GAS write/read, contact tampering, prior presentation rules.
- `dispatcher-report-gas.test.js`: signed typed phone, formula/invalid-phone
  rejection, hash mismatch and direct free-text phone rejection before write.
- `e2e/dispatcher-report-layer.spec.js`: real browser projection/rendering,
  contact ordering, free repair fee omission, canonical zero total, material
  preservation and no script errors (synthetic in-memory fixtures only).

Transport, outbox, ACK, HMAC, replay, retry/reconcile, AUTO, legacy GAS/Sheets,
Telegram, AI, maps, compact/photo behavior and B:E panel layout remain frozen.
Version-bearing modules only receive coordinated release literal updates.
Production deployment will require the compatible dispatcher bundle first;
this PR does not perform any rollout or historical sync.
