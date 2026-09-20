# Stage 2A — local AddressBook identity

Scope: production-ready **2A only**. No ticket linking or ticket/schema migration.
The existing ticket.id, display address, photos, authorization, Sheets sync,
Telegram payloads and Worker v3 snapshot remain unchanged.

## Model and ownership

`settings.addressBook = {version:1,cities:City[],streets:Street[]}`.
City: `{id,name,aliases,active,createdAt,updatedAt}`.
Street: same fields plus immutable `cityId`.
UUID v4 comes from browser crypto, never a name hash or Math.random.
Rename changes name only; aliases must be entered explicitly (one per line).
Archiving a city hides its streets from the active projection without changing
their identities or individual archive flags. Restoring the city restores that view.
House and apartment remain ticket strings; no new entity or second ticket ID.

The existing localStorage settings envelope is retained deliberately: all current
directory readers, settings persistence and encrypted backups share this synchronous
boundary. Moving only identity into IndexedDB would introduce a second persistence
transaction and mixed-store backup/rollback failure modes. There is **no second store**.
`settings.cities` / `settings.streets` are derived compatibility views, not independent
editable sources after initialization. This small local directory remains offline.
An IndexedDB move can be evaluated with cross-device directory synchronization later.

## Additive migration and failure safety

After app unlock and writer-lock acquisition, seed UUIDs from the existing **directory**
only. Preserve distinct legacy names as independent identities, including ambiguous
case variants. Preserve orphan street-map keys by creating their directory city.
Persist all identities and compatibility views in one settings write. On a failed
write or denied writer lock, restore the prior in-memory settings and keep legacy data.
Do not publish transient IDs or rewrite any historical ticket. Invalid stored books
are not silently repaired or replaced; directory writes fail closed.

Address settings support add, rename, explicit aliases, archive and restore. Adding
an address while saving a ticket retains the old directory-registration behavior,
but skips ambiguous or archived city matches. The explicit “from tickets” directory
button is still opt-in and never modifies ticket data.

## Backup and two devices

Normal full/encrypted settings backups carry the canonical book and UUIDs. Legacy
backups without it remain importable. Restore unions UUIDs, retains local-only
identities and uses the explicitly restored backup metadata for shared UUIDs.
Changing a shared street's parent is rejected. Invalid relationships, versions and
UUID collisions reject the import before data writes. No fuzzy/name-based identity
merge occurs for UUID-bearing imports. A legacy import with streets under a name
shared by multiple existing city UUIDs is rejected rather than guessing or dropping streets.
Distinct device UUIDs remain distinct even
when names overlap. Exact normalized name/alias overlaps are duplicate candidates;
the UI warns but has no merge action. Different spellings without a shared explicit
alias are not guessed to be duplicates. Identical-name cities are selectable by UUID.

This is **local**, not live cross-device directory sync. Transfer a full settings
backup before editing on another phone. Ticket-only Telegram snapshots are unchanged
and are not a directory backup. Existing pricing rules use legacy city names; a city
rename does not migrate those rules or historical tickets.

## Conservative resolver (read-only groundwork, not Stage 2C)

Resolve active city then street within its city UUID. Matching only normalizes Unicode
NFC, case and whitespace, and considers explicit aliases. Multiple city candidates
are ambiguous even if a street could narrow them. Any competing name/alias is ambiguous.
Result: EXACT / ALIAS_EXACT / AMBIGUOUS / NO_MATCH / MALFORMED. No ticket is modified.
No RU/UA transliteration, prefix-stripping, fuzzy merge or generated aliases.
Directory data is not sent to Worker/AI; existing ticket-based AI remains Stage 1.

## Next stages

2B: audit **all** ticket creation/edit, profile editing, Sheets restore/fullDataJson,
backup and sync paths; then add optional cityId/streetId without losing legacy text.
2C: explicit, inspectable unique-exact linking with rollback, no historical text edits.
Later: shared directory transport and duplicate review/merge design, then a separately
versioned Worker directory projection with explicit source=directory vs source=tickets.

## Phone acceptance

Open Settings → Addresses. Verify prior cities/streets; open Edit to see UUID.
Add city Шевченко and street Вул Шевченко: UUIDs differ. Rename street: UUID unchanged.
Enter verified RU/UA aliases manually; archive and restore a street and then its city.
In airplane mode restart PWA, repeat editing, and verify the same IDs after restart.
Export/import the encrypted full backup; check directory IDs and existing tickets/photos.
Verify ordinary ticket creation/edit, search and Sheets synchronization still work.
Do not expect AI alias behavior to change until the later Worker integration stage.
