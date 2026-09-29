'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('index.html'),app=read('app.js'),pingUi=read('js/tools-ping-ui.js'),toolsDomain=read('js/tools-domain.js');
const scripts=[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match=>match[1]);
for(const src of scripts){
  assert.doesNotMatch(src,/^(?:https?:)?\/\//,'runtime scripts remain local');
  assert.ok(fs.existsSync(path.join(root,src)),`script exists: ${src}`);
}
assert.ok(scripts.indexOf('js/settings-render.js')<scripts.indexOf('js/security-audit-fixes-v65-18-9.js'),'settings renderer loads before security patches');
for(const file of ['js/security-hardening.js','js/security-qr.js','js/security-telegram.js','js/security-runtime-v65-9.js','js/telegram-backup-reliability-v65-13.js','js/security-dom-final-v65-18.js','js/security-audit-fixes-v65-18-9.js']){
  assert.doesNotMatch(read(file),/renderSettingsScreen/,'obsolete version wrapper removed from '+file);
}
for(const label of ['SECURITY_RELEASE_LABEL','SECURITY_LOCK_RELEASE_LABEL','SECURITY_QR_RELEASE_LABEL','SECURITY_TELEGRAM_RELEASE_LABEL','SECURITY_RUNTIME_RELEASE_LABEL','TELEGRAM_BACKUP_RELIABILITY_LABEL','SECURITY_DOM_FINAL_RELEASE_LABEL']){
  assert.doesNotMatch(scripts.map(read).join('\n'),new RegExp(label),'obsolete version constant removed: '+label);
}
assert.doesNotMatch(app,/loadShiftsFromCloud/,'unused cloud wrapper removed');
assert.doesNotMatch(pingUi,/toolsPingStopMonitor/,'unused monitor stop wrapper removed');
assert.match(toolsDomain,/action==='ping-stop'\)toolsPingStop\(\)/,'Ping Stop still dispatches through active handler');
assert.match(pingUi,/function toolsPingStop\(\)/,'active Ping Stop handler remains');
assert.doesNotMatch(html,/dogovorUrlInput|URL сторінки договору/,'unused contract URL setting is not shown');
assert.doesNotMatch(read('js/settings-render.js')+read('js/settings-domain.js'),/dogovorUrlInput|settings\.dogovorUrl/,'unused contract URL UI has no render or binding');
assert.match(read('js/settings-core.js'),/dogovorUrl:''/,'legacy setting remains in schema');
assert.match(read('js/security-hardening.js'),/'dogovorUrl'/,'legacy URL remains accepted by security import path');
assert.match(read('js/qr-share-domain.js'),/securityQrBuildContractUrl\(/,'contract QR still uses the active builder');
assert.match(read('js/security-qr.js'),/new URL\('d.html',location.href\)/,'contract QR still targets the local viewer');
console.log('PASS dead wrappers removed; script loading, Ping Stop, legacy settings and QR path remain intact');
