# Gate 2 — old PWA / Service Worker upgrade

Status: **browser-runtime PASS; installed-shell confirmation remains manual**. No production endpoint, Sheet, deployment or secret was used or changed.

## Test setup

- Old build: real v62 commit `0add41022ee5ef4a7609f36e64526107fd376657`, cache `maister-treker-v62`.
- Candidate: current v66 branch, cache `maister-treker-v66-runtime-2`.
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

- The v62 cache was removed and only `maister-treker-v66-runtime-2` remained.
- A reload with the local server stopped loaded the candidate offline and showed all three shifts.
- Reopening the app preserved the data and showed the recovered ticket as synced.
- The durable journal contained committed records for the pending ticket, deleted ticket, both pre-existing shifts and the shift added from the stale v62 tab; every record had `head: null` and `tail: null` after recovery.
- The delete record remained a committed tombstone.

The test exposed a genuine compatibility gap: v62 shifts carried no persisted pending marker, so mutations made by a stale old tab could otherwise be invisible to v66. The candidate now adopts all existing shifts into the v3 journal once, persisting those transitions before writing `mtSyncV3ShiftsMigrated=1`. Re-entry before the marker is safe: an unattempted head is replaced at the same revision, while an attempted head can only gain its serialized tail.

## Remaining manual boundary

The available automated browser exposes real Service Worker, Cache Storage, IndexedDB, localStorage, online/offline and reopen behavior, but not the operating-system installed-PWA window or launch icon. Therefore the code/runtime upgrade path passed, while one final production procedure remains manual: launch a previously installed old PWA from its existing icon, allow v66 to activate, close/reopen that installed window, and confirm the same data and version without clearing storage.

One Low UX observation remains: the sync badge can stay pending until the next render even after the journal is acknowledged; reopening showed the correct synced state. No data loss or duplicate operation was observed.
