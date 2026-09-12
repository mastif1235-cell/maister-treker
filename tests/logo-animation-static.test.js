'use strict';

// Анімований логотип нижнього меню: один sprite-файл на всі пункти, анімація
// через CSS без бібліотек, статичний кадр для prefers-reduced-motion і
// обовʼязковий pre-cache у service worker.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file=>fs.readFileSync(path.join(ROOT, file), 'utf8');

const FRAME_COUNT = 12;
const FRAME_SOURCE_SIZE = 96;
const FRAME_CSS_SIZE = 28;
const STRIP_CSS_WIDTH = FRAME_COUNT * FRAME_CSS_SIZE;

/* ---------- сам asset ---------- */

const assetPath = path.join(ROOT, 'assets', 'logo-tab-sprite.png');
assert.ok(fs.existsSync(assetPath), 'sprite лежить в assets/logo-tab-sprite.png');
const sprite = fs.readFileSync(assetPath);
assert.equal(sprite.slice(1, 4).toString('ascii'), 'PNG', 'asset є PNG-файлом');
const width = sprite.readUInt32BE(16), height = sprite.readUInt32BE(20), colorType = sprite[25];
assert.equal(height, FRAME_SOURCE_SIZE, 'висота sprite = 96px, тобто один рядок кадрів');
assert.equal(width, FRAME_SOURCE_SIZE * FRAME_COUNT, 'ширина sprite = 12 кадрів по 96px');
assert.equal(colorType, 6, 'PNG має альфа-канал, фон прозорий');

const assetFiles = fs.readdirSync(path.join(ROOT, 'assets'));
assert.deepEqual(assetFiles, ['logo-tab-sprite.png'], 'у assets лежить лише один файл анімації, без копій на кожен пункт');

/* ---------- розмітка меню ---------- */

const html = read('index.html');
const tabbar = html.slice(html.indexOf('<nav class="tabbar">'), html.indexOf('</nav>', html.indexOf('<nav class="tabbar">')));
const tabButtons = [...tabbar.matchAll(/<button[^>]*class="tab-btn[^"]*"[^>]*>([\s\S]*?)<\/button>/g)].map(match=>match[1]);
assert.equal(tabButtons.length, 5, 'у нижньому меню пʼять пунктів');
for(const inner of tabButtons){
  assert.equal((inner.match(/class="icon tab-logo"/g) || []).length, 1, 'кожен пункт має рівно один логотип');
}
assert.equal((tabbar.match(/aria-hidden="true"/g) || []).length, 5, 'логотип не дублює підпис для скрін-рідера');
assert.doesNotMatch(tabbar, /[\u{1F300}-\u{1FAFF}]/u, 'emoji з пунктів меню прибрано');
assert.doesNotMatch(tabbar, /<video|\.mp4|\.webm|<canvas/i, 'у пункті меню немає окремого відео чи canvas');
assert.doesNotMatch(html + read('styles.css'), /lottie/i, 'анімація не тягне бібліотек');

/* ---------- CSS ---------- */

const css = read('styles.css');
const logoRule = css.slice(css.indexOf('.tab-btn .tab-logo{'), css.indexOf('@media (max-width:430px)'));
assert.match(logoRule, /width:28px; height:28px/, 'визуальний розмір логотипа 28px');
assert.match(logoRule, /url\('assets\/logo-tab-sprite\.png'\)/, 'CSS використовує один sprite-файл');
assert.match(logoRule, new RegExp(`background-size:${STRIP_CSS_WIDTH}px 28px`), 'кадр у CSS масштабується рівно з 96px до 28px');
assert.match(logoRule, /animation:mt-tab-logo 3s steps\(1, end\) infinite/, 'анімація циклічна, 3 секунди, без проміжних кадрів');

const keyframes = css.slice(css.indexOf('@keyframes mt-tab-logo'), css.indexOf('@media (prefers-reduced-motion'));
const stops = [...keyframes.matchAll(/([\d.]+)%\{transform:translateX\((-?\d+)(?:px)?\)\}/g)].map(match=>({at:Number(match[1]), x:Number(match[2])}));
assert.equal(stops.length, FRAME_COUNT + 1, 'у ключових кадрах 12 кадрів плюс утримання останнього');
assert.equal(stops[0].at, 0, 'анімація стартує з першого кадру');
assert.equal(stops[0].x, 0, 'перший кадр показує Wi-Fi без зсуву');
for(let index = 1; index < FRAME_COUNT; index++){
  assert.equal(stops[index].x, -FRAME_CSS_SIZE * index, `кадр ${index + 1} стоїть рівно на своїй межі sprite`);
  assert.ok(stops[index].at > stops[index - 1].at, `кадр ${index + 1} іде пізніше за попередній`);
}
const lastFrame = stops[FRAME_COUNT - 1], holdEnd = stops[FRAME_COUNT];
assert.equal(lastFrame.x, -(STRIP_CSS_WIDTH - FRAME_CSS_SIZE), 'останній кадр — повний логотип');
assert.equal(holdEnd.x, lastFrame.x, 'наприкінці циклу логотип лишається на останньому кадрі');
assert.equal(holdEnd.at, 100, 'утримання триває до кінця циклу');
assert.ok(100 - lastFrame.at >= 15, 'пауза на повному логотипі перед повтором помітна (не менше 0.45 с)');

const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion'));
assert.match(reduced, /\.tab-btn \.tab-logo::before\{animation:none; transform:translateX\(-308px\);\}/,
  'без анімації показується останній кадр — повний логотип');

/* ---------- PWA cache ---------- */

const sw = read('sw.js');
assert.ok(sw.includes("'./assets/logo-tab-sprite.png'"), 'sprite додано в CORE_ASSETS service worker');
assert.equal((sw.match(/logo-tab-sprite\.png/g) || []).length, 1, 'sprite згадано в pre-cache один раз');
assert.doesNotMatch(sw, /\.mp4|\.webm|\.gif/i, 'у pre-cache немає окремого відео для анімації логотипа');

console.log('PASS one shared tab-bar sprite, exact 12-frame CSS steps, static frame for reduced motion, precached for offline');
