# Як додати нового AI-провайдера (developer guide)

Контракт стабільний: UI не переписується під провайдера — він читає
`providers`/`models` з `GET /ai/config` і працює з будь-яким провайдером,
якого бекенд оголосив. Новий провайдер = адаптер + реєстрація + бекенд.

## 1. Клієнтський адаптер — `js/ai/providers/<provider>.js`

Скопіюйте структуру `providers/deepseek.js`: об'єкт з `id`, `name`,
`enabled`, `models` (`{id, capabilities}`), `buildRequest`-параметрами,
якщо вони відрізняються. Ключі провайдера тут **заборонені** — тільки
ім'я Secret-а на backend (secret-scan у `tests/ai-public-safe.test.js`
не пропустить литерали).

## 2. Реєстрація — `js/ai/providers/provider-registry.js`

Додайте адаптер у registry. UI (налаштування, довідка, чат) підхопить
провайдера автоматично — `js/ai/ai-ui.js` та `js/ai/ai-settings.js` не
міняються.

## 3. Backend — Worker (`mcp/`)

У конфігурації провайдерів Worker'а додайте:

- `id` провайдера (співпадає з клієнтським адаптером);
- upstream API base URL (тільки на Worker, у відповідь не потрапляє);
- allowlist моделей (`models`, кожна з `capabilities: text/tools/reasoning/vision`);
- capabilities провайдера;
- ім'я Secret-а (`<PROVIDER>_API_KEY`);
- routing у `/ask` (який провайдер обслуговує запит / перемикання).

## 4. Secret

```sh
npx wrangler secret put <PROVIDER>_API_KEY
```

або Cloudflare Dashboard → Workers & Pages → Worker → Settings →
Variables and Secrets → Add Secret
([документація Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)).

## 5. Оновіть `/ai/config`

Публічний контракт (`{ok, mode, auth_required, providers:[{id, name,
enabled, models}]}`) має повернути нового провайдера. Секрети, ключі та
upstream URL у відповіді заборонені.

## 6. UI

Нічого не змінюється: налаштування показують нового провайдера й моделі
після «Підключити AI» (список приходить з `/ai/config`).

## 7. Тести (обов'язково)

- `config` — провайдер/моделі у відповіді `/ai/config`;
- `auth` — 401 без персонального токена;
- `tool calling` — цикл tool-calls через нового провайдера;
- `rate limit` — 429 прокидається з зрозумілим повідомленням;
- `errors` — стабільні коди помилок без деталей інфраструктури;
- `no secret leak` — жодних ключів у відповідях/логах/клієнті
  (додається у secret-scan і mcp-тести).

## 8. Перевірка можливостей

Якщо провайдер підтримує — перевірте: `text`, `tools`, `reasoning`,
`vision`, `audio`. Можливості оголошуються у `capabilities` моделі —
UI сам вимикає недоступне (фото/голос не ламаються, див.
`mcp/docs/ai-multimodal-contract.md`).
