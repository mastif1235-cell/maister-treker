# app.js dependency map

Baseline at stable checkpoint `563949721487ffa757c565cd23042c8d8067df2d`: **352,070 bytes / 5,234 lines**.

## Runtime and initialization order

1. Vendor and pure modules load first (`qrcode.js`, core/data/finance/shift/report utilities and storage adapters).
2. Sync contract/core/journal/transport/runtime and app-lock core load before `app.js`.
3. `app.js` creates application state and function APIs. Its top-level initialization currently calls `loadSettings`, `loadJSON`, `formatDate` and `blankCalcState`.
4. Domain modules extracted from `app.js` load immediately after it. They may depend on application state but must not execute behavior at parse time.
5. Stabilized security/lock/backup extensions load after canonical app/domain APIs and may adapt only their documented boundaries.
6. `DOMContentLoaded → init()` applies theme/unlock, binds screens, opens ticket/sync/photo/backup databases, runs migrations, renders screens and starts recovery/timers.
7. Window load registers the Service Worker. Online/offline and beforeunload listeners are installed once.

Service Worker remains cache/update-only and is not a module loader.

## Shared mutable state

| State group | Variables | Current consumers |
|---|---|---|
| Persistent application | `settings`, `tickets`, `shifts`, `deletedTickets`, `naryadQueue` | settings, tickets, shifts, reports, Telegram, backup, sync |
| Sync facade | `syncEngine`, revision/snapshot variables | ticket/shift persistence, sync UI, startup |
| Navigation/query | current ticket/shift/calendar dates, `statsViewDate`, `searchQuery`, filter/render paging | tickets, calendars, shifts, tabs |
| Ticket editor | `calcState`, `editingTicketId`, draft/photo/session/default flags | calculator, ticket form, photos/share |
| Address/naryad | address navigation state, return state, pending naryad | address and ticket flows |
| Shift editor | `coworkerSelection`, shift Telegram flags | shifts/settings/Telegram |
| Device resources | photo/ticket/backup DB globals from storage adapters, scanner stream/RAF | photos, startup, scanner |

During this decomposition these bindings remain classic-script globals for compatibility. A domain may read them, but ownership stays singular. New mutable globals are forbidden unless documented here; dependency injection/pure parameters are preferred for newly extracted helpers.

## Public runtime APIs

- Bootstrap/navigation: `init`, `switchTab`, `openModal`, `closeModal`, `showToast`.
- Persistence: `saveTickets` (ticket-state-storage owner), `saveShifts`, `saveSettings`, photo and backup storage adapters.
- Screens: render/bind APIs for tickets, calculator, shifts and settings.
- Ticket workflows: edit/save/delete/restore/share/Telegram, address and naryad flows.
- Shift workflows: add/delete/report/share/Telegram.
- Stabilized boundaries: `syncEngine`, `MTSyncTransport`, `MTBackupSystem`, app-lock APIs and security sanitizers. These are reference behavior and are not decomposition starting points.

HTML event binding is programmatic; extracted functions remain global only where existing binders/security adapters resolve them by name. Duplicate definitions are rejected by static owner tests.

## Domain dependency direction

```text
pure utils / validation
        ↓
QR + share        reports
        ↓            ↓
settings/catalog ────┤
        ↓            │
photos + Telegram    │
        ↓            │
shifts           tickets/address/naryad/calculator
        └──────┬─────┘
          storage orchestration
                 ↓
          UI orchestration / init
```

Cross-domain calls that must remain explicit: ticket share uses photo/Telegram helpers; reports read tickets/shifts/settings; settings renders backup/lock state; startup orders all storage migrations before first render.

## Decomposition constraints

- Move contiguous behavior with no semantic rewrite; delete the source block in the same patch.
- Canonical extracted modules load explicitly in `index.html` and `sw.js`; no loader or bundler is introduced.
- Pure modules load before `app.js`. Stateful domain modules load after `app.js` but before stabilized adapters.
- Each block adds a static single-owner/load-order check and targeted behavior tests where a pure seam exists.
- Storage keys/schema and user-visible behavior remain unchanged.
