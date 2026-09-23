'use strict';
/* v91.66: браузерні екрани 📡 Пінг і ⚡ Speedtest.
   Зовнішні виклики мокаються (Globalping, Cloudflare-движок не запускаємо:
   реальний трафік у CI неприпустимий) — перевіряємо навігацію, запуск,
   зупинку, людські повідомлення про помилки і сумісність зі старими Tools. */
const fs = require('node:fs');
const path = require('node:path');
const {test, expect, gotoApp, waitServiceWorkerCacheReady} = require('./app-test');

const GP_JSON = {id:'m-e2e'};
const GP_DONE = {status:'done',results:[
  {probe:{country:'UA',city:'Kyiv',network:'Kyivstar'},result:{status:'done',stats:{min:17,avg:18,max:20,loss:0}}},
  {probe:{country:'PL',city:'Warsaw',network:'Orange'},result:{status:'done',stats:{min:29,avg:31,max:35,loss:0}}}
]};

async function openTools(page, appEnv){
  await gotoApp(page, appEnv.url);
  await page.click('.tab-btn[data-tab="tools"]');
  await expect(page.locator('#toolsScreenRoot')).toBeVisible();
}

test('v91.67: наявні обидва екрани в меню Інструментів, навігація туди-назад', async ({page, context, appEnv}) => {
  await openTools(page, appEnv);
  await expect(page.locator('[data-tools-view="ping"]')).toBeVisible();
  await expect(page.locator('[data-tools-view="speedtest"]')).toBeVisible();
  /* Пінг: відкрився свій екран, назад повертає в меню */
  await page.click('[data-tools-view="ping"]');
  await expect(page.locator('#toolsPingTarget')).toBeVisible();
  await expect(page.locator('#toolsScreenRoot')).toContainText('Ціль перевірки');
  await page.locator('[data-app-back]').first().click();
  await expect(page.locator('[data-tools-view="speedtest"]')).toBeVisible();
  /* Speedtest: свій екран, спидометр намальований */
  await page.click('[data-tools-view="speedtest"]');
  await expect(page.locator('.tools-speed-dial')).toBeVisible();
  await expect(page.locator('#toolsScreenRoot')).toContainText('Мбіт/с');
  await page.locator('[data-app-back]').first().click();
  await expect(page.locator('[data-tools-view="ping"]')).toBeVisible();
});

test('v91.67: пінг публічної цілі йде в Globalping і показує реальні відповіді зондів', async ({page, context, appEnv}) => {
  await openTools(page, appEnv);
  let measurements = 0;
  await context.route('**/api.globalping.org/v1/measurements**', route => {
    const url = route.request().url();
    if (route.request().method() === 'POST') { measurements++; return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(GP_JSON)}); }
    return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(GP_DONE)});
  });
  await page.click('[data-tools-view="ping"]');
  await page.fill('#toolsPingTarget', 'example.com');
  await page.click('[data-tools-action="ping-start"]');
  await expect(page.locator('#toolsPingResults')).toContainText('Україна', {timeout: 10000});
  await expect(page.locator('#toolsPingResults')).toContainText('18 мс');
  await expect(page.locator('#toolsPingResults')).toContainText('не з цього телефону');
  expect(measurements).toBe(1);
});

test('v91.67: пінг приватної адреси ніколи не доходить до Globalping, локальний пристрій перевіряється з телефону', async ({page, context, appEnv}) => {
  await openTools(page, appEnv);
  let globalpingHits = 0;
  await context.route('**/api.globalping.org/**', route => { globalpingHits++; return route.fulfill({status: 500, body: 'MUST NOT BE CALLED'}); });
  /* Реальний 192.168.x у headless-Chromium блокується LNA ще до мережевого
     стеку (route такий запит не бачить). Для інтеграційного сценарію беремо
     loopback того самого статичного сервера: 127.0.0.1 класифікується як
     private і маршрутизується в локальну перевірку так само, як 192.168.x.x,
     а відповідь сервера — це реальна відповідь пристрою в мережі. */
  const serverPort = new URL(appEnv.url).port;
  await page.click('[data-tools-view="ping"]');
  await page.fill('#toolsPingTarget', '127.0.0.1:' + serverPort);
  await page.click('[data-tools-action="ping-start"]');
  await expect(page.locator('#toolsPingResults')).toContainText('Пристрій у мережі', {timeout: 10000});
  await expect(page.locator('#toolsPingResults')).toContainText('Відгук: ~');
  expect(globalpingHits).toBe(0);
});

test('v91.67: помилка пінга (rate limit) показується людською, без технічного жаргону', async ({page, context, appEnv}) => {
  await openTools(page, appEnv);
  await context.route('**/api.globalping.org/v1/measurements**', route => route.fulfill({status: 429, contentType: 'application/json', body: '{}'}));
  await page.click('[data-tools-view="ping"]');
  await page.fill('#toolsPingTarget', 'example.com');
  await page.click('[data-tools-action="ping-start"]');
  await expect(page.locator('#toolsPingResults')).toContainText('Занадто багато перевірок', {timeout: 10000});
  const text = await page.locator('#toolsPingResults').innerText();
  expect(text).not.toMatch(/429|HTTP|ICMP|CORS/);
});

test('v91.67: некоректна ціль відхиляється одразу, без жодного запиту', async ({page, context, appEnv}) => {
  await openTools(page, appEnv);
  let anyGlobalping = 0;
  await context.route('**/api.globalping.org/**', route => { anyGlobalping++; return route.fulfill({status: 200, contentType: 'application/json', body: '{}'}); });
  await page.click('[data-tools-view="ping"]');
  await page.fill('#toolsPingTarget', 'javascript:alert(1)');
  await page.click('[data-tools-action="ping-start"]');
  await expect(page.locator('#toolsPingResults')).toContainText('Перевірку ще не запускали');
  expect(anyGlobalping).toBe(0);
});

test('v91.67: «■ Зупинити» пінга чисто скасовує перевірку', async ({page, context, appEnv}) => {
  await openTools(page, appEnv);
  await context.route('**/api.globalping.org/v1/measurements**', route => new Promise(() => {})); // вічный pending POST
  await page.click('[data-tools-view="ping"]');
  await page.fill('#toolsPingTarget', 'example.com');
  await page.click('[data-tools-action="ping-start"]');
  await expect(page.locator('[data-tools-action="ping-stop"]')).toBeVisible();
  await page.click('[data-tools-action="ping-stop"]');
  await expect(page.locator('[data-tools-action="ping-start"]')).toBeVisible();
});

test('v91.67: пресет 1.1.1.1 перевіряється напряму з телефону (HTTPS), без Globalping', async ({page, context, appEnv}) => {
  await openTools(page, appEnv);
  let directHits = 0, globalpingHits = 0;
  await context.route(/^https:\/\/1\.1\.1\.1\//, route => { directHits++; return route.fulfill({status: 200, body: 'ok'}); });
  await context.route('**/api.globalping.org/**', route => { globalpingHits++; return route.fulfill({status: 500, body: 'MUST NOT BE CALLED'}); });
  await page.click('[data-tools-view="ping"]');
  await page.fill('#toolsPingTarget', '1.1.1.1');
  await page.click('[data-tools-action="ping-start"]');
  await expect(page.locator('#toolsPingResults')).toContainText('Доступний', {timeout: 10000});
  await expect(page.locator('#toolsPingResults')).toContainText('Успішних спроб: 3/3');
  await expect(page.locator('#toolsPingResults')).toContainText('не ICMP-пінг');
  expect(directHits).toBe(3);
  expect(globalpingHits).toBe(0);
});

/* Speedtest працює напряму з speed.cloudflare.com (крос-домен: SW пропускає,
   route перехоплює). Мок віддає до 2 МБ на запит — тест завершується швидко
   і вимірює реальні байти/час у браузері. */
function mockCloudflareSpeed(context){
  return Promise.all([
    context.route(/speed\.cloudflare\.com\/__down/, route => {
      const bytes = Number(new URL(route.request().url()).searchParams.get('bytes')) || 0;
      const serve = Math.min(2_000_000, bytes);
      return route.fulfill({status: 200, contentType: 'application/octet-stream', headers: {'access-control-allow-origin': '*'}, body: serve > 0 ? 'x'.repeat(serve) : ''});
    }),
    context.route(/speed\.cloudflare\.com\/__up/, route => route.fulfill({status: 200, contentType: 'text/plain', headers: {'access-control-allow-origin': '*'}, body: 'ok'}))
  ]);
}

test('v91.67: Speedtest — адаптивні потоки до speed.cloudflare.com, стадії й фінальні метрики, UI відновлюється', async ({page, context, appEnv}) => {
  await mockCloudflareSpeed(context);
  await openTools(page, appEnv);
  await page.click('[data-tools-view="speedtest"]');
  await page.click('[data-tools-action="speed-start"]');
  await expect(page.locator('#toolsSpeedStage')).toContainText('Завантаження', {timeout: 10000});
  await expect(page.locator('#toolsSpeedResults')).toContainText('Мбіт/с', {timeout: 30000});
  await expect(page.locator('#toolsSpeedResults')).toContainText('Відвантаження');
  await expect(page.locator('#toolsSpeedResults')).toContainText('Стабільність');
  await expect(page.locator('#toolsSpeedResults')).toContainText('Вимірювання: Cloudflare');
  await expect(page.locator('#toolsSpeedResults')).toContainText('Передано: ↓');
  const resultsText = await page.locator('#toolsSpeedResults').innerText();
  expect(resultsText).not.toMatch(/Втрати|packet loss/i);
  expect(resultsText).not.toMatch(/Не вдалося виміряти/);
  /* Повторный запуск и остановка: UI восстанавливается */
  await page.locator('#toolsSpeedResults [data-tools-action="speed-start"]').click();
  await expect(page.locator('[data-tools-action="speed-stop"]')).toBeVisible();
  await page.click('[data-tools-action="speed-stop"]');
  await expect(page.locator('[data-tools-action="speed-start"]').first()).toBeVisible();
});

test('v91.67: Speedtest — «■ Зупинити» не записує незавершений результат і відновлює UI', async ({page, context, appEnv}) => {
  await context.route(/speed\.cloudflare\.com\/__down/, route => new Promise(() => {})); // вічний pending
  await openTools(page, appEnv);
  await page.click('[data-tools-view="speedtest"]');
  await page.click('[data-tools-action="speed-start"]');
  await expect(page.locator('[data-tools-action="speed-stop"]')).toBeVisible();
  await page.click('[data-tools-action="speed-stop"]');
  await expect(page.locator('[data-tools-action="speed-start"]')).toBeVisible();
  await expect(page.locator('#toolsSpeedResults')).toContainText('Тест ще не запускався');
  /* Догравання скасованого тесту не малює результатів */
  await expect(page.locator('#toolsSpeedResults')).not.toContainText('Мбіт/с');
});

test('v91.67: старі інструменти продовжують працювати поруч із новими', async ({page, context, appEnv}) => {
  await openTools(page, appEnv);
  /* Діагностика відкривається окремо: запуск, роутер-пресети (пін v82) на місці */
  await page.click('[data-tools-action="quick-diagnostics"]');
  await expect(page.locator('#toolsScreenRoot')).toContainText('Швидка діагностика');
  await expect(page.locator('[data-tools-action="run-diagnostics"]')).toBeVisible();
  await expect(page.locator('[data-router-ip="192.168.1.1"]')).toBeVisible();
  /* Назад — і нові екрани досі на місці */
  await page.locator('[data-app-back]').first().click();
  await expect(page.locator('[data-tools-view="ping"]')).toBeVisible();
  await page.click('[data-tools-view="speedtest"]');
  await expect(page.locator('.tools-speed-dial')).toBeVisible();
});
