'use strict';
/* Сценарій D (пункти 19/20): Service Worker install → activate → update.
   Після випуску sw.js з новим CACHE_NAME реєстрація оновлюється, новий SW
   коректно активується, старий кеш атомарно видаляється — mixed-version
   app shell неможливий: лишається рівно один кеш нового релізу, і застосунок
   перезавантажується під новим SW без помилок. */
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, gotoApp, waitServiceWorkerCacheReady, waitAppReady, readSwCacheName } = require('./app-test');

test('D: оновлення SW з новим CACHE_NAME активується атомарно, без мішанини версій', async ({ page, appEnv }) => {
  const errors = await gotoApp(page, appEnv.url);

  // 1. Перше встановлення: install → activate, повний кеш ядра.
  const oldCache = await waitServiceWorkerCacheReady(page);

  // 2. «Випускаємо» нову версію: той самий sw.js, але з новим CACHE_NAME
  //    (у тестах це робиться в тимчасовій копії застосунку).
  const swPath = path.join(appEnv.dir, 'sw.js');
  const swSource = fs.readFileSync(swPath, 'utf8');
  const currentName = readSwCacheName(swPath);
  expect(currentName).toBe(oldCache);
  const newName = currentName + '-e2e-update';
  fs.writeFileSync(swPath, swSource.replace(`const CACHE_NAME = '${currentName}'`, `const CACHE_NAME = '${newName}'`));

  // 3. Ініціюємо перевірку оновлення, як це робить застосунок
  //    (registration.update() + updateViaCache:'none').
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if(reg) await reg.update();
  });

  // 4. Чекаємо активації нового SW з боку Node-процесу: під час активації
  //    сторінка може штатно авто-перезавантажитись (controllerchange →
  //    м'яке оновлення), тому стійко опитуємо кеші/реєстрацію, а не один
  //    довгий in-page цикл.
  await expect.poll(async () => {
    try{
      return await page.evaluate(async () => {
        const names = (await caches.keys()).filter(k => k.startsWith('maister-treker-'));
        const reg = await navigator.serviceWorker.getRegistration();
        return { names, activated: !!(reg && reg.active && reg.active.state === 'activated') };
      });
    }catch(_navigationError){
      return { names: [], activated: false }; // контекст недоступний під час авто-reload
    }
  }, { timeout: 60_000, message: 'новий SW активувався і лишив рівно один (новий) кеш' })
    .toEqual({ names: [newName], activated: true });

  // 5. Mixed-version перевірка: старий кеш видалений, новий — повний набір
  //    одного релізу (критичне ядро присутнє в новому CACHE_NAME).
  const cacheState = await page.evaluate(async (expectedName) => {
    const names = await caches.keys();
    const stale = names.filter(k => k.startsWith('maister-treker-') && k !== expectedName);
    const cache = await caches.open(expectedName);
    const keys = await cache.keys();
    const missing = [];
    for(const critical of ['index.html', 'app.js', 'styles.css', 'manifest.json', 'js/settings-core.js', 'js/backup-system.js']){
      const hit = await cache.match(critical, { ignoreSearch: true }) || await cache.match('./' + critical, { ignoreSearch: true });
      if(!hit) missing.push(critical);
    }
    return { stale, total: keys.length, missing };
  }, newName);
  expect(cacheState.stale, 'старих кешів після активації не лишилось').toEqual([]);
  expect(cacheState.missing, 'новий кеш містить критичне ядро').toEqual([]);
  expect(cacheState.total).toBeGreaterThanOrEqual(50);

  // 6. Сторінка працює під новим SW (можливо, вже після авто-reload).
  await waitAppReady(page);
  const afterUpdate = await page.evaluate(() => ({
    controlled: !!navigator.serviceWorker.controller,
    diag: window.__mtServiceWorkerDiagnostics ? window.__mtServiceWorkerDiagnostics() : null,
  }));
  expect(afterUpdate.controlled, 'новий SW контролює сторінку').toBe(true);
  if(afterUpdate.diag && afterUpdate.diag.cacheName){
    expect(afterUpdate.diag.cacheName, 'застосунок бачить активний кеш нового релізу').toBe(newName);
  }
  await expect(page.locator('#screen-tickets')).toBeVisible();

  // 7. Офлайн після оновлення: новий кеш самодостатній, shell стартує з нього.
  await page.context().setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitAppReady(page);
  await expect(page.locator('#screen-tickets')).toBeVisible();

  expect(errors, `необроблені JS-помилки під час оновлення SW: ${errors.join(' | ')}`).toEqual([]);
});
