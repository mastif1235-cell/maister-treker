# Android dispatcher recovery candidate — v91.91 / runtime-136

## Production incident and rollback

Physical Android v91.90 failed acceptance. The device reported 436 local
tickets, so a ~200-ticket local database is not the explanation. Report delivery
was not connected (`GOOGLE_CONNECTION_REQUIRED`); the old compact/Other UI was
still visible. No historical full sync should run until runtime, connection,
and new-ticket delivery pass on that device.

Production rollback commit: `ecd1bd956efd66d49ef4843490c844ca585ae699`.
Its tree equals stable `dda0cad9845dd32ba1c075d336e7f8f9d1bc9689`
(v91.89 / runtime-134). Existing dispatcher deployment was restored to GAS v7,
with unchanged URL, Only me and USER_ACCESSING. This does not delete report rows.

## Evidence versus hypothesis

The old service worker used global `caches.match`, which can read a different
release cache. A deterministic regression reproduces that cross-cache risk.
This does NOT prove which bytes the physical Android device executed: no device
cache dump was obtained. The stale/mixed runtime explanation remains a strong
hypothesis, not a proven per-asset incident diagnosis.

The report bridge could time out while its standalone caller was backgrounded.
Successful verification did not restore the `connected` flag after such a timeout.
The regression covers delayed ACK and concurrent foreground resume. Actual
Android opener loss remains a device gate; WindowProxy state is not persisted.

## Candidate delta from PR #82

- Read assets only from this service worker's named cache; never another release.
- Foreground update checks, throttled to one minute; existing draft-safe reload
  remains in place. No IndexedDB/localStorage/cache reset command is introduced.
- Read-only runtime diagnostic: eight cached SHA-256 hashes against the published
  `runtime-proof.json`, plus executed compact/renderer/report revision markers.
  This is evidence for those assets, not a claim about every executed module.
- Regenerate proof with `node scripts/build-runtime-proof.cjs` after changing
  one of its eight inputs; tests enforce exact hashes.
- Keep a backgrounded RPC pending for at most five minutes; no extra mutation is
  issued during the wait. Queue retry still uses existing receipt semantics.
- Coalesce resume events and mark connected only after successful status ACK.
- Without a live peer, explain the explicit reconnect requirement; never pretend
  a popup READY or saved endpoint is a connection.

The fix branch includes the PR #82 feature tree that production rollback removed.
The comparison against main therefore intentionally restores those changes too.
Worker, AI, legacy GAS/transport, storage schema and backup are not modified by
the new delta. No actual user database is cleared or migrated.

## Release gate

Keep this PR DRAFT. No new frontend/GAS rollout is performed by this change.
Require green CI and controlled desktop/live verification before another release.
Physical Android must then show the actual runtime diagnostic, unchanged local
count, clean compact/Other UI, status ACK, new-ticket delivery and reconnect/retry.
Only then run historical full sync. Compare projected eligible IDs, expected/ACK,
failed/unresolved, server ID-set hash and queue; classify legacy anomalies rather
than equating raw Google source rows with Android ticket count.

If the candidate fails critically, coordinated rollback remains frontend
v91.89/runtime-134 and dispatcher GAS v7; rolling back only one side is insufficient.
