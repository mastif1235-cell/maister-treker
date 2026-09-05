'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),domain=fs.readFileSync(path.join(root,'js','tools-domain.js'),'utf8');
const csp=html.match(/Content-Security-Policy" content="([^"]+)/)?.[1]||'';
const placeholder=domain.match(/id="toolsConnectionTarget"[^>]*placeholder="([^"]+)/)?.[1]||'';
assert.equal(placeholder,'https://api.ipify.org');
assert.match(csp,/connect-src[^;]*https:\/\/api\.ipify\.org/);
assert.doesNotMatch(placeholder,/google\.com/i);
console.log('PASS diagnostics suggestion is allowed by production connect-src');
