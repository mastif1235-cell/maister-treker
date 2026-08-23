# v66 production-candidate decomposition checkpoint

## Scope and result

- Accepted security baseline: `563949721487ffa757c565cd23042c8d8067df2d`.
- `app.js` decreased from 352,070 bytes / 5,234 lines to 40,769 bytes / 537 lines: 88.4% fewer bytes and 89.7% fewer lines.
- Behavior, storage schemas, sync protocol and UI/UX contracts were preserved. No framework, bundler or Service Worker loader was introduced.
- `app.js` is now the composition root: shared mutable state, the unchanged sync application facade, deterministic `init`, lifecycle listeners and Service Worker registration.

## Canonical domain owners

- Pure format helpers: `app-format-utils.js`.
- QR/dogovor and sharing: `qr-share-domain.js`, `share-domain.js`.
- Reports/import/export UI: `reports-domain.js`.
- Settings: `settings-core.js`, `settings-domain.js`.
- Photos and Telegram workflows: `photo-telegram-domain.js`.
- Shifts: `shifts-domain.js`.
- Tickets: `ticket-editor-core.js`, `ticket-editor-domain.js`, `tickets-domain.js`, `tickets-bindings.js`, `ticket-address-domain.js`.
- Local persistence presentation/facades: `storage-orchestration.js`.
- Shared DOM shell/tab navigation: `ui-orchestration.js`.

Every moved function has one source owner; the source implementation was removed from `app.js` in the same logical change. Three superseded share wrappers (`share-fix-v65-11.js`, `share-photo-picker-v65-12.js`, `share-multi-fix-v65-17-2.js`) were consolidated into the canonical share owner and deleted. A full declaration scan reports 331 unique top-level runtime function owners and no duplicate declarations.

## Regression result

All 15 automated/static suites pass: pure helpers; app lock; backup owner/envelope; decomposition owners/load order; share parity; DOM/QR/CSP; GAS contract/static vectors; secrets; Service Worker upgrade simulation; sync core/runtime/transport/owner checks. Every runtime and test JavaScript file passes `node --check`; `git diff --check` passes.

The sync journal/transport, canonical backup envelope, app-lock primitives, QR fragment flow and CSP/header policy remain at their accepted checkpoint behavior. Legacy search confirms that `retrySyncQueue` is only UI over the engine; `synced`, `syncAction` and `pendingCloudDelete` are migration reads; `deletedTickets` is trash/UI compatibility data; `no-cors` is the bounded canonical transport mode. Three Telegram/photo `window.fetch` adapters remain an ordered security/data boundary and do not own ticket/shift mutations.

## Residual findings

- Critical: 0 known.
- High: 0 known.
- Medium: client-held Telegram bot token; GitHub Pages cannot enforce the checked-in response-only anti-framing headers.
- Low: escaped-template DOM renderers remain maintenance-sensitive; inactive compatibility fields and the ordered Telegram/photo adapter chain should be consolidated only with dedicated runtime parity tests.

## Mandatory production gates

1. Test readable CORS and bounded opaque verification on an isolated test GAS deployment. Do not change production GAS or Sheets for this test.
2. Upgrade an actually installed old PWA/Service Worker to v66 without clearing data. Verify IndexedDB/localStorage preservation, pending journal recovery, cache replacement and deterministic reload.
3. Apply/verify real host security headers at the selected production host and re-evaluate the GitHub Pages anti-framing limitation.

No production deploy, GAS/Sheets mutation, secret rotation or merge to `main` occurred.
