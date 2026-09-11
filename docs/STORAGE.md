# Storage ownership

This registry documents ownership; it does not migrate, clear, or rename existing data.

| Storage | Key / database | Owner | Purpose | Retention | Secret |
|---|---|---|---|---|---|
| localStorage | `settings` | settings-core | Preferences and device integration settings | Persistent | Yes: contains credentials |
| localStorage | `shifts` | storage-orchestration | Shift presentation cache | Persistent | No |
| localStorage | `deletedTickets` | tickets-domain | Recoverable ticket trash | Persistent | No |
| localStorage | `naryadQueue` | storage-orchestration | Dispatcher draft orders | Persistent | May contain personal data |
| localStorage | `ticketDraft` | ticket-editor-domain | Unsaved ticket draft | Temporary | Personal data |
| localStorage | `dailyMastersDefault` | ticket-editor-domain | Daily crew choice | Daily | No |
| localStorage | `pendingTicketsFallback` | ticket-state-storage | Emergency copy after IndexedDB write failure | Until successful durable write | Personal data |
| localStorage | `pendingShiftsFallback` | storage-orchestration | Emergency copy of shifts after a localStorage write failure | Until successful durable write | No |
| localStorage | `mtSavedDiagnosticsV1` | tools-domain | Saved diagnostics | Persistent | Personal/network data |
| localStorage | `mtNetworkPointsV1` | tools-domain | Network points and local photo references | Persistent | Personal/network data |
| localStorage | `mtToolsCalculatorDraftV1` | tools-domain | Tools diagnostic draft | Temporary | Personal data |
| localStorage | `mtOfflineAreasV1` / `mtOfflineAreaBoundsV1` | tools-domain | Offline area UI metadata / legacy read compatibility | Persistent | No |
| localStorage | `mtOfflineMapMetaV1` / `mtOfflineMapModeV1` | offline-map-storage | Active PMTiles slot metadata and mode | Persistent | No |
| localStorage | `mt-maptiler-key-v1` | maptiler-local-config | Device-local MapTiler BYOK key | Persistent | Yes; excluded from exports |
| localStorage | `mt-map-layer-v1` | maptiler-local-config | Selected online layer | Persistent | No |
| localStorage | `mt-single-writer-lease-v1` | single-writer-lock | Expiring fallback writer lease | Temporary lease | No |
| localStorage | `appLockThrottleV1` | security-lock | Failed-unlock throttling | Security state | No password |
| localStorage | `dailyBackupIndex`, `externalDailyBackupDate` | backup | Backup index and reminder date | Persistent/daily | No |
| localStorage | `cleanupReminderMonth`, `tgMonthlyReportMonth` | orchestration/Telegram | Monthly idempotency markers | Monthly | No |
| IndexedDB | `masterTrackerTickets` / `tickets` / `all` | ticket-storage | Canonical tickets | Persistent | Personal data |
| IndexedDB | `masterTrackerPhotos` / `photos` | photo-storage | Local photo bytes | Persistent | Personal data |
| IndexedDB | `masterTrackerBackups` / `daily` | backup-storage | Daily snapshots and non-extractable password vault records | Persistent/rotating | Yes |
| IndexedDB | `maisterTrackerSync` / `journal` / `state-v1` | sync-journal-storage | Durable sync mutations and conflicts | Persistent | Personal data |
| OPFS | `master-tracker-offline-maps/map-a.pmtiles`, `map-b.pmtiles` | offline-map-storage | A/B-installed offline map | Persistent | No |

`sessionStorage` currently has no production-owned keys. Unknown or legacy browser-storage keys are deliberately preserved. There is no namespace-wide `clear()` operation or automatic cleanup migration.
