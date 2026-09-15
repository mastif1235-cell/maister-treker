'use strict';
/* Атомарний boot runtime Service Worker (fix v91.30, HIGH) — реальні браузерні
   Service Worker-сценарії:
     B/C. Обов'язковий classic script віддає 404 → install нової версії
          провалюється, новий SW НЕ активується, старий кеш не знищується;
     E.   Офлайн-reload після невдалої інсталяції → стара версія працює;
     D.   Лінивий runtime-актив недоступний → оновлення активується, boot офлайн
          працює (застосунок здатен стартувати без нього).
   Успішне оновлення (G) уже покрите e2e/sw-update.spec.js — тепер воно додатково
   проходить і через перевірку повноти boot runtime у новому кеші. */
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, gotoApp, waitServiceWorkerCacheReady, waitAppReady, readSwCacheName } = require('./app-test');

test('SW-atomic: 404 на обов\'язковому скрипті не активує нову версію і не руйнує стару (B/C/E)', async ({ page, appEnv }) => {
  const errors = await gotoApp(page, appEnv.url);
  const oldCache = await waitServiceWorkerCacheReady(page);

  // «Ломаем» обов'язковий boot-скрипт: сервер честно віддає 404 на нього,
  // і випускаємо оновлення з новим CACHE_NAME.
  const brokenScript = path.join(appEnv.dir, 'js', 'tickets-domain.js');
  fs.rmSync(brokenScript);
  const swPath = path.join(appEnv.dir, 'sw.js');
  const swSource = fs.readFileSync(swPath, 'utf8');
  const newName = readSwCacheName(swPath) + '-broken-update';
  fs.writeFileSync(swPath, swSource.replace(`const CACHE_NAME = '${oldCache}'`, `const CACHE_NAME = '${newName}'`));

  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if(reg) await reg.update();
  });

  // Нова версія НЕ активується: лишається рівно один (старий) кеш і старий
  // активний SW. Недобудований новий кеш прибирається самим SW.
  await expect.poll(async () => {
    try{
      return await page.evaluate(async (old) => {
        const names = (await caches.keys()).filter(k => k.startsWith('maister-treker-'));
        const reg = await navigator.serviceWorker.getRegistration();
        const installing = reg && reg.installing ? reg.installing.state : null;
        const waiting = reg && reg.waiting ? reg.waiting.state : null;
        return { names, activated: !!(reg && reg.active && reg.active.state === 'activated'), installing, waiting };
      }, oldCache);
    }catch(_navigationError){ return { names: [], activated: false, installing: null, waiting: null }; } // авто-reload сторінки — повторити
  }, { timeout: 60_000, message: 'збійне оновлення не стає активним; старий кеш — єдиний' })
    .toEqual({ names: [oldCache], activated: true, installing: null, waiting: null });

  // Старий кеш недоторканний: повний boot-набір на місці.
  const cacheState = await page.evaluate(async (old) => {
    const cache = await caches.open(old);
    const boot = ['index.html', 'app.js', 'styles.css', 'manifest.json', 'js/tickets-domain.js', 'js/sync-engine-core.js', 'js/app-lock-core.js'];
    const missing = [];
    for(const asset of boot){
      const hit = await cache.match(asset, { ignoreSearch: true }) || await cache.match('./' + asset, { ignoreSearch: true });
      if(!hit) missing.push(asset);
    }
    return { total: (await cache.keys()).length, missing };
  }, oldCache);
  expect(cacheState.missing, 'старий кеш містить увесь boot runtime').toEqual([]);
  expect(cacheState.total).toBeGreaterThanOrEqual(50);

  // E: офлайн-reload після невдалої інсталяції — стара версія повністю працює.
  await page.context().setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitAppReady(page);
  await expect(page.locator('#screen-tickets')).toBeVisible();
  const offlineControlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  expect(offlineControlled, 'офлайн сторінка контролюється старим (робочим) SW').toBe(true);

  expect(errors, `необроблені JS-помилки: ${errors.join(' | ')}`).toEqual([]);
});

test('SW-atomic: відсутній лінивий runtime-актив не блокує оновлення і офлайн-boot (D)', async ({ page, appEnv }) => {
  const errors = await gotoApp(page, appEnv.url);
  const oldCache = await waitServiceWorkerCacheReady(page);

  // Лінивий актив (динамічний import() карти) відсутній — boot він не потребує.
  fs.rmSync(path.join(appEnv.dir, 'js', 'tools-map-maplibre.js'));
  const swPath = path.join(appEnv.dir, 'sw.js');
  const swSource = fs.readFileSync(swPath, 'utf8');
  const newName = readSwCacheName(swPath) + '-lazy-missing';
  fs.writeFileSync(swPath, swSource.replace(`const CACHE_NAME = '${oldCache}'`, `const CACHE_NAME = '${newName}'`));

  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if(reg) await reg.update();
  });

  // Оновлення АКТИВУЄТЬСЯ: застосунок здатен завантажитись без лінивих активів.
  await expect.poll(async () => {
    try{
      return await page.evaluate(async () => {
        const names = (await caches.keys()).filter(k => k.startsWith('maister-treker-'));
        const reg = await navigator.serviceWorker.getRegistration();
        return { names, activated: !!(reg && reg.active && reg.active.state === 'activated') };
      });
    }catch(_navigationError){ return { names: [], activated: false }; } // авто-reload після активації — повторити
  }, { timeout: 60_000, message: 'оновлення без лінивого активу активується атомарно' })
    .toEqual({ names: [newName], activated: true });

  // Офлайн-boot під новою версією працює.
  await page.context().setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitAppReady(page);
  await expect(page.locator('#screen-tickets')).toBeVisible();

  expect(errors, `необроблені JS-помилки: ${errors.join(' | ')}`).toEqual([]);
});
