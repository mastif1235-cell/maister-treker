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

- QR runtime і важкі map assets завантажуються **окремо й лише за потреби**. MapLibre — основна карта; Leaflet збережено як compatibility fallback.
- Offline-мапи — PMTiles в OPFS. Не змінюйте порядок скриптів або перелік `CORE_ASSETS` у `sw.js` окремо від відповідного тесту.
- Дані заявок, фото, бекапи та журнал синхронізації мають окремих owners у IndexedDB; невеликі UI-стани зареєстровані у localStorage. Деталі: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/STORAGE.md`](docs/STORAGE.md).
- Telegram token і MapTiler key — device-local credentials. Контракти Telegram, backup, Google Sheets / Apps Script та IDs є compatibility boundaries.

## Рішення щодо bundling

Для поточного GitHub Pages runtime bundling/minification/precompression навмисно **не додаються**: код працює як static classic-script app, а Pages не дає контролю для чесної заяви про precompression. Додавати framework або build chain лише заради меншої кількості файлів не слід. Поточна безпечна оптимізація — lazy loading незалежних optional QR/map runtimes.

## Релізна перевірка

Перед merge: `npm ci`, усі `node tests/*.test.js`, Playwright Chromium, `node --check` для змінених JS, `git diff --check`, а також перевірка `index.html`, `app.js`, `sw.js`, `manifest.json` і закешованих assets у production. Кожен реліз піднімає разом `APP_VERSION` та унікальний `CACHE_NAME`.

Ліцензію не додано: її має визначити власник проєкту.
