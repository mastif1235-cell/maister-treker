# Security review checkpoint

## DOM and URL boundaries

- Untrusted sources inventoried: ticket/shift fields from local storage, IndexedDB and GAS; imported backup content; Telegram-derived photo data; barcode/QR scanner values; catalog/settings inputs; location and photo URLs.
- Text-only scanner results and dynamic links are created with `textContent`/DOM APIs in the final runtime owner. Ticket, shift, catalog and report templates escape text before HTML insertion; imported records are bounded and normalized before rendering.
- Navigation is allowlisted to same-origin HTTP(S), external HTTPS, `tel:`, `mailto:` and locally-created `blob:` values. `javascript:`, arbitrary `data:`, `file:` and external HTTP are blocked. Photo sinks accept bounded raster `data:image` or same-origin/local blob values only; SVG/HTML data URLs are rejected.
- No `eval` or `new Function` exists. Remaining `innerHTML` uses are fixed application templates or escaped/normalized render data. They remain a maintainability risk and should move to DOM construction during later domain decomposition, after the stable checkpoint.

## QR / dogovor

- The contract producer now builds `d.html#2.<base64url>` directly. Address, login, password, contract number and date never enter query parameters. The viewer removes the fragment from history before decoding, bounds every field and writes with `textContent`.
- Viewer scripts are external so the effective Netlify/GitHub-compatible CSP can keep `script-src 'self'`. `dogovor-secure.html` remains a bounded legacy v1 fragment viewer.
- The old `dogovorUrl` setting is retained only for settings-data compatibility and is no longer a transport owner.

## Host enforcement

- `_headers` is the canonical Netlify header policy. GitHub Pages does not apply repository `_headers`, so the main page and both viewer pages also carry enforceable CSP/referrer meta policies. A meta policy cannot enforce `frame-ancestors`; therefore clickjacking protection is **Medium** while production remains GitHub Pages. Resolving it requires a host/CDN that emits the checked-in headers (or an equivalent GitHub Pages fronting proxy) and is a production deployment decision.
- Service Worker is not treated as a security-header owner.

## Residual assessment

- Critical: none known.
- High: none known.
- Medium: GitHub Pages cannot emit the checked-in anti-framing/other response headers; direct client-held Telegram bot token remains extractable after same-origin code execution or device compromise.
- Low: legacy escaped-template renderers remain more difficult to audit than DOM-only renderers; inactive compatibility fields/code should be removed during later domain decomposition.
