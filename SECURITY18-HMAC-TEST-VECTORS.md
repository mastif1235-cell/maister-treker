# Майстер-Трекер — security.18 HMAC test vectors

Ці вектори потрібні лише для звірки клієнтської та серверної canonical-логіки. Реальні секрети тут НЕ використовуються.

## Тестовий секрет

`0123456789abcdef0123456789abcdef`

## GET

- `ts`: `1760000000000`
- `nonce`: `abcdefghijklmnopQRSTUVWX`
- `action`: `getTicketById`
- `id`: `abc-123`

Canonical string:

```text
1760000000000
abcdefghijklmnopQRSTUVWX
GET
getTicketById
abc-123
```

Очікуваний HMAC-SHA256, base64url без `=`:

```text
90-xmS53-MVYXCtfA-bUDAjGN98V_MHPjxpAiXCM_Ug
```

## POST

Внутрішній body має бути підписаний **після видалення `secret`** і рівно в тому JSON-рядку, який потім вкладається в envelope:

```json
{"action":"updateTicket","id":"abc-123","date":"18.08.2026","time":"20:00","content":"test","sum":100,"tags":["ремонт"]}
```

Canonical string:

```text
1760000000000
abcdefghijklmnopQRSTUVWX
POST
{"action":"updateTicket","id":"abc-123","date":"18.08.2026","time":"20:00","content":"test","sum":100,"tags":["ремонт"]}
```

Очікуваний HMAC-SHA256, base64url без `=`:

```text
6aYEdg4du6JVAQhQk0igFaGX64aoV5F61jm52s4pGCA
```

## Негативні перевірки

Після migration wrapper перевірити:

- той самий nonce вдруге → відхилення;
- timestamp старіший/новіший більш ніж на 5 хвилин → відхилення;
- зміна одного символу `id`, `action` або POST body без перерахунку sig → відхилення;
- sig не 43 base64url-символи → відхилення;
- секрет коротший за 32 символи → HMAC v2 не активується;
- до strict cutover стара `17.3` з legacy secret ще працює;
- після strict cutover legacy secret без HMAC більше не працює.
