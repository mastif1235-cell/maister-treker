'use strict';
// Регрессия: любой локальный <script src> / <link href> из index.html должен
// лежать в CORE_ASSETS sw.js. Иначе новый модуль, забытый в pre-cache, ломает
// первый офлайн-запуск после обновления (кэш-промах при отсутствии сети).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');

function localReferences(source){
  const refs=[];
  for(const match of source.matchAll(/<script[^>]+src="([^"]+)"/g)) refs.push(match[1]);
  for(const match of source.matchAll(/<link[^>]+href="([^"]+)"/g)) refs.push(match[1]);
  return refs
    .filter(ref=>!/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(ref)) // внешние URL не наш контракт
    .map(ref=>ref.replace(/^\.\//,'').split('?')[0].split('#')[0]);
}

const cached=[...sw.matchAll(/'(\.\/[^']+)'/g)].map(match=>match[1].replace(/^\.\//,''));
assert.ok(cached.length>50,'CORE_ASSETS parsed from sw.js');
assert.ok(cached.includes('index.html'),'navigation shell is precached');

const referenced=localReferences(html);
assert.ok(referenced.length>50,`index.html references local runtime assets (found ${referenced.length})`);

const missing=referenced.filter(ref=>!cached.includes(ref));
assert.deepEqual(missing,[],`every local script/stylesheet of index.html must be precached by sw.js CORE_ASSETS (missing: ${missing.join(', ')})`);

// Самопроверка: тест действительно падает, если новый модуль забыли в pre-cache.
const withForgottenModule=referenced.concat(['js/forgotten-module.js']);
assert.equal(withForgottenModule.filter(ref=>!cached.includes(ref)).length,1,'coverage check catches a forgotten module');

assert.ok(cached.every(asset=>!/^[a-z][a-z0-9+.-]*:/i.test(asset)),'CORE_ASSETS entries are same-origin relative paths, never absolute URLs');
assert.ok(cached.every(asset=>!/(?:^|\/\/)(?:[a-z0-9-]+\.)+(?:com|org|net|io|ua)\//i.test(asset)),'CORE_ASSETS keeps no external host');
for(const asset of cached) assert.ok(fs.existsSync(path.join(root,asset)),`cached asset exists on disk: ${asset}`);

console.log('PASS every local index.html script/stylesheet is covered by sw.js CORE_ASSETS');
