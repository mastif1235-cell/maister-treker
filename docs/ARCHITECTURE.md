# Майстер-Трекер: current runtime architecture

This document describes the maintained browser runtime. Historical audit evidence remains in `AUDIT.md`.

## Application and map runtime

- Production is a static GitHub Pages PWA. `index.html` declares script order; `sw.js` caches and updates the app shell but does not inject modules.
- MapLibre is the default map engine. Leaflet remains an explicit compatibility fallback and is intentionally not removed.
- Online maps use OSM or user-provided MapTiler Satellite credentials. Credentials stay device-local and are sent only to the configured provider.
- Offline maps are PMTiles v3 archives stored in OPFS. Import uses validated A/B replacement so the installed archive remains available until its replacement succeeds.
- GPS, coordinate picking, network points, and filters use the selected map adapter without changing stored ticket or network-point schemas.

## Persistence and recovery

- Tickets, shifts, photos, backups, the sync journal, and durable application state remain in IndexedDB according to their existing owners.
- Local preferences, drafts, lock metadata, map configuration, and small indexes use registered localStorage keys. Ownership and retention are listed in `STORAGE.md`.
- Corrupt JSON reads fall back safely. Unknown legacy keys are preserved; there is no namespace-wide cleanup or destructive storage migration.
- Draft restore is independent from committed ticket data. Cancelling a destructive modal does not mutate persistent state.
- Encrypted backup creation and restore use atomic envelope/payload validation. Existing backup formats and encryption parameters remain compatible.

## Sync, conflicts, and Telegram

- The bounded sync journal serializes entity mutations. Revision conflicts are entity-scoped and preserve the local operation for explicit recovery rather than silently overwriting remote state.
- Google Apps Script and client sync contracts are versioned compatibility boundaries; this browser-maintenance work does not change them.
- Telegram backup keeps the previous complete copy until a replacement is complete. Ambiguous delivery may leave an extra remote message, but it must not make local save or Google sync fail.

## Privacy and errors

- HMAC and server properties remain server-side. Device-held Telegram and optional MapTiler credentials are excluded from backup/settings exports.
- `MTSafeError` normalizes operational errors and redacts tokens, authorization headers, API keys, passwords, HMAC material, and circular values before technical logging.
- User cancellation is not reported as an application failure. System errors do not enter ticket diagnostic history.

## Service Worker update safety

- A unique release cache identifies each app-shell revision.
- Navigation and production code can start from the cached shell offline while an online refresh updates cached assets.
- Activation removes obsolete app caches only. It does not clear IndexedDB, localStorage, OPFS, drafts, backups, photos, or user data.

## Runtime ownership and maintenance

- Classic scripts intentionally expose legacy global APIs; load order in `index.html` and the matching asset entry in `sw.js` are part of the runtime contract.
- Large domains are split only at mechanical boundaries. `tools-diagnostics-network.js`, for example, owns connection and speed-test operations while `tools-domain.js` retains shared tools state and screen lifecycle.
- Version-suffixed compatibility/security files are retained when they participate in declared load order or migration behavior. They are not dead solely because their names are historical.
- IDs are opaque stable strings. UUIDs must not be interpreted as timestamps; creation and ordering time lives in explicit date fields.

## Verification

Automated tests cover pure rules, storage fallback, sync/retry/conflict behavior, backup validation, safe errors, high-risk modal lifecycle, online/offline maps, diagnostics, autocomplete, and static asset wiring. Device-only behavior such as Android keyboard layout, native share/download UI, two-finger map gestures, GPS permission prompts, and installed-PWA update presentation remains a documented manual release check.
