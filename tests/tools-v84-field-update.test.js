'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const core=require('../js/tools-core.js'),domain=read('js/tools-domain.js'),map=read('js/tools-map.js'),telegram=read('js/photo-telegram-domain.js'),editor=read('js/ticket-editor-domain.js'),render=read('js/tickets-render.js'),html=read('index.html'),styles=read('styles.css'),app=read('app.js'),backup=read('js/backup-system.js');

// A/B: empty search hierarchy is complete and toggle never destroys the tapped details node.
const groups=domain.slice(domain.indexOf('function toolsNetworkGroupsHtml'),domain.indexOf('function toolsOpenPointEditorFromMap'));
assert.match(groups,/cityGroup\.streets\.map/);assert.match(groups,/streetGroup\.points\.map/);
const toggle=domain.match(/root\.addEventListener\('toggle',[^;]+;/s)?.[0]||'';assert.doesNotMatch(toggle,/renderToolsScreen/);

// C, L, M, W-Z: viewer, stable move, explicit changed marker and modal lifecycle.
assert.match(domain,/toolsOpenNetworkPhotoViewer/);assert.match(styles,/tools-photo-viewer/);
assert.match(domain,/toolsMoveNetworkPoint/);assert.match(domain,/if\(!picker\?\.hasChanged\(\)\)/);assert.match(map,/hasChanged:\(\)=>changed/);
assert.match(map,/if\(initial\)setPoint\(initial,false,false\)/);assert.match(domain,/requestAnimationFrame\(\(\)=>requestAnimationFrame/);
assert.match(domain,/const closePicker=\(\)=>\{MTToolsMap\.destroyPicker\(\);closeModal\(\);\}/);

// D-K: local-first Telegram single send/update, durable ref, no silent duplicate.
assert.ok(domain.indexOf('toolsSaveNetworkPoints()')<domain.indexOf('await toolsSendNetworkPointTelegram(normalized'));
assert.match(domain,/toolsNetworkTelegramSending=new Set/);assert.match(domain,/editTelegramTextMessage\(current\.telegramChatId,current\.telegramMessageId,text\)/);
assert.match(telegram,/async function editTelegramTextMessage/);assert.doesNotMatch(domain,/Створити ще одне повідомлення/);
assert.match(domain,/telegramMediaUpdatePending/);assert.match(domain,/формат існуючого повідомлення не дозволяє безпечно замінити медіа/);
assert.match(domain,/NETWORK_POINT_JSON/);assert.match(domain,/master-tracker-network-point-v1/);

// N-S: many-to-many stable links, reverse history, unlink and safe delete cleanup.
assert.deepEqual(core.linkNetworkPoint(['p1'],'p2'),['p1','p2']);assert.deepEqual(core.linkNetworkPoint(['p1'],'p1'),['p1']);assert.deepEqual(core.unlinkNetworkPoint(['p1','p2'],'p1'),['p2']);
const tickets=[{id:'t1',networkPointIds:['p1','p2']},{id:'t2'}];assert.equal(core.ticketsForNetworkPoint(tickets,'p1').length,1);core.removeNetworkPointLinks(tickets,'p1');assert.deepEqual(tickets[0].networkPointIds,['p2']);
assert.match(html,/calcNetworkPointAddBtn/);assert.match(domain,/toolsOpenTicketNetworkPointPicker/);assert.match(render,/ticket-network-unlink/);assert.match(domain,/Пов’язані заявки/);
assert.match(app,/networkPointIds/);assert.match(backup,/tickets/);

// T-V: free call threshold uses selected-equipment sum only and is reversible.
const context={};vm.createContext(context);vm.runInContext(read('js/finance-utils.js'),context);
let result=context.calculateTicketTotal({type:'Ремонт',callFee:300,freeRepairCallThreshold:800,equipment:[{checked:true,price:500},{checked:true,price:1000}]});assert.equal(result.total,1500);assert.equal(result.callFee,0);
result=context.calculateTicketTotal({type:'Ремонт',callFee:300,freeRepairCallThreshold:800,equipment:[{checked:true,price:500}]});assert.equal(result.total,800);assert.equal(result.callFee,300);
assert.match(editor,/equipmentTotal=.*reduce/);assert.match(html,/Для ремонту: якщо сума вибраного обладнання дорівнює або перевищує цей поріг/);

// AA/AB and mobile editor safety.
assert.match(domain,/name="mt-internal-profile-search"/);assert.match(domain,/role="searchbox"/);assert.match(domain,/autocomplete="off"/);
const point=core.normalizeNetworkPoint({id:'stable',type:'Муфта',lat:48,lng:37,telegramChatId:'-1001',telegramMessageId:7,photoKeys:['idb:p']},new Date('2026-09-01T12:00:00Z'));assert.equal(point.id,'stable');assert.equal(point.telegramMessageId,7);assert.deepEqual(point.photoKeys,['idb:p']);
assert.match(styles,/tools-point-editor-overlay textarea\{width:100%/);assert.match(styles,/tools-point-editor-footer\{position:sticky/);
assert.match(app,/v84 · 2026-09-01/);assert.match(read('sw.js'),/maister-treker-v66-runtime-26/);
console.log('PASS v84 network tree/viewer/Telegram update/links, repair threshold and coordinate-modal regressions');
