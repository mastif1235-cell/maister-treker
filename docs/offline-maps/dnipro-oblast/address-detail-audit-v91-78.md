# Offline address detail audit — v91.78

## File and method

- Local file: `dnipro-oblast-z0-15.pmtiles`, 114207260 bytes.
- Verified SHA-256: `4ebb26c99a51407dab3a1d45cdfaef9f2d176003a1bdb19579caa1d9001877da`.
- PMTiles v3; MVT tiles; gzip internal/tile compression; native Z0–15.
- Metadata schema version: Protomaps **4.15.2**; OSM replication time **2026-09-30T04:00:00Z**.
- Actual vector layers: boundaries, buildings, earth, landcover, landuse, places, pois, roads, water.
- Read-only audit: shipped PMTiles reader plus MVT protobuf decoding, no credentials, network, archive modification or production access.
- Eight sites, nine neighboring tiles per site at each of Z14 and Z15: **144 tiles**. Counts below are tile feature occurrences, not deduplicated OSM objects. The Z14 and Z15 footprints differ, so their totals must not be compared as a measure of feature loss.
- Reproducible script: `scripts/offline-map-address-audit.cjs`, argument = local file path.
- Committed real Dnipro Z15 MVT fixture: `tests/fixtures/dnipro-address-tile.json`; provenance SHA and tile coordinates included. Derived OSM data, © OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright . This is a test tile, not a replacement regional map.

## Result: A — numbers exist, current style did not display them

All eight sampled sites contain numbers at native Z15. At Z14, the sampled buildings layer contains merged polygons but no address features.

| Site (longitude, latitude) | Z15 center tile | Address points in 3×3 Z15 tiles |
|---|---|---:|
| Dnipro (35.0462, 48.4647) | 19573 / 11327 | 1339 |
| Taromske (34.8077, 48.4746) | 19552 / 11325 | 38 |
| Kamianske (34.6167, 48.5167) | 19534 / 11319 | 1019 |
| Pavlohrad (35.8700, 48.5340) | 19648 / 11317 | 589 |
| Kryvyi Rih (33.3918, 47.9105) | 19423 / 11402 | 831 |
| Nikopol (34.3910, 47.5670) | 19514 / 11449 | 763 |
| Tsarychanka (34.4800, 48.9430) | 19522 / 11261 | 30 |
| Vasylkivka (36.0210, 48.2080) | 19662 / 11362 | 32 |

Actual address schema: source-layer **buildings**, geometry **Point**, **kind=address**, string **addr_housenumber**. Examples include `95-А`, `75-В`, `117а`, `91В`. All observed numbered features are points. Polygons are `kind=building`/`building_part` and do not carry numbers. In the sampled buildings features, `housenumber`, `house_number`, `addr:street`, `name`, `name:uk` were absent. The style must not invent those aliases or add a second polygon number layer.

v91.77 only rendered building polygons, roads and places; it had no address symbol layer. Overzoom alone therefore could not expose numbers. v91.78 uses a schema-gated address point layer from Z16 with local fonts, 10–12 px text through Z18, white halo, small padding and alternate anchors. Collision handling remains enabled; address text does not block other symbols.

## Roads: actual data and missing labels

The archive contains **minor_road** with **kind_detail=residential/service/unclassified**, as well as living_street, pedestrian, alley and driveway variants (some under other/path). They are not categorically missing from this extract. At Dnipro Z15, the sample contains 87 residential (86 named), 59 service (24 named), 12 unclassified (11 named) feature occurrences. Thus not every road has a usable name in the tile; style cannot supply missing names.

Observed name fields include **name:uk**, **name**, **name:en**. A precise old-style bug: **Успішна вулиця**, Vasylkivka, has `name:uk` and `name:en`, but no `name`; v91.77's `has(name)` filter excluded it despite a Ukrainian-first text expression.

Other causes of omitted labels: shared symbol collision space, 3 px padding, default 250 px repeated-label spacing and line curvature/length. v91.78 accepts all three actual name fields, separates local/other road label filters without duplicates, reduces local padding to 1 px and spacing to 75 px at Z18, adjusts 10–13 px local text size and curved-line tolerance. Road overlap remains disabled globally.

The audit proves small roads and names are present in these tiles; it does **not** prove every current OSM road/address was retained by the upstream generator. No comparison against a full matching-date OSM PBF was performed. Low local address coverage (e.g. Taromske/Tsarychanka) remains a data limitation, not solved by claiming all buildings have numbers. Native Z15 remains Z15 even when displayed at Z18.

## Map replacement decision

No replacement is required to expose the numbers already present; no map is generated/uploaded/replaced/deleted by this change. If a specific missing address or named street is confirmed in matching-date OSM but absent here, the next separate step is an OSM PBF-to-PMTiles regional build retaining every available `addr:housenumber` (nodes and polygon label points) and named local roads at native Z16/17. Size must be measured from that build, not promised from this audit. Compatibility requires the existing manifest contract, byte size/SHA validation, metadata/schema support and current R2/A-B installer; this PR changes none of them.

References: https://docs.protomaps.com/basemaps/layers , https://maplibre.org/maplibre-style-spec/layers/ , https://docs.protomaps.com/basemaps/build . Local tile evidence takes precedence over generic schema assumptions.

## Implementation and validation

Prepared frontend identity: **v91.78 · 2026-10-02**, **maister-treker-v67-runtime-122**. Production remains unchanged.

Changed files:

- Runtime: `js/tools-domain.js`, `js/tools-offline-download-ui.js`, `js/tools-map-maplibre.js`.
- Release: `app.js`, `sw.js`.
- Audit: this document and `scripts/offline-map-address-audit.cjs`.
- Real MVT fixture / helper: `tests/fixtures/dnipro-address-tile.json`, `tests/helpers/offline-map-fixture.js`.
- Regression tests: `tests/tools-map-offline-ux.test.js`, `tests/maplibre-offline-cartography.test.js`, `tests/fixtures/tools-extraction-baseline.json`, `e2e/offline-map-access.spec.js`, `e2e/offline-map-download.spec.js`.
- Release pins only: `e2e/tickets-compact-view.spec.js`, `tests/network-tools-ui.test.js`, `tests/sw-upgrade-static.test.js`, `tests/tickets-compact-view.test.js`, `tests/tools-v82-field-package.test.js`, `tests/tools-v84-field-update.test.js`, `tests/tools-v85-narrow-field-fixes.test.js`.

Validation:

- Root: **199/200 PASS**; only unchanged `tests/network-tools-monitor.test.js:81` fails locally with wall-clock average **47–48 ms**, allowed range **38–46 ms**. No assertion weakening or Ping changes.
- MCP: **442/442 PASS**.
- Full E2E: **41/41 PASS**, including actual sampled Dnipro tile rendered offline with houses/local streets at Z16, Z17 and Z18, plus download/resume, token vault, A/B, preservation after failed update and PWA upgrade tests.
- Syntax and `git diff --check`: **PASS**.
- Protected-scope diff: no changes to Worker/mcp, R2/CORS config, auth/vault, MapTiler config/satellite style, downloader/provider, storage/OPFS/A-B or production manifest.
- No production deploy, map replacement, deletion, merge or secret operations.

The permanent installation status is removed from the main map, while contextual map errors/coverage messages remain. Full management/status/version/token controls remain behind Settings → Offline map.
