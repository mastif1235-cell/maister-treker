# PR #93 follow-up — structured dispatcher card

Candidate: v92.07 / runtime-152 / maister-treker-v82-runtime-152.
Review only: no merge, deployment, queue processing or live data changes.

## Source and ordering

`saveTicket` in `js/ticket-editor-domain.js` saves the effective service amount
to `callFee` after `effectiveTicketCallFee` applies the calculator rules.
`baseCallFee` is an input, not the saved charge; it is never used as fallback.
Missing/zero saved `callFee` produces no service line. Nothing defaults to 500.

Connection order: header, structured contract, existing city/address/partner,
materials (and existing MAC if present), saved service fee, tariff, payment,
saved total, real dispatcher comment **last**. Empty blocks disappear entirely.
Repair uses `Виклик`, never a fabricated connection charge. `Інше` remains
header plus note, without contract/materials/financial lines.

`ticket.sum` remains the canonical total; cash/cashless/free behavior and all
material/day/week/month aggregators are unchanged. No component is added twice.

## Optional contract and storage

New optional fields: `contract_number` (validated 1–80 character identifier),
`service_fee`, `tariff_amount` (positive finite money, maximum 1e9).
Contract is taken only from structured `ticket.contractNumber`.
Tariff is structured `ticket.tariff`; the previously supported exact app-labelled
raw-import tariff fallback is preserved in `tariff_amount`, never the note.
The note contains only public note text, using the existing privacy filter.

Required legacy fields and their canonical serialization order are unchanged.
Optional keys append after `materials_json` in both canonical hashing and
storage (after all legacy columns). Absent optional keys are not serialized.
Old schemas and contiguous optional-header prefixes are readable without writes;
schema extension writes headers/appends columns only. Blank historical cells
are omitted on read, preserving old content bytes and source hashes. No backfill,
historical rewrite or historical retry is performed. New supplied keys are
validated and hash-bound. Wrong headers fail closed.

Existing compact alignment, photos, collapse controls and normal full cards are
unchanged. No transport, AUTO, outbox, HMAC, ACK, retry/reconcile or legacy logic
changes; dispatcher client has release literals only.

## Offline regression

`tests/dispatcher-connection-presentation.test.js` checks realistic 4800 total,
contract/service/tariff, final-note ordering, omission, repair/other isolation,
privacy, canonical hash compatibility, append-only migration, actual GAS
read/write roundtrip, tampered-field hash rejection and deployable bundle parity.
Existing public Railway case now checks the dedicated tariff and final note.

Production GAS needs the reviewed combined bundle before frontend rollout in a
future separately authorized rollout. This PR does not deploy or backfill it.
