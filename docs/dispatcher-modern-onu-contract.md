# Modern / legacy ONU contract — v92.21 / runtime-168

Code-only candidate, cache `maister-treker-v98-runtime-168`, Draft PR #97.
No production writes, deployment, rebuild, full sync, historical correction or
queue actions are part of this change. No manual GitHub Actions are required.

## Root cause and persisted contract

v92.20 had no reliable marker. Its approved historical default therefore also
turned a newly unchecked connection into physical ONU = 1. Inferring modern
records from a date, cloudImported, or an empty equipment array cannot fix this.

New editor sessions (`blankCalcState`) now set `onuAccountingVersion: 1`.
`blankTicketObject` deliberately does not: it is also used to load/import legacy
tickets. Merely reading, opening, saving or importing an old ticket does not
assign a marker. An explicit user change to that connection's ONU checkbox may
opt it into version 1. No background upgrade or IndexedDB migration is added.

For version 1 connections, checked ONU = physical consumption 1. Unchecked ONU
= 0. Saved equipment is sparse, so a saved empty equipment array means OFF under
this explicit contract; selected saved ONU has no checked property and means ON.
Reopening expands the catalogue with unchecked defaults, preserving both states.
Legacy free text does not override a modern explicit choice. The separately
approved historical customer decision 1783937356209 is retained.

Without the marker, the approved legacy policy is unchanged: explicit customer
ONU evidence = 0; selected ours = 1; absent/empty/unchecked legacy equipment = 1.
This business default is not presented as newly discovered source evidence.
Unsupported marker versions or malformed marked canonical equipment return
REVIEW_REQUIRED and block projection/correction, not a guessed 0/1.

## Round-trip and compatibility

- Marker and equipment stay in the normal canonical object stored in IndexedDB.
- JSON backups and encrypted export/import preserve the optional field.
- `ticketToSyncPayload` places it in existing `fullDataJson`. Legacy JSON does
  not gain an undefined field; no new Sheet column or GAS schema is required.
- Existing cloud merge/restore copies the canonical JSON field without assigning
  it to unmarked rows. Existing signed transport and ACK protocol are unchanged.
- Dispatcher consumes the marker locally and emits existing `onu_used` only;
  no new Dispatcher DTO/header field or hash format is introduced.
- Saved ticket.sum/payments/fees/tariff and repair pricing are not recalculated
  by projection. Connection ONU still costs +0 in the calculator.
- The 13 repair decisions, positive three/zero ten, NO_ONU fixes, UNKNOWN holds,
  closed-August exclusions, approved aliases and two-line statistics remain.

The matching GAS requirement of the earlier full PR still applies; this marker
itself does not require a new GAS column or a data migration.

## Verification and historical audit gates

`dispatcher-onu-modern-contract.test.js` exercises modern ON/OFF, sparse canonical
serialization, actual signed sync through the GAS harness, restore, encrypted
backup/import, monetary invariants, no implicit legacy marker and review-required
malformed contracts. Browser E2E exercises real checkbox changes, save/edit,
IndexedDB restart and the real sync serializer/restore path. The original failing
OFF assertion remains unchanged.

Full real February-October audit is still a separate read-only step using the
three CSV snapshots described in [the historical plan](dispatcher-historical-final-release.md).
The existing CLI automatically applies this modern contract, legacy policy and
deduplication. Review-required IDs block the planner. No write executor is added.
Do not treat synthetic 6+4=10 or preliminary 185 as a verified historical total.
No historical recalculation is ready until real monthly and per-ID diffs have
been reviewed. No merge/deploy without separate user approval.
