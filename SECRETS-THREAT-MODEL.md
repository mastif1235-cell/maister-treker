# Secrets and boundary model

## Inventory

- `syncHmacSecret` is device-held in local settings, used only as Web Crypto HMAC key material, and excluded from exports/snapshots. It is never placed in a URL or signed body. The server copy exists only as GAS Script Property `MT_SYNC_HMAC_SECRET`.
- Legacy `syncSecret` is discarded during settings load and ignored during imports.
- `tgBotToken` is device-held and excluded from every backup pipeline together with Telegram chat/message identifiers.
- Chat IDs are routing/privacy identifiers rather than authentication credentials, but are treated as sensitive export data.
- No application/server secret or real API key is hardcoded in source. Test-vector keys are non-production fixtures.

## Telegram boundary

Telegram Bot API requires the bot token in the request path (`/bot<token>/method`). A direct browser client therefore cannot satisfy an absolute no-secret-in-URL rule. It also exposes the token to any successful same-origin script execution and to local browser/network diagnostics. Moving the value from localStorage to IndexedDB or obfuscating it would not change that XSS boundary.

The minimum current option is to retain direct Telegram access without adding a large proxy: use a dedicated least-privilege bot, private chats, no unrelated bot permissions, rotate the token after suspected compromise, exclude it from backups/logs, and complete the Stage 7 XSS/CSP controls. This preserves offline-first operation and has no server operating cost, but token confidentiality cannot be guaranteed against same-origin XSS or a compromised device.

A future narrow Telegram relay is the only way to remove the token from client URLs. Its benefit is server-side token custody and request policy enforcement. Its cost is a new authenticated service, abuse/rate-limit controls, attachment streaming/storage decisions, monitoring and another production dependency. It requires separate approval and is not introduced automatically.

## Residual boundaries

- App lock is an access deterrent, not encryption at rest; an unlocked origin can read client-held credentials.
- Browser DevTools and the device owner can observe direct Telegram requests.
- Production CORS behavior and the installed-PWA v66 upgrade remain separate deployment gates.
