'use strict';

// GitHub Pages не застосовує _headers, але файл лишається заготовкою для
// хостингу, який це вміє. Його CSP не має відставати від фактичного CSP
// index.html, інакше після переїзду зламаються карти, ipify і швидкість.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const headers = fs.readFileSync(path.join(root, '_headers'), 'utf8');

const indexCsp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] || '';
const headerCsp = headers.match(/Content-Security-Policy:\s*([^\n]+)/)?.[1] || '';
assert.ok(indexCsp, 'index.html keeps its CSP meta tag');
assert.ok(headerCsp, '_headers keeps a CSP line');

function directives(csp){
  const map = {};
  for(const part of csp.split(';')){
    const [name, ...values] = part.trim().split(/\s+/);
    if(name) map[name] = values;
  }
  return map;
}
const index = directives(indexCsp), header = directives(headerCsp);

// Джерела з index.html, які стосуються конкретних директив, мають бути і в _headers.
for(const name of ['default-src','script-src','style-src','img-src','connect-src','worker-src','object-src','base-uri','form-action']){
  assert.ok(header[name], `_headers has ${name}`);
  for(const source of index[name] || []) assert.ok(header[name].includes(source), `_headers ${name} keeps ${source} from index.html`);
}
assert.ok(index['upgrade-insecure-requests'] && header['upgrade-insecure-requests'], 'both keep upgrade-insecure-requests');
assert.deepEqual(header['frame-ancestors'], ["'none'"], '_headers keeps the header-only frame-ancestors guard');

// Реально використані застосунком origins не мають випасти з жодного списку.
for(const origin of ['https://tile.openstreetmap.org','https://api.maptiler.com','https://api.ipify.org','https://speed.cloudflare.com','https://api.telegram.org','https://script.google.com']){
  assert.ok(header['connect-src'].includes(origin), `_headers connect-src allows ${origin}`);
  assert.ok(index['connect-src'].includes(origin), `index connect-src allows ${origin}`);
}
for(const origin of ['https://tile.openstreetmap.org','https://api.maptiler.com']){
  assert.ok(header['img-src'].includes(origin), `_headers img-src allows ${origin}`);
  assert.ok(index['img-src'].includes(origin), `index img-src allows ${origin}`);
}

// Захисні обмеження лишаються однаковими і не слабшають.
for(const csp of [index, header]){
  assert.deepEqual(csp['script-src'], ["'self'"], 'script-src stays self-only');
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.deepEqual(csp['base-uri'], ["'self'"]);
  assert.deepEqual(csp['form-action'], ["'self'"]);
}
assert.doesNotMatch(indexCsp, /unsafe-eval|\*/, 'index CSP stays without unsafe-eval and wildcards');
assert.doesNotMatch(headerCsp, /unsafe-eval|(^|\s)\*(\s|;|$)/, '_headers CSP stays without unsafe-eval and wildcards');

console.log('PASS CSP parity: _headers allowlist matches the real index.html CSP without weakening guards');
