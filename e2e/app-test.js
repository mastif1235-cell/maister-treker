'use strict';
/* Спільні фікстури й хелпери E2E. `appEnv` — ізольована копія застосунку
   (тимчасова директорія + статичний сервер) на кожен тест. */
const { test: base, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { createAppEnv } = require('./helpers/env');

const test = base.extend({
  appEnv: async ({}, use) => {
    const env = await createAppEnv();
    try{
      await use(env);
    }finally{
      await env.close();
      fs.rmSync(env.dir, { recursive: true, force: true });
    }
  },
});

/* Збирає необроблені JS-помилки сторінки (саме unhandled exceptions, не
   console.error — ті легітимно трапляються, наприклад, при офлайн-перевірці
   оновлення SW і обробляються MTSafeError). */
function collectPageErrors(page){
  const errors = [];
  page.on('pageerror', error => errors.push(String((error && error.message) || error)));
  return errors;
}

async function waitAppReady(page, timeout = 60_000){
  await page.waitForFunction(() => window.__mtAppInitDone === true, null, { timeout });
}

/* Відкрити застосунок і дочекатись завершення init(). Перший візит
   автоматично перезавантажує сторінку: install→activate SW закінчується
   clients.claim(), на який застосунок реагує м'яким авто-reload
   (controllerchange → serviceWorkerApplyUpdate). Тому чекаємо: маркер
   готовності → появу controller → «тихий період» без навігацій → знову
   маркер готовності вже стабільного документа. */
async function gotoApp(page, baseUrl){
  const errors = collectPageErrors(page);
  let lastNavigation = Date.now();
  page.on('framenavigated', frame => {
    if(frame === page.mainFrame()) lastNavigation = Date.now();
  });
  /* Щоденна пропозиція зовнішнього бекапу — фіксована картка внизу екрана;
     у реальному житті вона зникає після збереження копії за сьогодні. У E2E
     «зберігаємо» її наперед (той самий localStorage-ключ), щоб вона не
     перекривала кнопки форми/карток — її поведінка вже покрита юніт-тестом
     tests/external-daily-backup.test.js. */
  await page.addInitScript(() => {
    try{
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      localStorage.setItem('externalDailyBackupDate', `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
    }catch(_e){}
  });
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await waitAppReady(page);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 }).catch(() => {});
  const deadline = Date.now() + 20_000;
  while(Date.now() - lastNavigation < 1_500 && Date.now() < deadline){
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await waitAppReady(page, 30_000);
  await page.waitForSelector('.tab-btn[data-tab="tickets"]');
  return errors;
}

/* Service Worker встановлений, активований, контролює сторінку, а його кеш
   містить повний набір ядра (перевірка завершення install-прекешу). */
async function waitServiceWorkerCacheReady(page, timeout = 60_000){
  await page.waitForFunction(async () => {
    if(!navigator.serviceWorker.controller) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if(!reg || !reg.active || reg.active.state !== 'activated') return false;
    const names = (await caches.keys()).filter(k => k.startsWith('maister-treker-'));
    if(names.length !== 1) return false;
    const cache = await caches.open(names[0]);
    const keys = await cache.keys();
    if(keys.length < 50) return false;
    // Критичне ядро обов'язково присутнє — інакше офлайн-старт неповний.
    for(const critical of ['index.html', 'app.js', 'styles.css', 'manifest.json']){
      const hit = await cache.match(critical, { ignoreSearch: true }) || await cache.match('./' + critical, { ignoreSearch: true });
      if(!hit) return false;
    }
    return true;
  }, null, { timeout });
  return await page.evaluate(async () => (await caches.keys()).filter(k => k.startsWith('maister-treker-'))[0]);
}

/* Створення заявки через реальний UI-шлях: вкладка «Калькулятор» → форма →
   «Зберегти заявку» → картка у списку. Повертає унікальне ім'я клієнта. */
async function createTicketViaUi(page, clientName){
  await page.click('.tab-btn[data-tab="calculator"]');
  await expect(page.locator('#screen-calculator')).toBeVisible();
  await expect(page.locator('#saveTicketBtn')).toBeVisible();
  await page.fill('#f_client', clientName);
  await page.selectOption('#f_payment', 'Готівка');
  await page.click('#saveTicketBtn');
  await expect(page.locator('#toastRoot .toast', { hasText: 'Заявку збережено' }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#screen-tickets')).toBeVisible();
  await expect(page.locator('#ticketList .ticket-card', { hasText: clientName }).first()).toBeVisible({ timeout: 20_000 });
}

function readSwCacheName(filePath){
  const source = fs.readFileSync(filePath, 'utf8');
  const match = source.match(/const CACHE_NAME = '([^']+)'/);
  if(!match) throw new Error('CACHE_NAME не знайдено у ' + filePath);
  return match[1];
}

module.exports = { test, expect, collectPageErrors, waitAppReady, gotoApp, waitServiceWorkerCacheReady, createTicketViaUi, readSwCacheName, path };
