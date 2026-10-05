# ResultSet-first ticket navigation

This is a frontend-only navigation boundary, not an analytics/QueryState or
provider change. The shown list already owns exact ticket IDs and address
previews. Previously those previews were not retained; an active resultSet also
suppressed ordinary referents, so a navigation follow-up could reach a broad
model-driven search.

Resolution uses the current unexpired, same-chat resultSet only:

1. Explicit ticket ID (`открой id 2`, `открой заявку id 2`), then list
   ordinal (`открой вторую`, `открой номер 2 из списка`). A bare number
   conflicting with a different ticket ID clarifies instead of guessing.
2. Exact/normalized address.
3. Locality/street/house tokens, then a unique partial address.
4. Bounded spelling/RU-UA and voice tolerance within that list only. Gather
   street/locality alternatives before checking numbers: fuzzy/voice house 3
   cannot hide a nearby 13 or 3А. Multiple candidates or incomplete previews
   clarify without changing the list/filters or searching globally. A unique
   exact house suffix such as `3А` can resolve the preserved list locally.
5. A genuine no-match can use the unchanged legacy path. Analytics/temporal/
   coworker follow-ups do not enter this navigation resolver.

`Памятная 3`, `ВЧ Памятная 3`, and `память на три` select the unique
`ВЧ, Пам'ятна 3` preview in the synthetic two-item regression. This is not a
global fuzzy matcher and cannot fuzzy-match the coworker roster.

Selection returns the existing single-ticket presentation, whose UI reads the
exact local ticket/IndexedDB ID and shows the ordinary card. A missing local
ticket uses the existing unavailable-card warning; it does not trigger a broad
search. No /ask, provider call, snapshot read, or beforeAsk sync hook is needed
for resolved navigation or clarification.

The existing chat history envelope retains bounded sanitized `activeResultItems`
(at most 100 previews, current IDs only). No new storage key, migration, ticket
schema or AI contract version is introduced. Existing sessions can use their
matching minimal referents; incomplete lists cannot assert unique addresses.
Expiry, chat reset, subject changes and persistence failure clear these previews.
Private notes, phone, credentials and geo are not added to this projection or
sent to the provider. QueryContext, including comparison and coworker EXCLUDE,
is retained across selection, clarification and reload.

Limitations: tolerance is deliberately narrow, not general speech recognition.
Bare unrecognized addresses still use the legacy fallback. The Worker API by
itself retains its existing navigation behavior; no Worker deploy is required.
APP_VERSION/runtime are unchanged in this draft. A future frontend release must
coordinate its normal cache/version bump so an installed PWA receives the fix.
1102, transport, provider availability, dates, maps and analytics are out of scope.
