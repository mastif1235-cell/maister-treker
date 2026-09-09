'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const ui=read('js/ui-orchestration.js'),settings=read('js/settings-domain.js'),backup=read('js/backup-system.js'),address=read('js/ticket-address-domain.js');

assert.match(ui,/role="dialog" aria-modal="true" aria-labelledby=/,'application modal is announced accessibly');
assert.match(ui,/event\.key==='Escape'[\s\S]*doClose\(\)/,'Escape uses the safe close path');
assert.match(ui,/event\.key!=='Tab'[\s\S]*focusable[\s\S]*last\.focus/,'focus remains trapped in the dialog');
assert.match(ui,/data-modal-cancel[\s\S]*\.focus/,'cancel receives initial focus');
assert.match(ui,/if\(settled\)return;settled=true/,'confirm promise settles once');
assert.match(ui,/confirmBtn\.disabled=true;cancelBtn\.disabled=true/,'double submit is disabled before completion');
assert.match(address,/typeof mtModalCleanup==='function'/,'direct modal close removes lifecycle listeners');

const clear=settings.slice(settings.indexOf("document.getElementById('clearAllBtn')"),settings.indexOf('bindSettingsCatalogControls'));
assert.ok(clear.indexOf('await openConfirmModal')<clear.indexOf('tickets = []; shifts = []'),'cancel occurs before any wipe mutation');
assert.doesNotMatch(clear,/\bconfirm\s*\(/,'wipe no longer uses browser confirm');
const lock=settings.slice(settings.indexOf("document.getElementById('appLockToggle')"),settings.indexOf("document.getElementById('appLockChangePwBtn')"));
assert.ok(lock.indexOf('await openConfirmModal')<lock.indexOf('settings.appLockEnabled = false'),'lock state changes only after explicit confirm');
assert.doesNotMatch(lock,/\bconfirm\s*\(/,'disable-lock no longer uses browser confirm');
assert.match(backup,/await openConfirmModal\(\{title:'Відновити резервну копію\?'/,'restore-over-current-data uses app confirmation');
assert.match(backup,/await openConfirmModal\(\{title:'Імпортувати незашифрований бекап\?'/,'legacy unencrypted import uses app confirmation');
assert.doesNotMatch(backup,/if\(!confirm\(/,'high-risk backup paths no longer use browser confirm');
console.log('PASS high-risk app modals default to cancel, prevent double submit and gate all mutations');
