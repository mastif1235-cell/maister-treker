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
