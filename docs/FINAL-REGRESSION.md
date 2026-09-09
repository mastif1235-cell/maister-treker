# Final practical regression checklist

Automated rows name the deterministic regression that owns the scenario. Manual rows are intentionally not presented as automated proof and belong to the Android release smoke test.

| # | Scenario | Verification |
|---:|---|---|
| 1 | New ticket | Automated: `ticket-save-durability.test.js` |
| 2 | Edit ticket | Automated: `tools-v84-field-update.test.js` |
| 3 | Delete ticket | Automated: `sync-engine-runtime.test.js` |
| 4 | Draft save/restore | Automated: `ticket-draft-reliability.test.js` |
| 5 | Ticket photos | Automated: `tools-v83-field-package.test.js`; Manual: capture/share permission UI |
| 6 | Calculator | Automated: `ticket-financial-content-regression.test.js` |
| 7 | Shift/hours | Automated: `legacy-shifts-migration.test.js` |
| 8 | Search | Automated: `ticket-signal-report-comment.test.js` |
| 9 | Calendar | Automated: `tools-v80-field-ux.test.js` |
| 10 | Backup create | Automated: `backup-system.test.js` |
| 11 | Backup restore | Automated: `backup-corruption-atomic.test.js` |
| 12 | Wrong backup password | Automated: `backup-system.test.js` |
| 13 | Corrupt backup | Automated: `backup-corruption-atomic.test.js` |
| 14 | Export | Automated: `privacy-export-boundaries.test.js`; Manual: native download UI |
| 15 | Telegram backup | Automated: `telegram-transactional-backup.test.js` |
| 16 | Telegram ambiguous retry | Automated: `telegram-auto-retry.test.js` |
| 17 | Sync | Automated: `sync-engine-runtime.test.js` |
| 18 | Two-device conflict | Automated: `sync-conflict-resolution.test.js` |
| 19 | Offline startup | Automated: `sw-upgrade-static.test.js`; Manual: cold start in airplane mode |
| 20 | Service Worker update | Automated: `sw-upgrade-static.test.js`; Manual: installed-PWA update presentation |
| 21 | MapLibre online OSM | Automated: `maplibre-stage1-adapter.test.js`; Manual: WebGL rendering |
| 22 | Satellite BYOK | Automated: `v91-maptiler-byok.test.js`; Manual: device-local key and provider response |
| 23 | Offline PMTiles | Automated: `offline-map-storage.test.js`; Manual: imported region in airplane mode |
| 24 | Leaflet fallback | Automated: `maplibre-android-fixes.test.js`; Manual: fallback map interaction |
| 25 | GPS | Automated: `v9112-gps-marker-preference.test.js`; Manual: permission and live accuracy |
| 26 | Geo picker | Automated: `post-v91-geo-hotfix.test.js`; Manual: touch drag and Google Maps action |
| 27 | Network points | Automated: `v88-network-point-preview.test.js` |
| 28 | Diagnostics | Automated: `v9112-unified-diagnostics.test.js` |
| 29 | Privacy/secrets | Automated: `safe-error.test.js`, `secrets-static.test.js` |
| 30 | City/street autocomplete | Automated: `v9112-address-autocomplete.test.js`; Manual: Android keyboard tray |
| 31 | High-risk modal cancel/confirm | Automated: `high-risk-modal.test.js`; Manual: focus and Android back |
| 32 | Lock/single-writer fallback | Automated: `single-writer-lock.test.js`, `single-writer-persistence-guards.test.js` |

## Android release smoke test

Use the installed production PWA without clearing site data. Verify update activation, existing ticket visibility, ticket create/edit/draft, high-risk modal Cancel and confirm, city/street keyboard tray, GPS and coordinate picker, online MapLibre, one offline PMTiles region in airplane mode, Leaflet fallback, and native backup download. No smoke-test step requires deleting real user data.
