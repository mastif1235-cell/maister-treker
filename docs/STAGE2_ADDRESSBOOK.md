# Stage 2 — local AddressBook identity and ticket links

Stage 2A (directory UUIDs, v91.54) and Stage 2B/2C (optional ticket links, v91.55;
hardened in v91.56) are shipped. The existing ticket.id, display address, photos,
authorization, Sheets columns and Telegram payloads remain unchanged; every addition
is optional and backward compatible. Stage 2A sections come first, 2B/2C follow.

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
Result: EXACT / ALIAS_EXACT / AMBIGUOUS / NO_MATCH / MALFORMED. The resolver itself
modifies no ticket. No RU/UA transliteration, prefix-stripping, fuzzy merge or
generated aliases. Directory data (names, aliases) is never sent to Worker/AI.

## Stage 2B — optional ticket links (`js/address-book-link.js`)

Ticket gains two **optional** fields: `cityId`, `streetId`. `id`, `city`, `street`,
`house`, `apartment`, `address` and every other field are untouched; no boot-time
migration touches stored tickets. A link is written only for a unique EXACT or
ALIAS_EXACT resolution; AMBIGUOUS / NO_MATCH / MALFORMED never produce a UUID.

`MTTicketAddressLink.linkState(book, ticket)` classifies a ticket: `none` (legacy),
`linked` (pair known here and the text still resolves to it), `stale` (pair known
here, text does not resolve to it — rename without alias or edited text), `foreign`
(well-formed pair unknown to this phone's directory — another phone), `partial`
(half pair or non-UUID junk from an imported file). Foreign and partial pairs are
never judged by the app; the Worker drops any non-UUID value.

Editor rule (`applyToTicket(ticket, book, previous)`), shared by the calculator save
(`saveTicketFromForm`) and the abonent profile editor. `previous` is the stored
version of the same ticket, so the link follows the **address**, not the directory
of the day:

- city/street text unchanged (same normalization as the resolver: NFC, case,
  whitespace) → the stored pair stays as-is — after a rename without alias, after an
  archive, when the name became ambiguous, and when the pair belongs to another
  phone's directory. An unrelated edit (phone, sum, note) never loses identity. A
  legacy ticket may gain its unique link during such an edit;
- city/street text changed → the new text is resolved like a new ticket: unique
  match writes the new pair, otherwise no pair remains. Foreign and partial pairs are
  dropped here because they can no longer describe the new text;
- new ticket (no `previous`) → resolve; the calculator first lets the directory
  remember a newly typed city/street (Stage 2A), so a brand-new street links to its
  freshly created directory entry;
- unreadable directory → nothing is written.

Identity guarantees: city «Шевченко» and street «Вул Шевченко» are different UUIDs;
the same street name in two cities yields two `streetId`s; a directory rename keeps
the UUID and the historical ticket text; archive keeps existing links but stops new
auto-links.

Sheets: the pair travels **only inside `повніДаніJSON`** through the existing
`ticketToSyncPayload` whitelist — no column added, renamed or deleted, no Code.gs
change. A legacy ticket produces a byte-identical payload (no mass re-sync after the
upgrade). Restore copies every `fullDataJson` key, so new rows restore with their pair
and old rows restore as legacy tickets. «Accept server» in a conflict adopts the server
pair, and removes the local pair when the server's structured data has none — a pair
must never outlive the address text it described. Mixed fleet: a phone still running
an older app version drops the pair from rows **it** edits (old whitelist); nothing
breaks, the ticket becomes legacy again until an edit or the linker on an updated phone
re-links it. Update both phones together.

Backups: new encrypted/plain backups carry the pair (bounded like other short fields
on import); legacy backups import unchanged and no UUID is invented for them.
Telegram human-readable text never shows UUIDs; whole-ticket JSON dumps carry them.

## Stage 2C — «Перевірити адреси заявок» (`js/address-book-linker.js`)

Settings → Адреси → «🔎 Перевірити адреси заявок». `plan()` is read-only and counts
already_linked / exact / alias_exact / ambiguous / no_match / malformed / stale /
foreign (with samples). Only EXACT / ALIAS_EXACT rows are proposed; «Прив’язати N
заявок» applies them after an explicit confirmation. The linker never touches
`ticket.id` or text, never re-links `stale`/`foreign`/`partial` rows (review only),
skips a ticket whose text changed after planning, and a second run is a no-op.
Persistence goes through `saveTickets()`, so linked tickets reach Sheets by ordinary
per-ticket sync; a failed save rolls the in-memory change back. Any directory change
invalidates the cached plan. Semantic duplicates created offline on two phones stay
separate UUIDs — the duplicate diagnostics point them out; a merge UI is not part of
this stage.

## Worker / AI (v91.55, additive)

`mcp/src/gas/mappers.js` projects `cityId`/`streetId` (UUID shape only, else empty) —
snapshot v4, old v3 KV key left untouched. `find_tickets_by_address` echoes
`resolved.city_id/street_id` only when every matched row agrees; `query_tickets`
rows carry the ids next to the text. Prompt rules 11б/11в: ids are authoritative for
identity, never printed to the user; DIRECTORY questions («які вулиці існують») are
distinguished from TICKET questions — `list_places` lists places **with tickets**, not
the directory. The directory itself (aliases) still lives only on the phone, so alias
resolution in the Worker remains the Stage 1 text resolver.

## Next stages

Shared directory transport (so alias resolution and DIRECTORY-vs-TICKETS questions can
be answered from the directory in the Worker), duplicate review/merge design, then a
separately versioned Worker directory projection with explicit source=directory vs
source=tickets.

## Phone acceptance

Open Settings → Addresses. Verify prior cities/streets; open Edit to see UUID.
Add city Шевченко and street Вул Шевченко: UUIDs differ. Rename street: UUID unchanged.
Enter verified RU/UA aliases manually; archive and restore a street and then its city.
In airplane mode restart PWA, repeat editing, and verify the same IDs after restart.
Export/import the encrypted full backup; check directory IDs and existing tickets/photos.
Verify ordinary ticket creation/edit, search and Sheets synchronization still work.
Stage 2B/2C: create a ticket with a directory city/street, then change only the phone
number — «Перевірити адреси заявок» still counts it as already linked. Rename that
street in the directory without an alias and edit the phone again: still linked. Change
the street to another directory street: the link follows the address. Run the check
twice: the second run offers 0 tickets. Confirm an old ticket without a link still
opens, searches, and shows in the address navigator, calendar and map.
AI alias behaviour changes only after the Worker deploy of v91.55+ (snapshot v4).
