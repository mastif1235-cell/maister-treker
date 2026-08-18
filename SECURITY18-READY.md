# Майстер-Трекер — security.18 READY

Цей файл є актуальним порядком міграції. Старий `SYNC_SECRET` під час першого етапу НЕ змінюємо.

## Чому два секрети

Поточна стабільна PWA `17.3` використовує legacy `SYNC_SECRET`. Він може бути коротким і вже працює у фактичному Apps Script.

Security.18 використовує окремий `SECURE_AUTH_HMAC_SECRET` довжиною щонайменше 32 символи. Завдяки цьому серверний wrapper можна задеплоїти заздалегідь, не ламаючи 17.3.

## Етап A — сервер, без зміни клієнта

1. Зробити фізичний backup.
2. У фактичному `Code.gs` НЕ змінювати поточний `SYNC_SECRET`.
3. Перейменувати старі точки входу:
   - `function doPost(e)` → `function legacyDoPostV65(e)`
   - `function doGet(e)` → `function legacyDoGetV65(e)`
4. У кінець вставити `apps-script-security-v65-18-patch.gs`.
5. У `SECURE_AUTH_HMAC_SECRET` вставити новий випадковий секрет 32+ символи.
6. Задеплоїти нову версію Web App.
7. На все ще старій PWA 17.3 перевірити читання та одну тестову операцію запису. Вона має працювати через старий `SYNC_SECRET`.

## Етап B — клієнт security.18

1. У налаштуванні Google Sync застосунку замінити `syncSecret` на той самий новий HMAC secret.
2. Лише після успішного Етапу A підключити `js/security-sync-hmac-v65-18.js` у Service Worker та підняти release/cache до security.18.
3. Перезапустити PWA.

## Smoke test

Перевірити послідовно:

1. читання заявок з Google;
2. створення тестової заявки;
3. фактичну появу рядка у таблиці;
4. редагування;
5. фактичне оновлення рядка;
6. видалення;
7. фактичне зникнення рядка;
8. перезапуск PWA та повторне читання;
9. фото/Telegram/Viber share;
10. зміни окремо — `shiftsScriptUrl` лишається на legacy протоколі.

## Негативні HMAC перевірки

- повтор того самого nonce відхиляється;
- timestamp поза ±5 хв відхиляється;
- змінений GET id/action або POST body з попереднім sig відхиляється;
- невідома signed GET action відхиляється;
- пошкоджений replay ledger працює fail-closed;
- HMAC secret коротший 32 символів не активує v2.

Детерміновані canonical/HMAC значення лежать у `SECURITY18-HMAC-TEST-VECTORS.md`.

## Strict cutover

Тільки після успішного smoke test застосувати `apps-script-security-v65-18-strict-patch.gs` і створити ще одну версію deployment. Після цього legacy `?secret=`/`secret` мережеві запити більше не приймаються.

Старий `SYNC_SECRET` після strict cutover використовується лише локально всередині legacy business logic, куди wrapper підставляє його вже після успішної HMAC-перевірки; мережею він не передається.

## Відкат

До strict cutover відкат простий: повернути Service Worker до стабільної `17.3`; серверний migration wrapper може лишитися, бо legacy fallback ще працює. Якщо проблема у wrapper — повернути попередній Apps Script deployment.

Під час міграції не запускати `clearAll` або масову перезаписуючу синхронізацію.