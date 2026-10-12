# PR #93 final presentation cleanup

Candidate: v92.08 / runtime-153 / maister-treker-v83-runtime-153.
This advances the immutable runtime identity because shared report-core bytes
changed. No merge/deploy or live-data/queue access.

Only formatter logic change versus reviewed c9117b85: when address_display is
present, render its address line instead of a separate city line. If absent,
render city only when present. Never duplicate the city.

Normal connection order: header, contract, address (or city fallback), partner,
materials, MAC, saved service fee, tariff, payment, saved total, public dispatcher
comment LAST. MAC stays unchanged after materials, before all financial lines.
Empty MAC disappears. Repair has the same MAC order and no fake connection fee.
Інше stays header plus note only, even if an old stored row has MAC/money fields.

Unit and real-browser projection/render regressions verify city deduplication,
city-only fallback, MAC presence/omission/order and the final comment. All
previous optional fields, old hashes, append-only storage, money/statistics,
compact alignment, photos and delivery rules remain covered.

No changes to projection/schema/GAS, transport/outbox/HMAC/ACK/retry/reconcile,
AUTO or material aggregation. Frontend runtime/client files have literals only.
