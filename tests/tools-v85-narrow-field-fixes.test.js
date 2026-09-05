'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const core=require('../js/tools-core.js'),domain=read('js/tools-domain.js'),telegram=read('js/photo-telegram-domain.js'),address=read('js/ticket-address-domain.js'),styles=read('styles.css'),html=read('index.html'),app=read('app.js'),sw=read('sw.js');

// A-C: zoom changes real layout size; reset/next return to 100%, swipe is enabled only at 100%.
const viewer=domain.slice(domain.indexOf('async function toolsOpenNetworkPhotoViewer'),domain.indexOf('function toolsMoveNetworkPoint'));
assert.match(viewer,/tools-photo-viewer-stage/);assert.match(viewer,/image\.style\.width=`\$\{zoom\*100\}%`/);
assert.match(viewer,/const move=delta=>\{index=.*zoom=1;draw\(true\)/);assert.match(viewer,/toolsPhotoZoomReset/);assert.match(viewer,/image\.ondblclick/);assert.match(viewer,/if\(zoom!==1/);
assert.match(styles,/tools-photo-viewer-stage\{[^}]*overflow:auto/);assert.match(styles,/img\.zoomed\{max-width:none/);

// D-I/R/S: text remains one publication; v85 photos have stable local-key -> Telegram message refs.
assert.match(telegram,/async function sendTelegramPhotoMessage/);assert.match(telegram,/async function deleteTelegramMessageById/);
assert.match(domain,/sendToTelegramChat\(chatId,text,null,null\)/);assert.match(domain,/sendTelegramPhotoMessage\(current\.telegramChatId,key/);
assert.match(domain,/deleteTelegramMessageById\(current\.telegramChatId,ref\.messageId\)/);assert.match(domain,/untrackedLegacy/);
assert.match(domain,/current\.telegramMediaRefs=refs/);assert.doesNotMatch(domain,/sendToTelegramChat\(chatId,text,photos\[0\]/);
const point=core.normalizeNetworkPoint({id:'p1',type:'Муфта',lat:48,lng:37,photoKeys:['photo:a'],telegramMediaRefs:[{photoKey:'photo:a',messageId:123}]},new Date('2026-09-01T12:00:00Z'));
assert.deepEqual(point.telegramMediaRefs,[{photoKey:'photo:a',messageId:123}]);
const legacy=core.normalizeNetworkPoint({id:'p2',type:'FOB',lat:48,lng:37,photoKeys:['photo:old']},new Date('2026-09-01T12:00:00Z'));
assert.deepEqual(legacy.telegramMediaRefs,[]);

// J-N: close/cancel/save restore the same address profile; unchanged marker does not save.
const picker=domain.slice(domain.indexOf('function openAbonentMapPointPicker'),domain.indexOf('function toolsNetworkHtml'));
assert.match(picker,/closeModal\(\);renderAddressNav\(\)/);assert.match(picker,/if\(!picker\?\.hasChanged\(\)\)/);
assert.match(picker,/if\(!await saveTickets\(\)\)/);assert.match(picker,/showToast\('✅ Точку збережено'\)/);

// O-Q: all internal searches/address inputs opt out of postal autofill, editor is symmetric and scrollable.
assert.match(domain,/name="mt-internal-point-city" autocomplete="off"/);assert.match(domain,/name="mt-internal-point-street" autocomplete="off"/);
assert.match(domain,/name="mt-internal-map-profile-search"/);assert.match(domain,/name="mt-internal-network-search"/);
assert.match(address,/type="search" role="searchbox" name="mt-internal-profile-search"/);
assert.match(html,/name="mt-internal-ticket-city"/);assert.match(html,/name="mt-internal-ticket-street"/);
assert.match(domain,/options\.placement\?'tools-point-editor-overlay':'tools-point-editor-modal'/);
assert.match(styles,/tools-point-editor-modal #modalBody\{[^}]*padding:2px 6px[^}]*overflow-x:hidden/);
assert.match(styles,/tools-point-editor-footer\{position:sticky/);
assert.match(app,/v88 · 2026-09-05/);assert.match(sw,/maister-treker-v66-runtime-30/);

console.log('PASS v85 viewer, Telegram media refs, profile coordinate flow, autofill semantics and mobile editor regressions');
