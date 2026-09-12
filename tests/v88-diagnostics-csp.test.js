'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),domain=require('./helpers/tools-source').readToolsSource();
const csp=html.match(/Content-Security-Policy" content="([^"]+)/)?.[1]||'';
assert.match(csp,/connect-src[^;]*https:\/\/api\.ipify\.org/,'internet check endpoint stays allowed');
assert.match(csp,/connect-src[^;]*https:\/\/speed\.cloudflare\.com/,'browser speed measurement stays allowed');
assert.doesNotMatch(domain,/toolsConnectionTarget/,'no leftover host input for the retired continuous check');
assert.doesNotMatch(csp,/connect-src[^;]*\*/,'connect-src stays explicit');
console.log('PASS diagnostics network hosts are explicitly allowed by production connect-src');
