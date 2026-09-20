# Майстер-Трекер

**Майстер-Трекер** — статичний offline-first PWA для майстра: заявки, калькулятор робіт, зміни, фото, наряди, карти, резервні копії та опційна синхронізація з Google Apps Script / Telegram.

## Запуск і розробка

Застосунок не має framework-збірки: `index.html` задає перевірений порядок classic scripts, а `sw.js` кешує цей самий shell для офлайн-роботи. Відкривайте через будь-який статичний HTTP-сервер (не `file://`), наприклад:

```sh
python3 -m http.server 8080
```

Для browser E2E потрібні Node.js 18+ та Chromium:

```sh
npm ci
npm run test:unit
npm run test:e2e
```

`npm ci` потрібен лише для Playwright E2E; unit/VM/static тести не потребують runtime-залежностей.

## Межі runtime

- Адресний довідник Stage 2A: локальні UUID міст/вулиць, явні aliases та архів; заявки ще legacy. Модель, безпечна міграція та межі: [`docs/STAGE2_ADDRESSBOOK.md`](docs/STAGE2_ADDRESSBOOK.md).

- QR runtime і важкі map assets завантажуються **окремо й лише за потреби**. MapLibre — основна карта; Leaflet збережено як compatibility fallback.
- Offline-мапи — PMTiles в OPFS. Не змінюйте порядок скриптів або перелік `CORE_ASSETS` у `sw.js` окремо від відповідного тесту.
- Дані заявок, фото, бекапи та журнал синхронізації мають окремих owners у IndexedDB; невеликі UI-стани зареєстровані у localStorage. Деталі: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/STORAGE.md`](docs/STORAGE.md).
- Telegram token і MapTiler key — device-local credentials. Контракти Telegram, backup, Google Sheets / Apps Script та IDs є compatibility boundaries.

## Рішення щодо bundling

Для поточного GitHub Pages runtime bundling/minification/precompression навмисно **не додаються**: код працює як static classic-script app, а Pages не дає контролю для чесної заяви про precompression. Додавати framework або build chain лише заради меншої кількості файлів не слід. Поточна безпечна оптимізація — lazy loading незалежних optional QR/map runtimes.

## Релізна перевірка

Перед merge: `npm ci`, усі `node tests/*.test.js`, Playwright Chromium, `node --check` для змінених JS, `git diff --check`, а також перевірка `index.html`, `app.js`, `sw.js`, `manifest.json` і закешованих assets у production. Кожен реліз піднімає разом `APP_VERSION` та унікальний `CACHE_NAME`.

Ліцензію не додано: її має визначити власник проєкту.

## AI / Assistant

AI-асистент — опційний READ-ONLY режим: питання по заявках/змінах через власний Cloudflare Worker, який тримає ключі провайдерів у Secrets. Ключі провайдерів **ніколи** не потрапляють у PWA/репозиторій — у застосунок вводиться лише адреса бекенда та персональний access-токен. Та сама інструкція є й всередині застосунку: **Налаштування → 🤖 AI-асистент → «📘 Як підключити AI»**.

### Quick Start

1. Налаштування → 🤖 AI-асистент → увімкніть AI.
2. Режим «Спільний backend» (адреса підтянется сама) або «Свій backend» (свій https-URL Worker'а).
3. Вставте персональний access-токен (`ім'я:токен:scope`).
4. «Підключити AI» → ✅ Підключено → кнопка 🤖 з'явиться в «Інструментах».

### Groq

1. Створіть ключ на [console.groq.com/keys](https://console.groq.com/keys) (Console: [console.groq.com](https://console.groq.com/), [Docs](https://console.groq.com/docs), [моделі та ліміти](https://console.groq.com/docs/models)).
2. Додайте його на Worker як Secret `GROQ_API_KEY` — або в Dashboard (Workers & Pages → Worker → Settings → Variables and Secrets → [Secrets docs](https://developers.cloudflare.com/workers/configuration/secrets/)), або командою:
   ```sh
   npx wrangler secret put GROQ_API_KEY
   ```
3. У Master-Tracker: Provider Groq → модель → персональний access-токен → «Підключити AI».

### DeepSeek

1. Ключ: [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) ([Platform](https://platform.deepseek.com/), [API Docs](https://api-docs.deepseek.com/), [моделі та ціни](https://api-docs.deepseek.com/quick_start/pricing)).
2. Secret на Worker: `DEEPSEEK_API_KEY` (`npx wrangler secret put DEEPSEEK_API_KEY`).
3. Провайдер має бути увімкнено на backend (передано у `/ai/config`); якщо ще не ввімкнено — підтримку підготовлено, але чат ним не відповідає.

### Shared backend

«Спільний backend» — наш Worker: адреса підставляється автоматично (prod Worker для продакшен-PWA; dev Worker — у preview-оточенні: localhost, pages.dev-превʼю, локальна мережа) Потрібен персональний токен — без нього ліміти власника не витрачаються і доступу до даних немає.

### Custom backend

«Свій backend» — будь-який ваш https-Worker з тим самим контрактом (`/healthz`, `/ai/config`, `/ask`). http заборонено; відповідальність за безпеку — на власника.

### How to switch provider

Налаштування → 🤖 AI → Provider → новий провайдер → Model → «Перевірити з'єднання» → тестове питання. Код/index.html/endpoint вручну не змінюються — UI підтягує провайдера з `/ai/config` автоматично.

### How to add provider

Кроки розробника (адаптер + реєстрація + backend allowlist + тести): [docs/AI-PROVIDERS.md](docs/AI-PROVIDERS.md).

### Security

- Ключі провайдерів — тільки Worker Secrets (`GROQ_API_KEY`, `DEEPSEEK_API_KEY`); не в PWA, не в localStorage, не в git/issue/PR/скріншотах.
- Персональний токен — в зашифрованому vault на пристрої, в заголовку `Authorization` і більше ніде.
- `/ai/config` не повертає секретів; WRITE-дії вимкнені (READ-ONLY).

### Troubleshooting

| Симптом | Значення |
|---|---|
| `401` | Невірний access-токен |
| `404` | Endpoint не знайдено — оновіть Worker |
| `429` | Ліміт провайдера вичерпано — зачекайте і повторіть |
| `CORS / Мережа` | Бекенд недоступний з браузера / застарілий деплой без CORS |
| `Offline` | Немає мережі |
| `Провайдер вимкнено` | Підготовлено, але не включено на backend |
| `Модель недоступна` | Виберіть модель зі списку backend'а |
