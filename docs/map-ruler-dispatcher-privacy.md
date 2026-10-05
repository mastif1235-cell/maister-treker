# v91.86 / runtime-131: dispatcher privacy and temporary map ruler

Draft only. No merge, Pages publication, Worker release, tag or production change.
Runtime-130 is reserved by the previous release's rollback artifact; this candidate uses runtime-131.

## Dispatcher output boundary

`dispatcherForwardText` in `js/share-domain.js` is the single shared output filter.
It removes the canonical ticket geolocation and ONU-signal rows, recognized field variants,
map URLs, explicitly geo/location-marked coordinate pairs, and embedded optical readings.
Work descriptions, postal addresses, subscriber fields, MAC, equipment and financial lines remain.
The pre-existing internal diagnostics/debug exclusions remain.

Consumers audited/tested:

- current-form clipboard;
- saved-ticket clipboard (including textarea fallback);
- current-form Web Share;
- saved-ticket Web Share/photo picker;
- current-form Telegram dispatcher;
- saved-ticket Telegram dispatcher;
- report clipboard;
- report Web Share/clipboard fallback.

Report comments pass through the same filter. Telegram delegates to it without a second regex implementation.
Canonical `ticket.content`, structured geo/signal fields, ticket editor, technical details,
search, personal TXT/MD export, private Telegram backup/JSON restore and sync serialization are unchanged.
The regression test executes the real `ticketToSyncPayload` and verifies geo/signal fullDataJson round-trip.
The inline blocker follow-up removes labelled geo/signal fragments wherever they occur,
including before/after chains, while retaining the rest of a useful note/comment.
Removal-local separator cleanup preserves addresses, house numbers, money and ordinary negative values.
Unmarked numeric pairs are intentionally retained: the sanitizer must not infer geolocation from arbitrary numbers.
Twenty-two targeted inline/retention/idempotence cases supplement the field and eight-channel boundary tests;
the browser dispatcher case also verifies inline notes/comments and their original value retention.
This is a text-output boundary, not image/EXIF processing or a general natural-language anonymizer.
Network-object Telegram exports and contract/QR transfer are separate non-dispatcher workflows and are unchanged.

## Ruler

`js/map-ruler.js` provides one RAM-only state machine and two thin rendering paths:

- MapLibre (primary): dedicated `mt-ruler` GeoJSON source, line and point layers;
- Leaflet (actual WebGL fallback): dedicated LayerGroup, non-interactive polyline and circles.

The bottom-left control supports enable, multiple points, accumulated great-circle distance,
metres/kilometres, undo, clear and exit/Escape. Exit/remount discards measurement.
It never creates network objects or writes tickets/storage/sync.
MapLibre style changes restore only the temporary measurement overlays.
Ruler and placement/bounds-selection modes are mutually exclusive; object-opening and long-press
creation are suppressed only while measuring. Normal controls resume on exit.
Object picker, GPS, offline style/download/OPFS/A-B and satellite implementation are unchanged.

## Verification

- MCP: 716/716 PASS (unchanged Worker source).
- Frontend AI: 32/32 PASS.
- Initial candidate full E2E: 54/54 PASS; three new browser cases cover both real engines and dispatcher output.
  Inline-fix full regression: 53/54, with only the unchanged Ping monitor/Globalping scenario at
  `e2e/network-tools.spec.js:166` failing on response timing. Its isolated repeat passed 1/1 with
  no code, assertion or timeout changes. Both ruler cases and the expanded privacy browser case passed.
- Root: 212/213; only known `tests/network-tools-monitor.test.js:81` timing flaky,
  observed 47 ms versus 38–46 ms in the initial candidate, 48 ms in the inline-fix regression run.
  Its initial isolated repeat also observed 47 ms.
  An earlier full run passed Ping but exposed version-pin/test-fixture integration expectations;
  those were corrected without weakening assertions. Ping code/test/threshold are unchanged.
- Ruler unit: distance/total/units/validation/activation/undo/clear/exit,
  style restoration and real-object/GPS-overlay isolation PASS.
- Dispatcher boundary: eight paths, field variants, preserved work/payment/address,
  original data, private backup/export and actual sync round-trip PASS.
- Root privacy/restore/legacy regression checks: PASS.
- Syntax: 474/474 PASS; existing `mcp/scripts/check.sh`: PASS.
- `git diff --check`: PASS.

Initial E2E attempts were blocked by local process/junction restrictions; the Leaflet test URL
fixture was then corrected to select the actual fallback. Final targeted 3/3 and full 54/54 passed.

## Unchanged scope / rollout

No changes to `mcp/`, Wrangler/config/secrets, R2, Worker release flow, AI QueryState/analytics,
storage/schema, sync, ticket IDs, MapTiler configuration, offline-map format, Ping or Speedtest logic.
`app.js` changes only the candidate version. No Worker deploy is needed for this PR.
Version/cache pins and precache loading are updated only for a future approved frontend rollout.
GitHub CI must be checked on the exact draft HEAD before any merge.

After a future approved rollout, manually check on Android:

- dispatcher copy/share/Telegram and full report omit geo/signal, but ticket details still show them;
- online/offline/satellite ruler at narrow width: add points, pan/zoom, undo, clear, exit;
- GPS and real object markers still work; long-press opens the normal editor after ruler exit;
- reload discards measurement but preserves installed PMTiles and ticket geo/signal.

Remaining limitations: distance is straight-line/great-circle between selected points, not routing;
measurement is deliberately transient. Leaflet retains its existing offline fallback capabilities.
