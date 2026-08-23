# Gate 3 — production host and security headers

Status: **assessment PASS; hosting decision B — migrate under a separate approval**. No host linkage, configuration or deployment was changed.

## Proven production host

GitHub's Pages API reports `https://mastif1235-cell.github.io/maister-treker/`, legacy build from `main:/`, HTTPS enforced. The latest live Pages build is commit `9ae763a7a262a56d99efb4bfaaf1360b2d4c39b5`. Repository deployment history contains GitHub Pages only and repository webhooks are empty.

No `.netlify/state.json`, `netlify.toml`, Netlify CLI, account token/config, GitHub Netlify deployment or webhook is available. Account-wide Netlify site inventory is therefore **UNKNOWN**, not repeatedly retried. The historical auxiliary URL `https://on-b6a966.netlify.app/` returns a Netlify 404 and does not prove project ownership or a usable deployment.

## Live response evidence

Read-only requests on 2026-08-23 produced:

| Capability | GitHub Pages production | Netlify capability / candidate policy |
|---|---|---|
| HTTPS / HSTS | Present; `max-age=31556952` | Supported; the observed Netlify 404 supplied HSTS, but a future project must be checked after deployment |
| CSP header | Absent | `_headers` defines the candidate CSP |
| `frame-ancestors` / anti-framing | Absent; HTML meta CSP cannot supply it | `_headers` defines CSP `frame-ancestors 'none'` and `X-Frame-Options: DENY` |
| `X-Content-Type-Options` | Absent | `_headers` defines `nosniff` |
| `Referrer-Policy` | Absent as an HTTP header | `_headers` defines `no-referrer`; page meta remains defense in depth |
| `Permissions-Policy` | Absent | `_headers` limits camera/geolocation and disables microphone |
| Cache | HTML and `sw.js`: `Cache-Control: max-age=600` | Netlify supports route-specific cache headers; an approved migration should explicitly revalidate HTML and `sw.js` |
| PWA / Service Worker | Works under HTTPS and passed Gate 2 runtime upgrade | Static Netlify hosting is compatible; re-run install/update/offline gates on the preview before production cutover |

GitHub Pages ignores the repository `_headers` file. The checked-in HTML meta CSP remains useful but cannot enforce `frame-ancestors` and does not replace the other missing response headers. The Service Worker is correctly not treated as their owner.

## Decision

Choose **B: move the production client to Netlify (or an equivalent header-capable static host)**. This is justified by the client-held Telegram token boundary: defense in depth at the document boundary is valuable, and GitHub Pages cannot activate the already-reviewed `_headers` policy. This is not a Critical/High emergency because DOM/URL boundaries and meta CSP are hardened; it remains the known Medium host limitation.

A safe migration proposal is:

1. obtain explicit authorization and identify/create a dedicated Netlify site linked to this repository;
2. deploy the candidate to a non-production preview only;
3. verify every `_headers` directive with real responses and set explicit revalidation for `/`, HTML and `/sw.js` (do not mark unversioned assets immutable);
4. rerun PWA install, v62-to-v66 upgrade, offline reload, QR/viewers, Telegram and GAS CORS on the preview origin;
5. only after approval, cut the public client URL while keeping GitHub Pages intact as rollback.

Official platform references: GitHub Pages HTTPS configuration (`https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https`) and Netlify custom headers (`https://docs.netlify.com/manage/routing/headers/`).
