# Dispatcher presentation and material statistics — v92.03 / runtime-148

Review candidate only. No deployment, rebuild, queue retry or user-data migration
is performed by this change.

## Optional structured field

`materials_json` is an optional canonical JSON string containing only objects
with `label`, `quantity`, `unit` and optional `unit_price`. Labels use NFKC and normalized whitespace;
units are `шт.` or `м`. Quantities must be finite and positive; pieces must be
integers. Zero/unchecked source entries are omitted by projection. Equipment
uses `consumption_qty ?? qty ?? 1` and `price`; cables use `meters` and
`pricePerMeter`, never total line cost. Prices must be finite numbers in
0–1,000,000,000, normalized to currency cents. Producers omit zero prices;
explicit stored zeros remain readable without rewriting their bytes/hash.
Labels pass the existing
public sanitization and strict privacy/injection validation. No internal IDs,
notes or arbitrary properties are copied into this field; prices are limited
to the public structured unit price.

Same normalized label/unit/unit-price is summed; different labels, units or
prices remain distinct. Missing/zero prices form one unpriced group, separate
from positive prices. The consistent display is `Роутер — 2 шт. — 1500 грн`
and `UTP — 25 м — 10 грн/м`; quantities are never multiplied by price in stats.
New configured labels require no code changes. Per-ticket limits are 100 groups,
160 characters per label and 20,000 characters of JSON. Period aggregation does
not impose the per-ticket group limit. Monetary accounting is unchanged.

The existing 27 required DTO fields remain required. The optional field is added
to the canonical content only when present, so legacy DTO hash bytes are
unchanged. New material content is hash-bound using the existing SHA-256 path;
no HMAC, request binding, ACK or stale-version rules change.

## Storage and historical compatibility

The dispatcher-only `_DispatcherData` header appends `materials_json` after the
existing 29 columns, retaining every old column position. Reading either header
is non-mutating. The next authorized write/setup appends the header; it never
clears rows. Blank legacy cells mean the field is absent, **not** an empty array.
Old hashes and tombstones survive the roundtrip. Conflicting headers, malformed
JSON and tampered hashes are rejected.

Rows without structured usage display only the existing positive ONU/router
counters. They do not invent cables/UPS from notes or pretty display text.
Rows with the field use it exclusively, including explicit `[]`; fixed counters
remain internal and do not double-count materials. ONU replacement remains a
separate work statistic. Historical rows gain richer detail only through an
ordinary later update; a full resync is neither required nor performed.

An existing row projected with newly added material content has a different
content hash. The existing same-version/different-hash fence remains enforced;
this PR does not overwrite it or automatically retry old operations. In a future
approved rollout, deploy compatible GAS before the frontend. Rolling GAS back
to a version that cannot validate rich rows is not a supported rollback after
new rich rows have been accepted; retain the compatible storage reader.

## Presentation

Normal and `Інше` tickets show one `💰 Разом` line using the existing `total`.
Daily/weekly/monthly summaries reuse the existing accounting aggregator with a
dynamic material section, omitted when empty. B:E panel coordinates, merges,
borders, colors and height algorithm are unchanged.

Dispatcher badges reuse the existing `tc-sync-badge` base and the exact existing
success/pending/error declarations via `data-delivery-state` selectors. Live
state refresh therefore cannot leave stale presentation classes. Compact cards
and delivery transitions are unchanged.

## Regression coverage

`dispatcher-material-price.test.js` covers real same-label router price variants,
cable per-meter variants, A–M, price-only stale/hash fencing, explicit zeros and
old/new priced JSON read-only storage compatibility.
`dispatcher-material-stats.test.js` covers requested A–O scenarios, independent
periods, future labels, canonicalization, units, privacy, tamper rejection and
the real GAS legacy/new-header storage roundtrip. Existing presentation,
per-item ACK, durable receipts, AUTO-OFF, retry and security suites stay active.
