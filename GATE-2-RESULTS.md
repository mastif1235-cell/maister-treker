# Gate 2 — old PWA / Service Worker upgrade

Status: **PASS**, including the installed desktop PWA shell. No production endpoint, Sheet, deployment or secret was used or changed.

## Test setup

- Old build: real v62 commit `0add41022ee5ef4a7609f36e64526107fd376657`, cache `maister-treker-v62`.
- Candidate: current v66 branch, final cache `maister-treker-v66-runtime-3`.
- Upgrade used the same fresh browser origin and profile without clearing site data.
- Sync recovery targeted only the isolated TEST GAS/Sheet from Gate 1.
- The old v62 tab remained open while the v66 Service Worker installed and activated. A third shift was then saved from that stale tab before the candidate page reloaded.

## Preserved state

The post-upgrade probe and reopened UI confirmed:

- two legacy tickets, including one pending update;
- three shifts, including the shift saved by the still-open v62 tab after v66 activation;
- one legacy pending cloud delete;
- theme and hourly-rate settings plus an explicit upgrade sentinel;
- current, dated and legacy-migrated backup slots;
- IndexedDB photo and backup payloads.

Legacy ticket flags (`synced`, `syncAction`) and `pendingCloudDelete` were migrated out of business records after their durable journal transitions were written.

## Service Worker and recovery

- The v62 cache was removed and only the current v66 cache remained; the final release-identity correction advanced it to `maister-treker-v66-runtime-3`.
- A reload with the local server stopped loaded the candidate offline and showed all three shifts.
- Reopening the app preserved the data and showed the recovered ticket as synced.
- The durable journal contained committed records for the pending ticket, deleted ticket, both pre-existing shifts and the shift added from the stale v62 tab; every record had `head: null` and `tail: null` after recovery.
- The delete record remained a committed tombstone.

The test exposed a genuine compatibility gap: v62 shifts carried no persisted pending marker, so mutations made by a stale old tab could otherwise be invisible to v66. The candidate now adopts all existing shifts into the v3 journal once, persisting those transitions before writing `mtSyncV3ShiftsMigrated=1`. Re-entry before the marker is safe: an unattempted head is replaced at the same revision, while an attempted head can only gain its serialized tail.

## Installed-shell confirmation

On 2026-08-23 the user completed the missing desktop Chrome test on the same localhost origin without clearing site data:

- installed real v62 and launched it as a separate PWA window;
- created a ticket, a 7-hour shift and hourly-rate setting `321`, then closed/reopened from the installed shortcut and confirmed all three;
- while the installed v62 window remained open, made v66 available on the same origin and opened a normal Chrome tab to trigger the Service Worker update;
- continued using the still-open old window and saved a second 8.5-hour shift;
- closed/reopened through the existing installed-app entry and confirmed the v66 UI and all prior data;
- after a stale release label was exposed, corrected the canonical label and cache revision in commit `872d64144dfb0741836c402b52c9338bcf0fcb35`, repeated the installed-app update, and visibly confirmed `v66 · 2026-08-23`;
- stopped the local server, reopened the installed PWA offline and confirmed the ticket and both shifts remained available.

This closes the operating-system installed-PWA boundary. No cache/data clearing, reinstall workaround, data loss or duplication was reported.

One Low UX observation remains: the sync badge can stay pending until the next render even after the journal is acknowledged; reopening showed the correct synced state. No data loss or duplicate operation was observed.
