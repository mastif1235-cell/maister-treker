'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'js/safe-error.js'),'utf8'),logs=[];
const context={console:{error:value=>logs.push(value)}};context.window=context;vm.createContext(context);vm.runInContext(source,context);
const safe=context.MTSafeError;

const token='123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef';
const key='maptiler-secret-value';
const circular={authorization:'Bearer hidden-auth',tgBotToken:token,mapTilerKey:key};circular.self=circular;
const serialized=safe.safeSerialize(circular);
assert.match(serialized,/\[REDACTED\]/);assert.match(serialized,/\[Circular\]/);
assert.doesNotMatch(serialized,/hidden-auth|ABCDEFGHIJKLMNOPQRSTUVWXYZ|maptiler-secret-value/);
assert.equal(safe.normalizeError({name:'AbortError',message:'cancelled'}).cancelled,true);
assert.equal(safe.normalizeError(new Error('schema validation failed')).category,'validation');
assert.equal(safe.normalizeError(new TypeError('Failed to fetch')).category,'network');
assert.equal(safe.userSafeMessage({category:'network',cancelled:false}),'Немає з’єднання або сервіс тимчасово недоступний.');
const before=logs.length;safe.reportError({name:'AbortError',message:'cancelled'},{scope:'import'});assert.equal(logs.length,before,'user cancellation is not reported as a crash');
safe.reportError(new Error(`request key=${key}&token=${token}`),{scope:'map'});assert.equal(logs.length,before+1);assert.doesNotMatch(logs.at(-1),/maptiler-secret-value|ABCDEFGHIJKLMNOPQRSTUVWXYZ/);
assert.doesNotThrow(()=>{context.console.error=()=>{throw new Error('logger failed');};safe.reportError(new Error('outer'));});

const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
assert.ok(html.indexOf('js/safe-error.js')<html.indexOf('app.js'),'safe logger loads before critical application paths');
assert.match(sw,/\.\/js\/safe-error\.js/,'safe logger is available offline');
for(const file of ['app.js','js/backup-system.js','js/photo-telegram-domain.js','js/tools-map-maplibre.js'])assert.match(fs.readFileSync(path.join(root,file),'utf8'),/MTSafeError/);
console.log('PASS safe error normalization, cancellation handling, circular serialization and secret redaction');
