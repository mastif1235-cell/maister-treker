# Stage C — tools extraction (LAB only)

Starting HEAD: `ad2ea6c12374cb110fa48be9693b02205bdd0ef3`.

## Protected production change

Reviewed the production diff `d493138..2c0a261` read-only. Its six affected tools functions stay byte-identical to the LAB baseline, in tools-domain.js:
`toolsNavigate`, `toolsOpenRootFromTab`, `toolsLeaveOfflineSettings`, `openOfflineMapSettings`, `toolsOpenOfflineMap`, `bindToolsScreen`.
The entire binder, including the mode selector and connectivity listeners, remains in place.
No production commit is imported. The future integration must apply the production fix; this LAB intentionally retains baseline behavior.

## Network point checkpoint

`tools-network-points.js` owns the existing editor/details/photo/Telegram workflows, from `toolsNetworkPointPhotoSignature` through `toolsFocusNetworkPoint` (14 functions).
Bodies and nested callbacks are unchanged. Shared lexical declarations, persistence helpers, list/group rendering, ticket linking and map navigation remain in tools-domain.js.
Reads/writes: toolsNetworkPoints and selected point ID; sending guard Set; existing settings, ticket/photo references and DOM modal state.
Callbacks: existing point-placement and picker APIs; asynchronous photo resolution/compression/storage and explicit Telegram transport, with original save/rollback order.
Consumers: tools binder, map selection, ticket linking preview, and tickets-bindings. No top-level listeners or initialization are added.
The classic script loads after tools-domain and before the existing diagnostics network script and DOMContentLoaded bootstrap. Its filename is added to precache only.

The baseline fixture pins all 89 original function bodies, shared lexical declarations and protected owners. Legacy source-inspection tests read the explicitly wired tools scripts together; their assertions are retained. The preview-only negative assertion ends at the next remaining controller declaration after extraction.
New executable regression covers create/edit/cancel/delete, grouping/search, persistence, shared photo retention, Telegram action and marker refresh using fake data and transports.

## Offline UI checkpoint

`tools-offline-ui.js` owns ten unchanged functions for bounds labels/selection, area form/list rendering and save/export, PMTiles import confirmation/quota messages/install and explicit archive deletion.
State remains in tools-domain: pending bounds, area editing/import IDs, return settings and mode. Existing area storage helpers/keys and the compact edit/delete/show/import bridge functions stay there as well, preserving the surrounding context of protected `toolsOpenOfflineMap`.
The new file only delegates bytes/storage to the unchanged MTOfflineMap API (including safe A/B replacement). No OPFS, format, registry, connectivity or mode implementation moves.
Its async callbacks and modal listeners are unchanged. Existing binder dispatches to the same globals; source order is domain → network points → offline UI → diagnostics network → bootstrap.
Executable regression covers bounds selection, area create/edit/delete and definition export, PMTiles confirm/cancel/quota/failure/success, unchanged keys and archive retention during area deletion. The existing OPFS safe-replacement tests also pass.
