# Maister Tracker architecture

## Rule: one owner per responsibility

The production application is being migrated away from runtime monkey-patch layering.

### Stable core
- `index.html` owns document structure and explicit core script order.
- `app.js` owns application behavior until a responsibility is deliberately extracted.
- `sw.js` owns offline/cache/network behavior only. It must not permanently own application composition.

### Runtime modules
`js/runtime-modules.js` is the inventory/source-of-truth for the temporary runtime layer during migration. Every runtime module must have one responsibility and an eventual destination.

### Sync target architecture
Sync must end with exactly these responsibilities:
1. transport/authentication (HMAC request construction),
2. queue/state machine (add/update/delete; delete wins),
3. server verification,
4. UI status reporting.

There must be one implementation of each responsibility. Versioned wrappers that reassign the same global functions are transitional only.

### Apps Script target architecture
The deployed Apps Script must have exactly one `doGet` and one `doPost`. Authentication, nonce validation, read-only verification, ticket writes and shift writes are helpers called by those entry points. Read-only verification must never call formatting or sheet-creation helpers that mutate the spreadsheet.

### Security invariants
- Subscriber credentials must never be placed in URL query parameters; QR payload uses the URL fragment.
- Sync credentials must not use the legacy plain-secret transport once HMAC migration is complete.
- Untrusted photo/string data must not be concatenated into HTML attributes.
- Backup secrets remain encrypted at rest according to the active vault/envelope implementation.

### Migration safety
All architecture work happens on `architecture-cleanup` until tested. Production `main` is not used as a refactoring scratchpad. Each migration step must be reversible and must preserve stored user data formats unless an explicit migration exists.
