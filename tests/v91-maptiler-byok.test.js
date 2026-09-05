const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');

const values=new Map(),localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
const context={localStorage,module:{exports:{}},globalThis:null};context.globalThis=context;vm.createContext(context);vm.runInContext(read('js/maptiler-local-config.js'),context);
const config=context.module.exports;
assert.equal(config.hasKey(),false,'KEY-1 starts without a key');
assert.equal(config.saveKey('  local-user-key  '),true);assert.equal(config.getKey(),'local-user-key','KEY-2 trims and reads only the device-local key');
assert.equal(config.saveLayer('satellite'),true);assert.equal(config.getLayer(),'satellite');
assert.equal(config.clearKey(),true);assert.equal(config.hasKey(),false,'KEY-6 clears the key');assert.equal(config.getLayer(),'satellite','layer preference is separate');

const html=read('index.html'),sw=read('sw.js'),settings=read('js/settings-core.js'),backup=read('js/backup-system.js'),telegram=read('js/photo-telegram-domain.js');
assert.match(html,/id="mapTilerKeyInput"[^>]+type="password"|type="password"[^>]+id="mapTilerKeyInput"/);
assert.match(html,/img-src[^;]+https:\/\/api\.maptiler\.com/);assert.doesNotMatch(html,/connect-src[^;]+api\.maptiler\.com/,'CSP adds MapTiler only to img-src');
assert.ok(html.indexOf('js/maptiler-local-config.js')<html.indexOf('js/tools-map.js'));assert.match(sw,/js\/maptiler-local-config\.js/);
for(const [name,source] of [['settings',settings],['backup',backup],['telegram',telegram]])assert.doesNotMatch(source,/mt-maptiler-key-v1|MTMapTilerLocal/,`KEY-3/4/5 ${name} path cannot access device key`);
assert.doesNotMatch(read('app.js'),/mt-maptiler-key-v1|MTMapTilerLocal/,'ticket/sync model cannot access key');
console.log('PASS v91 BYOK local storage, no-leak boundaries, UI, CSP, asset wiring');
