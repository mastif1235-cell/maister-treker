# Stage 2 — local AddressBook identity and ticket links

Stage 2A (directory UUIDs, v91.54), Stage 2B/2C (optional ticket links, v91.55;
hardened in v91.56) and Stage 2D (AddressBook → Worker/KV → AI, v91.57) are shipped. The existing ticket.id, display address, photos,
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

## Worker / AI — ticket links (v91.55, additive)

`mcp/src/gas/mappers.js` projects `cityId`/`streetId` (UUID shape only, else empty) —
snapshot v4, old v3 KV key left untouched. `find_tickets_by_address` echoes the ids
shared by every matched row; `query_tickets` rows carry the ids next to the text.
Prompt rule 11б: ids are authoritative for identity and never printed to the user.

## Stage 2D — AddressBook → Worker/KV → AI (v91.57)

**What leaves the phone.** `js/address-book-sync.js` builds a projection of
`settings.addressBook`: `{v:1, cities:[{id,name,aliases,active,updatedAt}],
streets:[{id,cityId,name,aliases,active,updatedAt}]}`. Places only — no tickets,
clients, phones or notes; archived entities are included with `active:false`. It is
POSTed to the AI backend the PWA already uses (`settings.ai.backendUrl`, the same
bearer as `/ask`) at `POST /directory`. No new backend, no Code.gs/Sheets change, no
call to DeepSeek per street.

**When.** After every persisted directory change (`mtAddressBookChange`: a street
typed into the calculator that the directory remembers, add/rename/alias/archive in
Settings), debounced 2.5 s so a burst is one request; at app start and on `online`
when a push is still pending; and right before an AI question (`beforeAsk`, bounded
6 s, failures never block the chat). A fingerprint of the projection is kept in
localStorage (`mt_directory_sync_v1`, device-local) so an unchanged directory is never
re-sent. Settings → Адреси shows the status and a «☁️ Надіслати довідник для AI
зараз» button. Without AI configured nothing is sent.

**Where it lives on the Worker.** `mcp/src/data/directory.js`: ONE KV key
`mt:directory:v1` = `{v:1, savedAt, data:{cities, streets}}` in the same
`MT_SNAPSHOT_KV` namespace as the ticket snapshot (`mt:snapshot:v4`), never inside it —
old snapshots and deployments without a pushed directory keep working unchanged.
The Worker validates (UUID shape, bounded names/aliases, size limits, prototype keys)
and stores the **UNION by UUID** of every push: a second phone can never erase the
first phone's identities; for one UUID the newer `updatedAt` wins (rename, alias,
archive); nothing is ever deleted. Without the KV binding `/directory` answers 503 and
the tools stay ticket-derived. The Worker still never writes to Google Sheets.

**How AI uses it (`mcp/src/ask/directory-index.js`).** user text → name/alias → UUID,
then UUID → tickets. Resolution is deterministic: EXACT / ALIAS_EXACT (same spelling of
the current name or an explicit alias), then the Stage 1 identity key (cases, UA/RU,
«вул./ул.» — never stricter than today); several matches are AMBIGUOUS (candidates
reported, nothing chosen); active wins over archived, archived resolves when it is the
only match so history stays findable.
- `query_tickets`: a row whose ids this directory knows is filtered by
  `cityId`/`streetId` alone («вулиця:довідник (id)»); a legacy or foreign row keeps the
  Stage 1 text rules, widened by the resolved entity's own spellings (aliases, pre-rename
  name). Accepts `city_id`/`street_id`; `resolved_filters` carries them, so a follow-up
  («покажи їх») inherits the identity and re-runs by UUID; an unknown id is ignored in
  favour of the text. Groups/analytics label rows with the CURRENT directory name.
  The envelope gains `directory:{available, city_id, city, street_id, street,
  *_status, *_candidates}`.
- `find_tickets_by_address`: the directory is read first (city token + street, street
  across cities, city alone); a unique street answers by identity with
  `resolved.source:'directory'` even when it has no tickets yet; an ambiguous street
  (same name in two cities, no city named) is reported as `directory.candidates` while
  the Stage 1 answer stands.
- `list_places` = TICKETS: streets **with tickets**, grouped by `street_id` and labelled
  with the current name (`source:'tickets'`, `directory_available`).
- `list_directory` = DIRECTORY (new tool): cities, or the streets of one city by name /
  alias / `city_id`, active by default (`include_archived:true` for all), with
  `street_id`, `aliases`, `active`. `available:false` when nothing was pushed — the model
  then uses `list_places` and must say those are streets from tickets, not a directory.
- Prompt rules 11в (DIRECTORY ≠ TICKETS, honest fallback) and 11г (UUID-first
  follow-ups, aliases = same place, show the current name, never print ids).

**Legacy fallbacks kept.** Tickets without ids → Stage 1 text path; rows whose ids the
directory does not know (another phone) → text path; no directory in KV → every tool
exactly as in v91.56; ambiguous names are never guessed anywhere.

**Conversation polish (v91.58).** For the master the address book is ONE list of his
own streets, so the plain question «які вулиці є / у мене є / покажи вулиці / список
вулиць <місто>» (no ticket words) is answered by the Worker itself from
`list_directory` — deterministic text («У Шевченко у тебе 7 вулиць: …», archived as a
count), no «довідник чи заявки?» clarification, no model round trip, no internals
(prompt rule 24 forbids DIRECTORY/TICKETS/UUID/cityId/streetId/KV/Worker/aliases in
ordinary answers). A city spelled in a case form the Stage 1 stemmer does not equate
is handed to the model together with the directory's city list; a directory that was
never pushed falls back to `list_places` with an honest «вулиці, де були заявки».
Questions about TICKETS («на яких вулицях були заявки/ремонти/підключення», periods,
dates) stay with the ticket tools. Follow-ups: an explicit ordinal over the previous
answer's referents («відкрий другу картку» after a `find_tickets_by_address` list) is
locked deterministically like the result-set ordinal, so «покажи її» opens exactly that
ticket; a later READ that brings other tickets only sets
`resultSetStatus.selectionChanged` and the PWA drops the stale selection. v91.59: the
selected ticket (`presentation.kind = single_ticket`) renders as the **standard** chat
card — «👤 Відкрити профіль» through the existing `MTAI.actions.openTicket` by the
existing `ticket.id`, «🗺️ На карті» only when the ticket has coordinates — the same
card the list shows, not a bare «Закрити / На карті» card.

## Next stages

Duplicate review/merge design for two phones' semantic duplicates (both UUIDs stay in
KV today), directory-aware house lists, and an optional `GET /directory` diagnostic.

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
Stage 2D: with AI configured, Settings → Адреси shows «Довідник для AI передано …»;
type a new street into a ticket, wait a few seconds — the status stays «передано» and
the AI answers «які вулиці є в <місті>» with the new street (DIRECTORY) while «на яких
вулицях були заявки» still lists only streets with tickets (TICKETS). Requires the
Worker deploy of v91.57.
